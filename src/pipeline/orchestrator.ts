import { handlePipelineFailure } from "./pipeline-publish.js";
import { initializePipelineState, transitionState } from "./pipeline-context.js";
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

    // Validate required values from setup
    if (!issue) {
      throw new Error("Issue not fetched during setup");
    }
    if (!mode) {
      throw new Error("Pipeline mode not determined during setup");
    }

    // Provide default checkpoint function if not available
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
      checkpoint: checkpointFn
    };

    const finalResult = await executePostProcessingPhases(
      postProcessingContext,
      runtime,
      input,
      config,
      startTime
    );

    // Verify that prUrl was successfully created
    if (!finalResult.prUrl) {
      transitionState(runtime, "FAILED");
      const errorMessage = "Pipeline completed but failed to create PR URL";
      return {
        success: false,
        state: "FAILED",
        error: errorMessage,
        report: finalResult.report,
        totalCostUsd: finalResult.totalCostUsd
      };
    }

    return {
      success: true,
      state: runtime.state,
      prUrl: finalResult.prUrl,
      report: finalResult.report,
      totalCostUsd: finalResult.totalCostUsd
    };

  } catch (error) {
    // Check if this is a skipped issue due to feasibility check
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isFeasibilitySkip = errorMessage.startsWith("FEASIBILITY_SKIP:");

    if (isFeasibilitySkip) {
      const { formatResult } = await import("./result-reporter.js");
      const skipReason = errorMessage.slice("FEASIBILITY_SKIP:".length).trim();
      const basicPlan = {
        issueNumber,
        title: `Issue #${issueNumber} skipped`,
        problemDefinition: skipReason,
        requirements: [],
        affectedFiles: [],
        risks: [],
        phases: [],
        verificationPoints: [],
        stopConditions: []
      };
      const report = formatResult(issueNumber, repo, basicPlan, [], startTime);

      return {
        success: true,
        state: "SKIPPED" as const,
        report,
        error: skipReason
      };
    }

    // Check if this is a core loop failure with detailed results
    const errorWithReport = error as Error & { failureResult?: OrchestratorResult };
    if (errorWithReport.failureResult) {
      // Core loop failure already handled by handleCoreLoopFailure
      transitionState(runtime, "FAILED");
      return errorWithReport.failureResult;
    }

    // General pipeline failure
    const failureContext = {
      error,
      state: runtime.state,
      worktreePath: runtime.worktreePath,
      branchName: runtime.branchName,
      rollbackHash: runtime.rollbackHash,
      rollbackStrategy: runtime.rollbackStrategy,
      gitConfig: runtime.gitConfig,
      projectRoot: runtime.projectRoot,
      cleanupOnFailure: config.worktree.cleanupOnFailure,
      jl: input.jobLogger,
    };

    const finalErrorMessage = await handlePipelineFailure(failureContext);
    transitionState(runtime, "FAILED");

    // Generate a basic report for failed pipelines
    const { formatResult } = await import("./result-reporter.js");
    const basicPlan = {
      issueNumber,
      title: "Pipeline failed",
      problemDefinition: "Pipeline execution failed",
      requirements: [],
      affectedFiles: [],
      risks: [],
      phases: [],
      verificationPoints: [],
      stopConditions: []
    };
    const report = formatResult(issueNumber, repo, basicPlan, [], startTime);

    return { success: false, state: "FAILED", error: finalErrorMessage, report };
  }
}
