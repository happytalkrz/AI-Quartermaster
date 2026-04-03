import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { createDraftPR, enableAutoMerge, closeIssue } from "../github/pr-creator.js";
import { pushBranch, checkConflicts, attemptRebase } from "../git/branch-manager.js";
import { removeWorktree } from "../git/worktree-manager.js";
import { formatResult, printResult } from "./result-reporter.js";
import type { PipelineReport } from "./result-reporter.js";
import { validateBeforePush } from "../safety/safety-checker.js";
import { rollbackToCheckpoint as doRollback } from "../safety/rollback-manager.js";
import { runCli } from "../utils/cli-runner.js";
import { errorMessage } from "../types/errors.js";
import { getLogger } from "../utils/logger.js";
import type { AQConfig } from "../types/config.js";
import type { PublishPhaseContext, CleanupContext, FailureHandlerContext } from "../types/pipeline.js";
import { removeCheckpoint } from "./checkpoint.js";
import { PatternStore } from "../learning/pattern-store.js";
import { PROGRESS_PR_CREATED } from "./progress-tracker.js";
import { saveResult } from "./pipeline-validation.js";

const logger = getLogger();

/**
 * Push branch, create PR, enable auto-merge, and close issue
 */
export async function pushAndCreatePR(context: PublishPhaseContext): Promise<{ success: boolean; prUrl?: string; error?: string }> {
  const {
    issueNumber,
    repo,
    issue,
    plan,
    phaseResults,
    branchName,
    baseBranch,
    worktreePath,
    gitConfig,
    projectConfig,
    promptsDir,
    dryRun,
    jl,
  } = context;

  try {
    // === Safety: validate before push (sensitive paths, change limits, base branch) ===
    await validateBeforePush({
      safetyConfig: projectConfig.safety,
      gitConfig,
      cwd: worktreePath,
      baseBranch,
    });

    // === Conflict detection before push ===
    {
      // Fetch latest base branch to ensure we're comparing against current remote
      const fetchResult = await runCli(
        gitConfig.gitPath,
        ["fetch", gitConfig.remoteAlias, baseBranch],
        { cwd: worktreePath }
      );
      if (fetchResult.exitCode !== 0) {
        logger.warn(`Failed to fetch ${baseBranch} for conflict check: ${fetchResult.stderr}`);
      } else {
        const conflictCheck = await checkConflicts(gitConfig, baseBranch, { cwd: worktreePath });
        if (conflictCheck.hasConflicts) {
          logger.warn(`Conflicts detected with ${baseBranch}: ${conflictCheck.conflictFiles.join(", ") || "(unknown files)"}`);
          jl?.log(`충돌 감지됨, rebase 시도 중...`);
          const rebaseResult = await attemptRebase(gitConfig, baseBranch, { cwd: worktreePath });
          if (rebaseResult.success) {
            logger.info(`Rebase succeeded — branch is now conflict-free`);
            jl?.log(`Rebase 성공`);
          } else {
            logger.warn(`Rebase failed — PR will show conflicts. Files: ${conflictCheck.conflictFiles.join(", ") || "(unknown)"}`);
            jl?.log(`Rebase 실패 (충돌 있음): ${conflictCheck.conflictFiles.join(", ") || "unknown files"}`);
            // Non-blocking: continue with push and let humans resolve
          }
        }
      }
    }

    // === Push branch to remote ===
    jl?.setStep("Push 중...");
    if (!dryRun) {
      await pushBranch(gitConfig, branchName, { cwd: worktreePath });
    }

    // === Create Draft PR ===
    jl?.setProgress(PROGRESS_PR_CREATED);
    const prResult = await createDraftPR(
      projectConfig.pr,
      projectConfig.commands.ghCli,
      {
        issueNumber,
        issueTitle: issue.title,
        repo,
        plan,
        phaseResults,
        branchName,
        baseBranch,
      },
      { cwd: worktreePath, promptsDir, dryRun }
    );
    const prUrl = prResult.url;
    logger.info(`[DRAFT_PR_CREATED] PR: ${prUrl}`);
    jl?.log(`PR: ${prUrl}`);

    // === Enable auto-merge if configured ===
    if (projectConfig.pr.autoMerge && prResult.number > 0) {
      jl?.setStep("Auto-merge 설정 중...");
      const merged = await enableAutoMerge(
        prResult.number,
        repo,
        projectConfig.pr.mergeMethod,
        { ghPath: projectConfig.commands.ghCli.path, dryRun, isDraft: projectConfig.pr.draft }
      );
      if (merged) {
        jl?.log(`Auto-merge 활성화 (${projectConfig.pr.mergeMethod})`);
      } else {
        jl?.log(`Auto-merge 활성화 실패 (경고만, 계속 진행)`);
      }
    }

    // === Close the issue since PR is created ===
    try {
      jl?.setStep("이슈 닫는 중...");
      const closed = await closeIssue(
        issueNumber,
        repo,
        { ghPath: projectConfig.commands.ghCli.path, dryRun }
      );
      if (closed) {
        jl?.log(`이슈 #${issueNumber} 닫음`);
      } else {
        jl?.log(`이슈 닫기 실패 (경고만, 계속 진행)`);
      }
    } catch (e) {
      logger.warn(`Failed to close issue #${issueNumber}: ${e}`);
      jl?.log(`이슈 닫기 실패 (경고만, 계속 진행)`);
    }

    jl?.setStep("완료");

    return { success: true, prUrl };
  } catch (error) {
    const errMsg = errorMessage(error);
    logger.error(`[pushAndCreatePR] Failed: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/**
 * Cleanup worktree and finalize success state
 */
export async function cleanupOnSuccess(context: CleanupContext): Promise<void> {
  const {
    worktreePath,
    gitConfig,
    projectRoot,
    cleanupOnSuccess,
    issueNumber,
    repo,
    plan,
    phaseResults,
    startTime,
    prUrl,
    config,
    aqRoot,
    dataDir,
  } = context;

  // === Cleanup worktree on success ===
  if (cleanupOnSuccess && worktreePath) {
    try {
      await removeWorktree(gitConfig, worktreePath, { cwd: projectRoot });
      logger.info(`Worktree cleaned up`);
    } catch (e) {
      logger.warn(`Failed to cleanup worktree: ${e}`);
    }
  }

  // Record success pattern
  try {
    const patternStore = new PatternStore(dataDir);
    patternStore.add({
      issueNumber,
      repo,
      type: "success",
      tags: [],
    });
  } catch { /* non-fatal */ }

  const report = formatResult(issueNumber, repo, plan, phaseResults, startTime, prUrl);
  printResult(report);
  saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
  removeCheckpoint(dataDir, issueNumber);
}

/**
 * Handle pipeline failure with rollback and cleanup
 */
export async function handlePipelineFailure(context: FailureHandlerContext): Promise<string> {
  const {
    error,
    state,
    worktreePath,
    branchName,
    rollbackHash,
    rollbackStrategy,
    gitConfig,
    projectRoot,
    cleanupOnFailure,
    jl,
  } = context;

  const errMsg = errorMessage(error);
  logger.error(`[FAILED] Pipeline failed at state ${state}: ${errMsg}`);
  jl?.log(`실패: ${errMsg}`);
  jl?.setStep("실패");

  // === Rollback on exception ===
  let rollbackInfo: string | undefined;
  if (worktreePath && rollbackStrategy !== "none" && rollbackHash) {
    try {
      await doRollback(rollbackHash, { cwd: worktreePath, gitPath: gitConfig.gitPath });
      rollbackInfo = `Rolled back to ${rollbackHash.slice(0, 8)} (strategy: ${rollbackStrategy})`;
      logger.info(rollbackInfo);
    } catch (rbErr) {
      logger.warn(`Rollback failed: ${rbErr}`);
    }
  }

  // Cleanup worktree on failure if configured
  if (worktreePath && cleanupOnFailure) {
    try {
      await removeWorktree(gitConfig, worktreePath, { cwd: projectRoot, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  // Cleanup orphaned branch on failure if configured
  if (branchName && cleanupOnFailure) {
    try {
      await runCli(gitConfig.gitPath, ["branch", "-D", branchName], { cwd: projectRoot });
      logger.info(`Cleaned up branch: ${branchName}`);
    } catch {
      // ignore — branch may not exist
    }
  }

  return rollbackInfo ? `${errMsg}. ${rollbackInfo}` : errMsg;
}

