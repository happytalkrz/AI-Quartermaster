import { formatResult, printResult } from "./result-reporter.js";
import { rollbackToCheckpoint as doRollback } from "../safety/rollback-manager.js";
import { saveResult } from "./pipeline-context.js";
import { PatternStore } from "../learning/pattern-store.js";
import { getLogger } from "../utils/logger.js";
import type { PipelineState, PhaseResult } from "../types/pipeline.js";
import type { JobLogger } from "../queue/job-logger.js";
import type { PipelineReport } from "./result-reporter.js";
import type { CoreLoopResult } from "./core-loop.js";
import type { AQConfig } from "../types/config.js";

const logger = getLogger();

export interface CoreLoopFailureContext {
  issueNumber: number;
  repo: string;
  coreResult: CoreLoopResult;
  worktreePath?: string;
  rollbackHash?: string;
  rollbackStrategy: "none" | "all" | "failed-only";
  gitConfig: any;
  startTime: number;
  config: AQConfig;
  aqRoot: string;
  projectRoot: string;
  dataDir: string;
  patternStore: PatternStore;
  jl?: JobLogger;
  checkpoint: (overrides?: any) => void;
}

export interface CoreLoopFailureResult {
  success: false;
  state: PipelineState;
  error: string;
  report: PipelineReport;
}

/**
 * Handle core-loop execution failure with rollback and reporting
 */
export async function handleCoreLoopFailure(context: CoreLoopFailureContext): Promise<CoreLoopFailureResult> {
  const {
    issueNumber,
    repo,
    coreResult,
    worktreePath,
    rollbackHash,
    rollbackStrategy,
    gitConfig,
    startTime,
    config,
    aqRoot,
    projectRoot,
    dataDir,
    patternStore,
    jl,
    checkpoint,
  } = context;

  const state: PipelineState = "FAILED";
  const failedPhase = coreResult.phaseResults.find(r => !r.success);

  jl?.log(`실패: ${failedPhase?.error ?? "Phase execution failed"}`);
  jl?.setStep("실패");

  // Save checkpoint so pipeline can be resumed
  checkpoint({
    state: "PLAN_GENERATED",
    plan: coreResult.plan,
    phaseResults: coreResult.phaseResults
  });

  // Record failure pattern
  try {
    patternStore.add({
      issueNumber,
      repo,
      type: "failure",
      errorCategory: failedPhase?.errorCategory,
      errorMessage: failedPhase?.error,
      phaseName: failedPhase?.phaseName,
      tags: [],
    });
  } catch {
    // non-fatal
  }

  // === Rollback on core-loop failure ===
  let rollbackInfo: string | undefined;
  if (worktreePath && rollbackStrategy !== "none") {
    try {
      let targetHash: string | undefined;
      if (rollbackStrategy === "all" && rollbackHash) {
        targetHash = rollbackHash;
      } else if (rollbackStrategy === "failed-only") {
        // Roll back to the last successful phase's commit
        const lastSuccessful = [...coreResult.phaseResults].reverse().find(r => r.success && r.commitHash);
        targetHash = lastSuccessful?.commitHash ?? rollbackHash;
      }
      if (targetHash) {
        await doRollback(targetHash, { cwd: worktreePath, gitPath: gitConfig.gitPath });
        rollbackInfo = `Rolled back to ${targetHash.slice(0, 8)} (strategy: ${rollbackStrategy})`;
        logger.info(rollbackInfo);
      }
    } catch (rbErr) {
      logger.warn(`Rollback failed: ${rbErr}`);
    }
  }

  const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
  printResult(report);
  saveResult(config, aqRoot ?? projectRoot, issueNumber, report);

  const errorMessage = rollbackInfo
    ? `Phase execution failed. ${rollbackInfo}`
    : "Phase execution failed";

  return {
    success: false,
    state,
    error: errorMessage,
    report
  };
}