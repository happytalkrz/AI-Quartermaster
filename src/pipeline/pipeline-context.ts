import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import type { PipelineState } from "../types/pipeline.js";
import type { AQConfig } from "../types/config.js";
import type { PipelineReport } from "./result-reporter.js";
import type { JobLogger } from "../queue/job-logger.js";

export interface OrchestratorInput {
  issueNumber: number;
  repo: string; // "owner/repo"
  config: AQConfig;
  projectRoot?: string;  // optional override; falls back to project config
  aqRoot?: string;       // AI Quartermaster root (where prompts/ lives)
  jobLogger?: JobLogger;
  resumeFrom?: import("./checkpoint.js").PipelineCheckpoint;
  isRetry?: boolean;     // true if this is a retry of a previously failed job
}

export interface OrchestratorResult {
  success: boolean;
  state: PipelineState;
  prUrl?: string;
  report?: PipelineReport;
  error?: string;
}

export const STATE_ORDER: PipelineState[] = [
  "RECEIVED",
  "VALIDATED",
  "BASE_SYNCED",
  "BRANCH_CREATED",
  "WORKTREE_CREATED",
  "PLAN_GENERATED",
  "REVIEWING",
  "SIMPLIFYING",
  "FINAL_VALIDATING",
  "DRAFT_PR_CREATED",
  "DONE",
];

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