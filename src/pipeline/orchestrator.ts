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
import { HookRegistry } from "../hooks/hook-registry.js";
import { HookExecutor } from "../hooks/hook-executor.js";
import { dispatchPipelineEvent } from "./automation-dispatcher.js";
import { getErrorMessage } from "../utils/error-utils.js";


export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { config, aqRoot } = input;
  const startTime = Date.now();

  // Initialize hook registry and executor from config
  const hookRegistry = new HookRegistry(config.hooks ?? {});
  const hookExecutor = new HookExecutor({
    repo: input.repo,
    issue_number: String(input.issueNumber),
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
      mode,
      hookRegistry,
      hookExecutor
    );

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
    postProcessingContext.hookRegistry = hookRegistry;
    postProcessingContext.hookExecutor = hookExecutor;

    const finalResult = await executePostProcessingPhases(
      postProcessingContext,
      runtime,
      input,
      config,
      startTime
    );

    // Validate pipeline result
    const validationError = validatePipelineResult({ finalResult, runtime });
    if (validationError) {
      return validationError;
    }

    await dispatchPipelineEvent({
      type: "pipeline-complete",
      payload: {
        issueNumber: input.issueNumber,
        repo: input.repo,
        prUrl: finalResult.prUrl ?? "",
        totalCostUsd: finalResult.totalCostUsd,
        durationMs: Date.now() - startTime,
      },
      triggeredAt: new Date().toISOString(),
    });

    return {
      success: true,
      state: runtime.state,
      prUrl: finalResult.prUrl,
      report: finalResult.report,
      totalCostUsd: finalResult.totalCostUsd
    };

  } catch (error: unknown) {
    await dispatchPipelineEvent({
      type: "pipeline-failed",
      payload: {
        issueNumber: input.issueNumber,
        repo: input.repo,
        state: runtime.state,
        errorMessage: getErrorMessage(error),
        durationMs: Date.now() - startTime,
      },
      triggeredAt: new Date().toISOString(),
    });
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
