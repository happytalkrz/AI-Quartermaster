import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import type { PipelineState, Plan, PhaseResult } from "../types/pipeline.js";
import type { PipelineMode } from "../types/config.js";

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
  writeFileSync(checkpointPath(dataDir, issueNumber), JSON.stringify(checkpoint, null, 2));
}

export function loadCheckpoint(dataDir: string, issueNumber: number): PipelineCheckpoint | null {
  const path = checkpointPath(dataDir, issueNumber);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PipelineCheckpoint;
  } catch {
    return null;
  }
}

export function removeCheckpoint(dataDir: string, issueNumber: number): void {
  const path = checkpointPath(dataDir, issueNumber);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
