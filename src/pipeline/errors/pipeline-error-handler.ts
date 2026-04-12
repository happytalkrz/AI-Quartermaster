import { resolve } from "path";
import { formatResult, printResult } from "../reporting/result-reporter.js";
import { rollbackToCheckpoint as doRollback } from "../../safety/rollback-manager.js";
import { saveResult, transitionState } from "../core/pipeline-context.js";
import { PatternStore } from "../../learning/pattern-store.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage, isAQMError } from "../../utils/error-utils.js";
import { PipelineError, SafetyViolationError, TimeoutError } from "../../types/errors.js";
import { handlePipelineFailure } from "../phases/pipeline-publish.js";
import { runDiagnosis } from "./diagnosis-runner.js";
import type { PipelineState, ErrorHistoryEntry } from "../../types/pipeline.js";
import type { PipelineCheckpoint } from "./checkpoint.js";
import type { JobLogger } from "../../queue/job-logger.js";
import type { PipelineReport } from "../reporting/result-reporter.js";
import type { CoreLoopResult } from "../core/core-loop.js";
import type { AQConfig, GitConfig } from "../../types/config.js";
import type { PipelineRuntime, OrchestratorResult } from "../core/pipeline-context.js";

const logger = getLogger();

export interface CoreLoopFailureContext {
  issueNumber: number;
  repo: string;
  coreResult: CoreLoopResult;
  worktreePath?: string;
  rollbackHash?: string;
  rollbackStrategy: "none" | "all" | "failed-only";
  gitConfig: GitConfig;
  startTime: number;
  config: AQConfig;
  aqRoot: string;
  projectRoot: string;
  dataDir: string;
  patternStore: PatternStore;
  jl?: JobLogger;
  checkpoint: (overrides?: Partial<PipelineCheckpoint>) => void;
  /** 이슈 제목 (진단 컨텍스트용, 없으면 Issue #N으로 대체) */
  issueTitle?: string;
  /** 최근 로그 라인 배열 (진단 컨텍스트용) */
  recentLogs?: string[];
  /** 에러 히스토리 (진단 컨텍스트용) */
  errorHistory?: ErrorHistoryEntry[];
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
    patternStore,
    jl,
    checkpoint,
    issueTitle,
    recentLogs,
    errorHistory,
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
  } catch (_err: unknown) {
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
    } catch (rbErr: unknown) {
      logger.warn(`Rollback failed: ${getErrorMessage(rbErr)}`);
    }
  }

  const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);

  // 진단 runner 호출 (non-fatal, claudeCli 설정이 없으면 건너뜀)
  const claudeCliConfig = config.commands?.claudeCli;
  if (claudeCliConfig) {
    const diagnosis = await runDiagnosis({
      input: {
        issueNumber,
        issueTitle: issueTitle ?? `Issue #${issueNumber}`,
        repo,
        state: "FAILED",
        failedPhase,
        plan: coreResult.plan,
        recentLogs: recentLogs ?? [],
        errorHistory: errorHistory ?? [],
      },
      claudeConfig: claudeCliConfig,
      promptsDir: resolve(aqRoot, "prompts"),
      cwd: worktreePath ?? projectRoot,
    });
    if (diagnosis) {
      report.diagnosis = diagnosis;
      logger.info(`진단 완료: ${diagnosis.rootCause.slice(0, 120)}`);
    }
  }

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

export interface FeasibilitySkipContext {
  issueNumber: number;
  repo: string;
  errorMessage: string;
  startTime: number;
}

/**
 * Handle feasibility skip error (FEASIBILITY_SKIP:)
 */
export async function handleFeasibilitySkipError(context: FeasibilitySkipContext): Promise<OrchestratorResult> {
  const { issueNumber, repo, errorMessage, startTime } = context;

  const skipReason = errorMessage.slice("FEASIBILITY_SKIP:".length).trim();
  const basicPlan = createBasicPlan(issueNumber, `Issue #${issueNumber} skipped`, skipReason);
  const report = formatResult(issueNumber, repo, basicPlan, [], startTime);

  return {
    success: true,
    state: "SKIPPED" as const,
    report,
    error: skipReason
  };
}

export interface GeneralPipelineFailureContext {
  error: unknown;
  runtime: PipelineRuntime;
  input: { issueNumber: number; repo: string; jobLogger?: JobLogger };
  config: AQConfig;
  startTime: number;
  /** 이슈 제목 (진단 컨텍스트용, 없으면 Issue #N으로 대체) */
  issueTitle?: string;
  /** 최근 로그 라인 배열 (진단 컨텍스트용) */
  recentLogs?: string[];
  /** 에러 히스토리 (진단 컨텍스트용) */
  errorHistory?: ErrorHistoryEntry[];
}

/**
 * Handle general pipeline failure with proper context and cleanup
 */
export async function handleGeneralPipelineError(context: GeneralPipelineFailureContext): Promise<OrchestratorResult> {
  const { error, runtime, input, config, startTime, issueTitle, recentLogs, errorHistory } = context;
  const { issueNumber, repo } = input;

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
  const basicPlan = createBasicPlan(issueNumber, "Pipeline failed", "Pipeline execution failed");
  const report = formatResult(issueNumber, repo, basicPlan, [], startTime);

  // 진단 runner 호출 (non-fatal, claudeCli 설정이 없으면 건너뜀)
  const generalClaudeConfig = config.commands?.claudeCli;
  if (generalClaudeConfig) {
    const diagnosis = await runDiagnosis({
      input: {
        issueNumber,
        issueTitle: issueTitle ?? `Issue #${issueNumber}`,
        repo,
        state: runtime.state,
        recentLogs: recentLogs ?? [],
        errorHistory: errorHistory ?? [],
      },
      claudeConfig: generalClaudeConfig,
      promptsDir: runtime.promptsDir,
      cwd: runtime.worktreePath ?? runtime.projectRoot,
    });
    if (diagnosis) {
      report.diagnosis = diagnosis;
      logger.info(`진단 완료: ${diagnosis.rootCause.slice(0, 120)}`);
    }
  }

  return {
    success: false,
    state: "FAILED",
    error: finalErrorMessage,
    report
  };
}

/**
 * Create a basic plan structure for error reporting
 */
function createBasicPlan(issueNumber: number, title: string, problemDefinition: string) {
  return {
    issueNumber,
    title,
    problemDefinition,
    requirements: [],
    affectedFiles: [],
    risks: [],
    phases: [],
    verificationPoints: [],
    stopConditions: []
  };
}

/**
 * Route errors to appropriate handlers
 */
export async function routeError(
  error: unknown,
  context: {
    runtime: PipelineRuntime;
    input: { issueNumber: number; repo: string; jobLogger?: JobLogger };
    config: AQConfig;
    startTime: number;
  }
): Promise<OrchestratorResult> {
  const errorMessage = getErrorMessage(error);

  // Check if this is a skipped issue due to feasibility check
  if (errorMessage.startsWith("FEASIBILITY_SKIP:")) {
    return handleFeasibilitySkipError({
      issueNumber: context.input.issueNumber,
      repo: context.input.repo,
      errorMessage,
      startTime: context.startTime
    });
  }

  // Check if this is a core loop failure with detailed results
  if (error instanceof Error && 'failureResult' in error) {
    const failureResult = (error as Error & { failureResult?: OrchestratorResult }).failureResult;
    if (failureResult) {
      // Core loop failure already handled by handleCoreLoopFailure
      transitionState(context.runtime, "FAILED");
      return failureResult;
    }
  }

  // AQMError 서브클래스별 분기 처리
  if (isAQMError(error)) {
    if (error instanceof SafetyViolationError) {
      logger.error(`Safety violation in pipeline [${error.guard}]: ${error.message}`);
    } else if (error instanceof TimeoutError) {
      logger.error(`Pipeline timeout in ${error.stage} after ${error.timeoutMs}ms`);
    } else if (error instanceof PipelineError) {
      logger.error(`Pipeline error [${error.code}]: ${error.message}`);
    }
  }

  // General pipeline failure
  return handleGeneralPipelineError({
    error,
    runtime: context.runtime,
    input: context.input,
    config: context.config,
    startTime: context.startTime
  });
}