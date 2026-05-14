import { initializePipelineState } from "./pipeline-context.js";
import { routeError } from "../errors/pipeline-error-handler.js";
import { validatePipelineResult } from "../reporting/pipeline-result-validator.js";
import {
  executeInitialSetupPhases,
  executeEnvironmentSetup,
  executeCoreLoopPhase,
  executePostProcessingPhases
} from "../phases/pipeline-phases.js";
import type {
  OrchestratorInput,
  OrchestratorResult,
} from "./pipeline-context.js";
import type { PhaseResult } from "../../types/pipeline.js";
import { clearCache } from "../../github/github-cache.js";
import {
  handleDuplicatePR,
  extractValidatedSetupValues,
  createPostProcessingContext
} from "./orchestrator-helpers.js";
import { HookRegistry } from "../../hooks/hook-registry.js";
import { HookExecutor } from "../../hooks/hook-executor.js";
import { dispatchPipelineEvent } from "../automation/automation-dispatcher.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import { getLogger } from "../../utils/logger.js";

const HEARTBEAT_INTERVAL_MS = 60_000;


export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { config, aqRoot } = input;
  const startTime = Date.now();
  const logger = getLogger();

  // Initialize hook registry and executor from config
  const hookRegistry = new HookRegistry(config.hooks ?? {});
  const hookExecutor = new HookExecutor({
    repo: input.repo,
    issue_number: String(input.issueNumber),
  });

  // Initialize pipeline state
  const runtime = await initializePipelineState(input, config);

  // 파이프라인 진행 단계 heartbeat — 사용자에게 hang이 아님을 알린다.
  // Plan 생성/Phase 작성 같은 장기 단계가 60s 이상 걸려도 server.log에 진행 신호가 보이도록.
  const heartbeatTimer = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    logger.info(`[HEARTBEAT] pipeline alive — issue=#${input.issueNumber} repo=${input.repo} state=${runtime.state} elapsed=${elapsedSec}s`);
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }

  // 전체 파이프라인 수명 동안 유지되는 누적 phase 결과 배열
  const accumulatedPhaseResults: PhaseResult[] = [];

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

    checkpointFn({ plan: undefined, phaseResults: [...accumulatedPhaseResults] });

    // Phase 3: Core Loop Execution (Plan generation + Phase execution)
    const coreResult = await executeCoreLoopPhase({
      input,
      runtime,
      issue,
      project: setupResult.project,
      config,
      promptsDir: setupResult.promptsDir,
      dataDir: setupResult.dataDir,
      envResult,
      timer: setupResult.timer,
      mode,
      hooks: { registry: hookRegistry, executor: hookExecutor },
    });

    checkpointFn({ plan: coreResult.coreResult.plan, phaseResults: [...accumulatedPhaseResults, ...coreResult.coreResult.phaseResults] });

    // Phase 4: Post-processing (Review, Simplify, Validation, Publish)
    const postProcessingContext = createPostProcessingContext({
      issue,
      coreResult: coreResult.coreResult,
      setupResult,
      envResult,
      preset: coreResult.preset,
      runtime,
      checkpointFn,
      jobLogger: input.jobLogger,
      accumulatedPhaseResults,
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
    // 파이프라인 종료 시 heartbeat 중지 + 캐시 정리 — 성공/실패 모두 메모리 누수 방지
    clearInterval(heartbeatTimer);
    clearCache();
  }
}
