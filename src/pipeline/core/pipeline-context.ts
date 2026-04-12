import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import type { PipelineState } from "../../types/pipeline.js";
import type { AQConfig, GitConfig } from "../../types/config.js";
import type { PipelineReport } from "../reporting/result-reporter.js";
import type { JobLogger } from "../../queue/job-logger.js";
import type { PipelineCheckpoint } from "../errors/checkpoint.js";
import { progressForState } from "../reporting/progress-tracker.js";
import { getLogger } from "../../utils/logger.js";

export interface OrchestratorInput {
  issueNumber: number;
  repo: string; // "owner/repo"
  config: AQConfig;
  projectRoot?: string;  // optional override; falls back to project config
  aqRoot?: string;       // AI Quartermaster root (where prompts/ lives)
  jobLogger?: JobLogger;
  resumeFrom?: PipelineCheckpoint;
  isRetry?: boolean;     // true if this is a retry of a previously failed job
}

export interface OrchestratorResult {
  success: boolean;
  state: PipelineState;
  prUrl?: string;
  report?: PipelineReport;
  error?: string;
  totalCostUsd?: number;
}

export interface PipelineRuntime {
  state: PipelineState;
  worktreePath?: string;
  branchName?: string;
  projectRoot: string;
  gitConfig: GitConfig;
  promptsDir: string;
  rollbackHash?: string;
  rollbackStrategy: "none" | "all" | "failed-only";
}

export const STATE_ORDER: PipelineState[] = [
  "RECEIVED",
  "VALIDATED",
  "BASE_SYNCED",
  "BRANCH_CREATED",
  "WORKTREE_CREATED",
  "PLAN_GENERATED",
  "PHASE_IN_PROGRESS",
  "REVIEWING",
  "SIMPLIFYING",
  "FINAL_VALIDATING",
  "DRAFT_PR_CREATED",
  "CI_CHECKING",
  "CI_FIXING",
  "DONE",
];

/**
 * 비활성화된 기능 상태를 정규화한다.
 * CI_CHECKING/CI_FIXING은 현재 비활성화된 상태이므로 체크포인트 복원 시 DONE으로 전진한다.
 */
export function normalizeCheckpointState(state: PipelineState): PipelineState {
  if (state === "CI_CHECKING" || state === "CI_FIXING") {
    return "DONE";
  }
  return state;
}

export function isPastState(checkpointState: PipelineState, current: PipelineState): boolean {
  const checkpointIdx = STATE_ORDER.indexOf(checkpointState);
  const currentIdx = STATE_ORDER.indexOf(current);
  // States not in STATE_ORDER (FAILED, PHASE_FAILED) return -1 → re-execute all stages
  if (checkpointIdx === -1 || currentIdx === -1) return false;
  return checkpointIdx > currentIdx;
}

export function saveResult(config: AQConfig, projectRoot: string, issueNumber: number, report: PipelineReport): void {
  try {
    const logDir = resolve(projectRoot, config.general.logDir);
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      resolve(logDir, `issue-${issueNumber}-result.json`),
      JSON.stringify(report, null, 2)
    );
  } catch {
    // non-fatal
  }
}

export async function initializePipelineState(
  input: OrchestratorInput,
  config: AQConfig
): Promise<PipelineRuntime> {
  const resumeFrom = input.resumeFrom;
  const logger = getLogger();

  const restoredState = resumeFrom ? normalizeCheckpointState(resumeFrom.state) : "RECEIVED";

  const runtime: PipelineRuntime = {
    state: restoredState,
    worktreePath: resumeFrom?.worktreePath,
    branchName: resumeFrom?.branchName,
    projectRoot: input.projectRoot ?? resumeFrom?.projectRoot ?? "",
    gitConfig: config.git,
    promptsDir: resolve(input.projectRoot ?? resumeFrom?.projectRoot ?? "", "prompts"),
    rollbackHash: undefined,
    rollbackStrategy: "none",
  };

  if (resumeFrom) {
    if (restoredState !== resumeFrom.state) {
      logger.info(`Checkpoint state normalized: ${resumeFrom.state} → ${restoredState} (disabled feature state)`);
    }
    logger.info(`Resuming pipeline from state: ${restoredState}`);
    input.jobLogger?.setProgress(progressForState(restoredState));
  }

  return runtime;
}

export function transitionState(
  runtime: PipelineRuntime,
  newState: PipelineState,
  context?: {
    worktreePath?: string;
    branchName?: string;
    projectRoot?: string;
    rollbackHash?: string;
    rollbackStrategy?: "none" | "all" | "failed-only";
  }
): void {
  const logger = getLogger();

  logger.info(`State transition: ${runtime.state} → ${newState}`);
  runtime.state = newState;

  if (context) {
    if (context.worktreePath !== undefined) {
      runtime.worktreePath = context.worktreePath;
    }
    if (context.branchName !== undefined) {
      runtime.branchName = context.branchName;
    }
    if (context.projectRoot !== undefined) {
      runtime.projectRoot = context.projectRoot;
      runtime.promptsDir = resolve(context.projectRoot, "prompts");
    }
    if (context.rollbackHash !== undefined) {
      runtime.rollbackHash = context.rollbackHash;
    }
    if (context.rollbackStrategy !== undefined) {
      runtime.rollbackStrategy = context.rollbackStrategy;
    }
  }
}