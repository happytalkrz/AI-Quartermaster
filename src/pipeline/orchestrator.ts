import { initializePipelineState } from "./pipeline-context.js";
import { routeError } from "./pipeline-error-handler.js";
import { validatePipelineResult } from "./pipeline-result-validator.js";
import {
  executeInitialSetupPhases,
  executeEnvironmentSetup,
  executeCoreLoopPhase,
  executePostProcessingPhases
} from "./pipeline-phases.js";
import type {
  OrchestratorInput,
  OrchestratorResult,
} from "./pipeline-context.js";
import { clearCache } from "../github/github-cache.js";
import {
  handleDuplicatePR,
  extractValidatedSetupValues,
  createPostProcessingContext
} from "./orchestrator-helpers.js";
import { initializeHooks, HookRegistry, HookExecutor } from "../hooks/index.js";
import type { HookTiming } from "../types/hooks.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

const logger = getLogger();

/**
 * 훅을 실행하되 실패해도 파이프라인은 계속 진행
 */
async function executeHook(
  hookRegistry: HookRegistry,
  hookExecutor: HookExecutor,
  timing: HookTiming,
  context: Record<string, string> = {}
): Promise<void> {
  try {
    if (hookRegistry.hasHooks(timing)) {
      logger.debug(`Executing hooks for timing: ${timing}`);
      const hooks = hookRegistry.getHooks(timing);

      // 컨텍스트 변수 업데이트
      hookExecutor.updateVariables(context);

      const results = await hookExecutor.executeHooks(hooks);

      // 결과 로깅
      for (const result of results) {
        if (result.success) {
          logger.debug(`Hook succeeded (${result.duration}ms): ${result.stdout}`);
        } else {
          logger.warn(`Hook failed but continuing pipeline: ${result.error || result.stderr}`);
        }
      }
    }
  } catch (error: unknown) {
    logger.warn(`Hook execution failed but continuing pipeline: ${getErrorMessage(error)}`);
  }
}

export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { config, aqRoot } = input;
  const startTime = Date.now();

  // Initialize hooks system
  const hookRegistry = initializeHooks(config.hooks);
  const hookExecutor = new HookExecutor({
    issueNumber: input.issueNumber.toString(),
    repo: input.repo,
    timestamp: new Date().toISOString(),
  });

  // Initialize pipeline state
  const runtime = await initializePipelineState(input, config);

  try {
    // Phase 1: Initial Setup (Project, Duplicate PR check, Issue validation)
    const setupResult = await executeInitialSetupPhases(input, runtime, config, aqRoot);

    // Handle duplicate PR early return
    const duplicateResult = handleDuplicatePR(setupResult);
    if (duplicateResult) {
      return duplicateResult;
    }

    // Extract validated setup values
    const { issue, mode, checkpointFn } = extractValidatedSetupValues(setupResult);

    // Phase 2: Environment Setup (Git + Work environment)
    const envResult = await executeEnvironmentSetup(
      input,
      runtime,
      issue,
      setupResult.project,
      setupResult.gitConfig,
      setupResult.projectRoot,
      config,
      checkpointFn
    );

    checkpointFn({ plan: undefined, phaseResults: [] });

    // Hook: pre-plan - Plan 생성 전 훅 실행
    await executeHook(hookRegistry, hookExecutor, "pre-plan", {
      issue: issue.number.toString(),
      title: issue.title,
      worktree: runtime.worktreePath || "",
    });

    // Phase 3: Core Loop Execution (Plan generation + Phase execution)
    const coreResult = await executeCoreLoopPhase(
      input,
      runtime,
      issue,
      setupResult.project,
      config,
      setupResult.promptsDir,
      setupResult.dataDir,
      envResult,
      setupResult.timer,
      mode
    );

    // Hook: post-plan - Plan 생성 후 훅 실행
    await executeHook(hookRegistry, hookExecutor, "post-plan", {
      issue: issue.number.toString(),
      title: issue.title,
      worktree: runtime.worktreePath || "",
      plan: JSON.stringify(coreResult.coreResult.plan),
    });

    // Hook: pre-phase - Phase 실행 전 훅 실행 (Phase 구현 시작 전)
    await executeHook(hookRegistry, hookExecutor, "pre-phase", {
      issue: issue.number.toString(),
      title: issue.title,
      worktree: runtime.worktreePath || "",
      plan: JSON.stringify(coreResult.coreResult.plan),
      totalPhases: coreResult.coreResult.plan.phases.length.toString(),
    });

    // Hook: post-phase - Phase 실행 후 훅 실행 (Phase 구현 완료 후)
    await executeHook(hookRegistry, hookExecutor, "post-phase", {
      issue: issue.number.toString(),
      title: issue.title,
      worktree: runtime.worktreePath || "",
      plan: JSON.stringify(coreResult.coreResult.plan),
      completedPhases: coreResult.coreResult.phaseResults.length.toString(),
      successfulPhases: coreResult.coreResult.phaseResults.filter(r => r.success).length.toString(),
    });

    checkpointFn({ plan: coreResult.coreResult.plan, phaseResults: coreResult.coreResult.phaseResults });

    // Phase 4: Post-processing (Review, Simplify, Validation, Publish)
    const postProcessingContext = createPostProcessingContext({
      issue,
      coreResult: coreResult.coreResult,
      setupResult,
      envResult,
      preset: coreResult.preset,
      runtime,
      checkpointFn,
      jobLogger: input.jobLogger
    });

    // Hook: pre-review - Review 시작 전 훅 실행
    await executeHook(hookRegistry, hookExecutor, "pre-review", {
      issue: issue.number.toString(),
      title: issue.title,
      worktree: runtime.worktreePath || "",
      plan: JSON.stringify(coreResult.coreResult.plan),
      phaseCount: coreResult.coreResult.phaseResults.length.toString(),
    });

    // Hook: pre-pr - PR 생성 전 훅 실행 (post-processing 전에 실행)
    await executeHook(hookRegistry, hookExecutor, "pre-pr", {
      issue: issue.number.toString(),
      title: issue.title,
      worktree: runtime.worktreePath || "",
      plan: JSON.stringify(coreResult.coreResult.plan),
      branch: runtime.branchName || "",
    });

    const finalResult = await executePostProcessingPhases(
      postProcessingContext,
      runtime,
      input,
      config,
      startTime
    );

    // Hook: post-review - Review 완료 후 훅 실행
    await executeHook(hookRegistry, hookExecutor, "post-review", {
      issue: issue.number.toString(),
      title: issue.title,
      worktree: runtime.worktreePath || "",
      reviewPassed: finalResult.prUrl ? "true" : "false",
    });

    // Hook: post-pr - PR 생성 후 훅 실행
    if (finalResult.prUrl) {
      await executeHook(hookRegistry, hookExecutor, "post-pr", {
        issue: issue.number.toString(),
        title: issue.title,
        worktree: runtime.worktreePath || "",
        prUrl: finalResult.prUrl,
        branch: runtime.branchName || "",
      });
    }

    // Validate pipeline result
    const validationError = validatePipelineResult({ finalResult, runtime });
    if (validationError) {
      return validationError;
    }

    return {
      success: true,
      state: runtime.state,
      prUrl: finalResult.prUrl,
      report: finalResult.report,
      totalCostUsd: finalResult.totalCostUsd
    };

  } catch (error: unknown) {
    return await routeError(error, {
      runtime,
      input,
      config,
      startTime
    });
  } finally {
    // 파이프라인 종료 시 캐시 정리 - 성공/실패 모두 메모리 누수 방지
    clearCache();
  }
}
