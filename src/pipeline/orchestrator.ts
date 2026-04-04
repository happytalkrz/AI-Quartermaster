import { initializePipelineState } from "./pipeline-context.js";
import { routeError } from "./pipeline-error-handler.js";
import { validatePipelineResult } from "./pipeline-result-validator.js";
import {
  executeInitialSetupPhases,
  executeEnvironmentSetup,
  executeCoreLoopPhase,
  executePostProcessingPhases,
  type PostProcessingContext
} from "./pipeline-phases.js";
import type {
  OrchestratorInput,
  OrchestratorResult,
} from "./pipeline-context.js";
import { clearCache } from "../github/github-cache.js";


export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { issueNumber, repo, config, aqRoot } = input;
  const startTime = Date.now();

  // Initialize pipeline state
  const runtime = await initializePipelineState(input, config);

  try {
    // Phase 1: Initial Setup (Project, Duplicate PR check, Issue validation)
    const setupResult = await executeInitialSetupPhases(input, runtime, config, aqRoot);

    // Early return for duplicate PR
    if (setupResult.duplicatePRUrl) {
      return { success: true, state: "DONE", prUrl: setupResult.duplicatePRUrl };
    }

    const { issue, mode, checkpoint } = setupResult;

    // Validate required values from setup (moved to pipeline-phases but needed here for types)
    if (!issue) {
      throw new Error("Issue not fetched during setup");
    }
    if (!mode) {
      throw new Error("Pipeline mode not determined during setup");
    }

    const checkpointFn = checkpoint || (() => {});

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
      mode
    );

    checkpointFn({ plan: coreResult.coreResult.plan, phaseResults: coreResult.coreResult.phaseResults });

    // Phase 4: Post-processing (Review, Simplify, Validation, Publish)
    const postProcessingContext: PostProcessingContext = {
      issue,
      coreResult: coreResult.coreResult,
      gitConfig: setupResult.gitConfig,
      project: setupResult.project,
      worktreePath: runtime.worktreePath!,
      promptsDir: setupResult.promptsDir,
      skillsContext: envResult.skillsContext,
      preset: coreResult.preset,
      timer: setupResult.timer,
      checkpoint: checkpointFn,
      jobLogger: input.jobLogger
    };

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
