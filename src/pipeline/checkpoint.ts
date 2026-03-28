import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "fs";
import { getLogger } from "../utils/logger.js";
import type { PipelineState, Plan, PhaseResult } from "../types/pipeline.js";
import type { PipelineMode } from "../types/config.js";

const logger = getLogger();

export interface PipelineCheckpoint {
  jobId?: string;
  issueNumber: number;
  repo: string;
  state: PipelineState;
  worktreePath?: string;
  branchName?: string;
  projectRoot: string;
  plan?: Plan;
  phaseResults: PhaseResult[];
  mode: PipelineMode;
  savedAt: string;
}

function checkpointPath(dataDir: string, issueNumber: number): string {
  return resolve(dataDir, "checkpoints", `${issueNumber}.json`);
}

export function saveCheckpoint(dataDir: string, issueNumber: number, checkpoint: PipelineCheckpoint): void {
  const dir = resolve(dataDir, "checkpoints");
  mkdirSync(dir, { recursive: true });
  const filePath = checkpointPath(dataDir, issueNumber);
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2));
  renameSync(tmpPath, filePath);
}

export function loadCheckpoint(dataDir: string, issueNumber: number): PipelineCheckpoint | null {
  const path = checkpointPath(dataDir, issueNumber);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PipelineCheckpoint;
  } catch (err) {
    logger.warn(`Failed to load checkpoint for issue #${issueNumber}: ${err}`);
    return null;
  }
}

export function removeCheckpoint(dataDir: string, issueNumber: number): void {
  const path = checkpointPath(dataDir, issueNumber);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
