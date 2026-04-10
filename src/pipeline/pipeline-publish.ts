import { createDraftPR, enableAutoMerge, closeIssue, addIssueComment } from "../github/pr-creator.js";
import { parseDependencies, checkDependencyPRsMerged } from "../queue/dependency-resolver.js";
import { pushBranch, checkConflicts, attemptRebase } from "../git/branch-manager.js";
import { removeWorktree } from "../git/worktree-manager.js";
import { formatResult, printResult } from "./result-reporter.js";
import { validateBeforePush } from "../safety/safety-checker.js";
import { rollbackToCheckpoint as doRollback } from "../safety/rollback-manager.js";
import { runCli } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { getLogger } from "../utils/logger.js";
import type { PublishPhaseContext, CleanupContext, FailureHandlerContext } from "../types/pipeline.js";
import { removeCheckpoint } from "./checkpoint.js";
import { PatternStore } from "../learning/pattern-store.js";
import { PROGRESS_PR_CREATED } from "./progress-tracker.js";
import { saveResult } from "./pipeline-validation.js";

const logger = getLogger();

/**
 * Push branch, create PR, enable auto-merge, and close issue
 */
export async function pushAndCreatePR(context: PublishPhaseContext): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
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

            // Add issue comment about rebase failure
            const conflictFilesList = conflictCheck.conflictFiles.length > 0
              ? conflictCheck.conflictFiles.map(f => `- \`${f}\``).join("\n")
              : "- (unknown files)";

            const commentBody = `## 🔄 자동 Rebase 실패

브랜치를 \`${baseBranch}\`에 자동으로 rebase하는데 실패했습니다. 다음 파일들에서 충돌이 감지되었습니다:

${conflictFilesList}

**수동 해결 방법:**
1. 로컬에서 브랜치를 체크아웃: \`git checkout ${branchName}\`
2. 수동으로 rebase: \`git rebase ${baseBranch}\`
3. 충돌 해결 후 커밋: \`git add . && git commit\`
4. 강제 푸시: \`git push --force-with-lease\`

PR이 생성되었지만 충돌이 해결될 때까지 머지할 수 없습니다.`;

            try {
              await addIssueComment(
                issueNumber,
                repo,
                commentBody,
                { ghPath: projectConfig.commands.ghCli.path, dryRun }
              );
              jl?.log(`충돌 알림 코멘트 추가됨`);
            } catch (commentErr: unknown) {
              logger.warn(`Failed to add issue comment: ${getErrorMessage(commentErr)}`);
              jl?.log(`이슈 코멘트 실패 (경고만, 계속 진행)`);
            }

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
        totalUsage: context.totalUsage,
      },
      { cwd: worktreePath, promptsDir, dryRun }
    );

    if (!prResult) {
      throw new Error("Failed to create PR");
    }

    const prUrl = prResult.url;
    logger.info(`[DRAFT_PR_CREATED] PR: ${prUrl}`);
    jl?.log(`PR: ${prUrl}`);

    // === Check dependency PRs before enabling auto-merge ===
    if (projectConfig.pr.autoMerge && prResult.number > 0) {
      jl?.setStep("의존성 PR 머지 상태 확인 중...");

      // Parse dependencies from issue body
      const dependencies = parseDependencies(issue.body || "");

      const enableAutoMergeHelper = async (logMsg?: string) => {
        jl?.setStep("Auto-merge 설정 중...");
        const merged = await enableAutoMerge(
          prResult.number,
          repo,
          projectConfig.pr.mergeMethod,
          { ghPath: projectConfig.commands.ghCli.path, dryRun, isDraft: projectConfig.pr.draft, deleteBranch: projectConfig.pr.deleteBranch ?? false }
        );
        if (merged) {
          jl?.log(`Auto-merge 활성화 (${projectConfig.pr.mergeMethod}${logMsg ? `, ${logMsg}` : ""})`);
        } else {
          jl?.log(`Auto-merge 활성화 실패 (경고만, 계속 진행)`);
        }
      };

      if (dependencies.length > 0) {
        try {
          const dependencyCheck = await checkDependencyPRsMerged(
            dependencies,
            repo,
            projectConfig.commands.ghCli.path
          );

          if (!dependencyCheck.merged) {
            // Skip auto-merge and add issue comment
            const parts = [];
            if (dependencyCheck.unmerged.length > 0) {
              parts.push(`**미머지된 의존성 PR:**\n${dependencyCheck.unmerged.map(n => `- #${n}`).join("\n")}`);
            }
            if (dependencyCheck.notFound.length > 0) {
              parts.push(`**PR을 찾을 수 없는 의존성:**\n${dependencyCheck.notFound.map(n => `- #${n} (PR을 찾을 수 없음)`).join("\n")}`);
            }

            const commentBody = `## ⏳ Auto-merge 대기 중

의존성 이슈들의 PR이 아직 머지되지 않아 auto-merge를 활성화하지 않았습니다.

${parts.join("\n\n")}

모든 의존성 PR이 머지되면 수동으로 auto-merge를 활성화하거나 PR을 직접 머지해주세요.

\`\`\`bash
gh pr merge ${prResult.number} --${projectConfig.pr.mergeMethod}
\`\`\``;

            try {
              await addIssueComment(
                issueNumber,
                repo,
                commentBody,
                { ghPath: projectConfig.commands.ghCli.path, dryRun }
              );
              jl?.log(`의존성 PR 미머지로 auto-merge 스킵, 코멘트 추가됨`);
            } catch (commentErr: unknown) {
              logger.warn(`Failed to add dependency comment: ${getErrorMessage(commentErr)}`);
              jl?.log(`의존성 코멘트 추가 실패 (경고만, 계속 진행)`);
            }

            logger.info(`Auto-merge skipped due to unmerged dependencies: ${dependencyCheck.unmerged.concat(dependencyCheck.notFound).join(", ")}`);
          } else {
            // All dependencies merged, proceed with auto-merge
            await enableAutoMergeHelper("의존성 확인 완료");
          }
        } catch (depErr: unknown) {
          // Fallback: enable auto-merge anyway if dependency check fails
          logger.warn(`Dependency check failed, proceeding with auto-merge: ${getErrorMessage(depErr)}`);
          jl?.log(`의존성 확인 실패, auto-merge 계속 진행`);
          await enableAutoMergeHelper();
        }
      } else {
        // No dependencies, proceed with auto-merge
        await enableAutoMergeHelper();
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
    } catch (err: unknown) {
      logger.warn(`Failed to close issue #${issueNumber}: ${getErrorMessage(err)}`);
      jl?.log(`이슈 닫기 실패 (경고만, 계속 진행)`);
    }

    jl?.setStep("완료");

    return { success: true, prUrl, prNumber: prResult.number };
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
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
    } catch (err: unknown) {
      logger.warn(`Failed to cleanup worktree: ${getErrorMessage(err)}`);
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

  const errMsg = getErrorMessage(error);
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
    } catch (rbErr: unknown) {
      logger.warn(`Rollback failed: ${getErrorMessage(rbErr)}`);
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

