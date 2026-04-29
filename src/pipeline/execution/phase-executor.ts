import type { ClaudeCliConfig, GitConfig } from "../../types/config.js";
import type { Plan, Phase, PhaseResult, CachedPromptLayer } from "../../types/pipeline.js";
import type { GitHubIssue } from "../../github/issue-fetcher.js";
import type { JobLogger } from "../../queue/job-logger.js";
import type { BaselineErrors } from "../reporting/verification-parser.js";
import { ClaudePhaseExecutor } from "./claude-phase-executor.js";
export type { PhaseExecutor } from "./claude-phase-executor.js";

export interface PhaseExecutorContext {
  issue: GitHubIssue;
  plan: Plan;
  phase: Phase;
  previousResults: PhaseResult[];
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  testCommand: string;
  lintCommand: string;
  gitPath: string;
  projectConventions?: string;
  skillsContext?: string;
  pastFailures?: string;
  jobLogger?: JobLogger;
  locale?: string;
  cachedLayers?: CachedPromptLayer;
  gitConfig: GitConfig;
  baseline?: BaselineErrors;
}

export async function executePhase(ctx: PhaseExecutorContext): Promise<PhaseResult> {
  return new ClaudePhaseExecutor().execute(ctx);
}
