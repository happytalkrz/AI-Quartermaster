import type {
  OrchestratorResult,
} from "./pipeline-context.js";
import type {
  PostProcessingContext,
  InitialSetupResult,
  EnvironmentSetupResult,
  CoreLoopExecutionResult
} from "../phases/pipeline-phases.js";
import type { PipelineRuntime } from "./pipeline-context.js";
import type { GitHubIssue } from "../../github/issue-fetcher.js";
import type { PipelineMode } from "../../types/config.js";
import type { PipelineCheckpoint } from "../errors/checkpoint.js";
import type { JobLogger } from "../../queue/job-logger.js";

/**
 * Handle duplicate PR check and return early result if needed
 */
export function handleDuplicatePR(setupResult: InitialSetupResult): OrchestratorResult | null {
  if (setupResult.duplicatePRUrl) {
    return { success: true, state: "DONE", prUrl: setupResult.duplicatePRUrl };
  }
  return null;
}

/**
 * Extract and validate setup values with proper type checking
 */
export function extractValidatedSetupValues(setupResult: InitialSetupResult): {
  issue: GitHubIssue;
  mode: PipelineMode;
  checkpointFn: (overrides?: Partial<PipelineCheckpoint>) => void;
} {
  const { issue, mode, checkpoint } = setupResult;

  // Validate required values from setup
  if (!issue) {
    throw new Error("Issue not fetched during setup");
  }
  if (!mode) {
    throw new Error("Pipeline mode not determined during setup");
  }

  const checkpointFn = checkpoint || (() => {});
  return { issue, mode, checkpointFn };
}

/**
 * Create PostProcessingContext from setup results
 */
export function createPostProcessingContext(params: {
  issue: GitHubIssue;
  coreResult: CoreLoopExecutionResult["coreResult"];
  setupResult: InitialSetupResult;
  envResult: EnvironmentSetupResult;
  preset: CoreLoopExecutionResult["preset"];
  runtime: PipelineRuntime;
  checkpointFn: (overrides?: Partial<PipelineCheckpoint>) => void;
  jobLogger?: JobLogger;
}): PostProcessingContext {
  return {
    issue: params.issue,
    coreResult: params.coreResult,
    gitConfig: params.setupResult.gitConfig,
    project: params.setupResult.project,
    worktreePath: params.runtime.worktreePath!,
    promptsDir: params.setupResult.promptsDir,
    skillsContext: params.envResult.skillsContext,
    preset: params.preset,
    timer: params.setupResult.timer,
    checkpoint: params.checkpointFn,
    jobLogger: params.jobLogger
  };
}