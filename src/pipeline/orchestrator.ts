import { resolve } from "path";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { createDraftPR, enableAutoMerge, closeIssue } from "../github/pr-creator.js";
import { syncBaseBranch, createWorkBranch, pushBranch, checkConflicts, attemptRebase } from "../git/branch-manager.js";
import { createWorktree, removeWorktree } from "../git/worktree-manager.js";
import { runCoreLoop } from "./core-loop.js";
import { runClaude } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";
import { installDependencies } from "./dependency-installer.js";
import { formatResult, printResult } from "./result-reporter.js";
import type { PipelineReport } from "./result-reporter.js";
import { runFinalValidation } from "./final-validator.js";
import { runReviews } from "../review/review-orchestrator.js";
import { runAnalyst } from "../review/analyst-runner.js";
import { runSimplify } from "../review/simplify-runner.js";
import { runReviewPhase, runSimplifyPhase, buildReviewVars } from "./pipeline-review.js";
import type { ReviewContext, SimplifyContext } from "./pipeline-review.js";
import { getDiffContent } from "../git/diff-collector.js";
import { validateBeforePush } from "../safety/safety-checker.js";
import { createCheckpoint, rollbackToCheckpoint as doRollback } from "../safety/rollback-manager.js";
import { PipelineTimer } from "../safety/timeout-manager.js";
import { createSlugWithFallback } from "../utils/slug.js";
import { errorMessage } from "../types/errors.js";
import { getLogger } from "../utils/logger.js";
import type { AQConfig } from "../types/config.js";
import type { PipelineState } from "../types/pipeline.js";
import type { ReviewPipelineResult, AnalystResult, ReviewFixAttempt } from "../types/review.js";
import { getModePreset } from "../config/mode-presets.js";
import type { JobLogger } from "../queue/job-logger.js";
import { PatternStore } from "../learning/pattern-store.js";
import { removeCheckpoint } from "./checkpoint.js";
import type { PipelineCheckpoint } from "./checkpoint.js";
import { withRepoLock } from "../git/repo-lock.js";
import { loadSkills, formatSkillsForPrompt } from "../config/skill-loader.js";
import { setupGitEnvironment, prepareWorkEnvironment } from "./pipeline-git-setup.js";
import { resolveResolvedProject, checkDuplicatePR, fetchAndValidateIssue } from "./pipeline-setup.js";
import { resolveProject } from "../config/project-resolver.js";
import { runCli } from "../utils/cli-runner.js";
import {
  PROGRESS_ISSUE_VALIDATED,
  PROGRESS_PLAN_GENERATED,
  PROGRESS_REVIEW_START,
  PROGRESS_SIMPLIFY_START,
  PROGRESS_VALIDATION_START,
  PROGRESS_PR_CREATED,
  PROGRESS_DONE,
} from "./progress-tracker.js";
import {
  type OrchestratorInput,
  type OrchestratorResult,
  STATE_ORDER,
  isPastState,
  saveResult,
} from "./pipeline-context.js";


export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { issueNumber, repo, config, aqRoot } = input;
  const logger = getLogger();
  const jl = input.jobLogger;
  const startTime = Date.now();
  const resumeFrom = input.resumeFrom;
  let state: PipelineState = resumeFrom?.state ?? "RECEIVED";
  let worktreePath: string | undefined = resumeFrom?.worktreePath;
  let branchName: string | undefined = resumeFrom?.branchName;
  let projectRoot: string = input.projectRoot ?? resumeFrom?.projectRoot ?? "";
  let gitConfig = config.git;
  let promptsDir: string = resolve(projectRoot, "prompts");
  let rollbackHash: string | undefined;
  let rollbackStrategy: "none" | "all" | "failed-only" = "none";

  if (resumeFrom) {
    logger.info(`Resuming pipeline from state: ${resumeFrom.state}`);
    const { progressForState } = await import("./progress-tracker.js");
    jl?.setProgress(progressForState(resumeFrom.state));
  }

  try {
    // === Phase 1: Resolve project setup ===
    const setupResult = resolveResolvedProject(
      repo,
      config,
      input.projectRoot,
      resumeFrom?.projectRoot,
      aqRoot
    );
    projectRoot = setupResult.projectRoot;
    promptsDir = setupResult.promptsDir;
    gitConfig = setupResult.gitConfig;

    // Start pipeline-level timer
    const timer = new PipelineTimer(config.safety.maxTotalDurationMs);

    const dataDir = resolve(aqRoot ?? projectRoot, "data");
    const project = resolveProject(repo, config);

    // === Phase 2: Check duplicate PR ===
    const duplicateResult = await checkDuplicatePR(
      repo,
      issueNumber,
      project,
      input.isRetry ?? false,
      jl,
      dataDir
    );

    if (duplicateResult.hasDuplicatePR) {
      return { success: true, state: "DONE", prUrl: duplicateResult.prUrl };
    }

    // === Phase 3: Fetch and validate issue ===
    const issueResult = await fetchAndValidateIssue(
      repo,
      issueNumber,
      project,
      state,
      timer,
      jl,
      resumeFrom?.mode,
      {
        projectRoot,
        worktreePath,
        branchName,
        dataDir,
      }
    );

    const { issue, checkpoint } = issueResult;
    let mode = issueResult.mode;
    state = "VALIDATED";
    let preset = getModePreset(mode);

    // === Setup Git Environment: VALIDATED → WORKTREE_CREATED ===
    const gitSetupResult = await setupGitEnvironment({
      issueNumber,
      issueTitle: issue.title,
      repo,
      projectRoot,
      gitConfig,
      worktreeConfig: config.worktree,
      state,
      isRetry: input.isRetry || false,
      jl,
    });

    branchName = gitSetupResult.branchName;
    worktreePath = gitSetupResult.worktreePath;
    state = gitSetupResult.state;

    checkpoint({ branchName, worktreePath });

    // === Prepare Work Environment ===
    rollbackStrategy = project.safety.rollbackStrategy;
    let envPrepResult: any;
    if (worktreePath) {
      envPrepResult = await prepareWorkEnvironment({
        projectRoot,
        worktreePath,
        gitConfig,
        project,
        rollbackStrategy,
        jl,
      });
    } else {
      envPrepResult = {
        rollbackHash: undefined,
        projectConventions: "",
        skillsContext: "",
        repoStructure: "",
      };
    }

    rollbackHash = envPrepResult.rollbackHash;
    const projectConventions = envPrepResult.projectConventions;
    const skillsContext = envPrepResult.skillsContext;
    const repoStructure = envPrepResult.repoStructure;

    // === WORKTREE_CREATED → PLAN_GENERATED → PHASE_IN_PROGRESS ===
    jl?.setStep("Plan 생성 중...");
    timer.assertNotExpired("plan-generation");
    const [owner, name] = repo.split("/");
    // Build a config with project-specific commands for core-loop
    const projectConfig = { ...config, commands: project.commands, safety: project.safety };
    const patternStore = new PatternStore(dataDir);

    // === WORKTREE_CREATED → PLAN_GENERATED → PHASE_IN_PROGRESS ===
    const coreResult = await runCoreLoop({
      issue,
      repo: { owner, name },
      branch: { base: project.baseBranch, work: branchName! },
      repoStructure: repoStructure,
      config: projectConfig,
      promptsDir,
      cwd: worktreePath!,
      modeHint: preset.planHint,
      projectConventions,
      skillsContext,
      dataDir,
      jobLogger: jl,
      previousPhaseResults: resumeFrom?.phaseResults?.map(r => ({
        phaseIndex: r.phaseIndex ?? 0,
        phaseName: r.phaseName ?? "",
        success: r.success ?? false,
        commitHash: r.commitHash,
        error: r.error,
        durationMs: r.durationMs ?? 0,
      })),
    });

    // Re-evaluate mode from Claude's Plan judgment (Plan.mode overrides if not set by label)
    if (coreResult.plan.mode && !issue.labels.some(l => l.startsWith("aq-mode:"))) {
      const planMode = coreResult.plan.mode;
      if (planMode !== mode) {
        mode = planMode;
        preset = getModePreset(mode);
        logger.info(`Pipeline mode updated by Plan: ${mode}`);
        jl?.log(`모드 변경 (Claude 판단): ${mode}`);
      }
    }

    jl?.log(`Plan: ${coreResult.plan.phases.length}개 phase`);
    jl?.setPhaseResults(coreResult.phaseResults.map(r => ({
      name: r.phaseName,
      success: r.success,
      commit: r.commitHash?.slice(0, 8),
      durationMs: r.durationMs,
      error: r.error,
    })));

    if (!coreResult.success) {
      state = "FAILED";
      const failedPhase = coreResult.phaseResults.find(r => !r.success);
      jl?.log(`실패: ${failedPhase?.error ?? "Phase execution failed"}`);
      jl?.setStep("실패");
      // Save checkpoint so pipeline can be resumed
      checkpoint({ state: "PLAN_GENERATED", plan: coreResult.plan, phaseResults: coreResult.phaseResults });
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
      } catch { /* non-fatal */ }

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
      return { success: false, state, error: rollbackInfo ? `Phase execution failed. ${rollbackInfo}` : "Phase execution failed", report };
    }

    state = "PLAN_GENERATED"; // core-loop completed all phases
    jl?.setProgress(PROGRESS_REVIEW_START);

    checkpoint({ plan: coreResult.plan, phaseResults: coreResult.phaseResults });

    // === REVIEWING: analyst + 3-round review ===
    jl?.setProgress(PROGRESS_REVIEW_START);

    const reviewContext: ReviewContext = {
      issue,
      coreResult,
      gitConfig,
      project,
      worktreePath: worktreePath!,
      promptsDir,
      skillsContext,
      jl,
      timer,
      checkpoint
    };

    const reviewResult = await runReviewPhase(reviewContext, preset, state, isPastState);

    if (!reviewResult.success) {
      const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
      printResult(report);
      saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
      return {
        success: false,
        state: "FAILED",
        error: reviewResult.error,
        report
      };
    }

    const reviewVariables = reviewResult.reviewVariables;
    state = "REVIEWING";

    // === SIMPLIFYING ===
    if (reviewVariables) {
      const simplifyContext: SimplifyContext = {
        project,
        worktreePath: worktreePath!,
        promptsDir,
        reviewVariables,
        gitConfig,
        jl,
        timer,
        checkpoint
      };

      const simplifyResult = await runSimplifyPhase(simplifyContext, preset, state, isPastState);

      if (!simplifyResult.success) {
        const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
        printResult(report);
        saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
        return {
          success: false,
          state: "FAILED",
          error: simplifyResult.error,
          report
        };
      }

      state = "SIMPLIFYING";
    }

    // === FINAL_VALIDATING ===
    if (!preset.skipFinalValidation) {
      if (isPastState(state, "FINAL_VALIDATING")) {
        logger.info(`[SKIP] → FINAL_VALIDATING (already done)`);
      } else {
        timer.assertNotExpired("final-validation");
        state = "FINAL_VALIDATING";
        logger.info("[FINAL_VALIDATING] Running final validation...");
        jl?.setStep("최종 검증 중...");
        jl?.setProgress(PROGRESS_VALIDATION_START);
        let validation = await runFinalValidation(project.commands, { cwd: worktreePath! }, gitConfig.gitPath);
        for (const check of validation.checks) {
          jl?.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}`);
        }
        if (!validation.success) {
          const maxRetries = project.safety.maxRetries;
          let retrySuccess = false;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const failedChecks = validation.checks.filter(c => !c.passed);
            const failedNames = failedChecks.map(c => c.name).join(", ");
            logger.info(`[FINAL_VALIDATING] Retry ${attempt}/${maxRetries} — fixing: ${failedNames}`);
            jl?.log(`검증 실패 수정 시도 ${attempt}/${maxRetries}: ${failedNames}`);
            jl?.setStep(`검증 오류 수정 중 (${attempt}/${maxRetries})...`);

            const errorDetails = failedChecks
              .map(c => `=== ${c.name} ===\n${c.output ?? "(no output)"}`)
              .join("\n\n");

            const fixPrompt = [
              "The following validation checks failed. Fix the errors only — do not add new features or refactor unrelated code.",
              "",
              errorDetails,
            ].join("\n");

            const claudeConfig = configForTask(project.commands.claudeCli, "fallback");
            await runClaude({
              prompt: fixPrompt,
              cwd: worktreePath!,
              config: claudeConfig,
            });

            await autoCommitIfDirty(gitConfig.gitPath, worktreePath!, `fix: validation 오류 수정 (retry ${attempt})`);

            validation = await runFinalValidation(project.commands, { cwd: worktreePath! }, gitConfig.gitPath);
            for (const check of validation.checks) {
              jl?.log(`${check.passed ? "PASS" : "FAIL"} ${check.name} (retry ${attempt})`);
            }

            if (validation.success) {
              logger.info(`[FINAL_VALIDATING] Passed after retry ${attempt}`);
              jl?.log(`검증 통과 (retry ${attempt})`);
              retrySuccess = true;
              break;
            }
          }

          if (!retrySuccess) {
            const failedChecks = validation.checks.filter(c => !c.passed).map(c => c.name).join(", ");
            logger.error(`[FINAL_VALIDATING] Failed after ${maxRetries} retries: ${failedChecks}`);
            jl?.log(`실패: Final validation failed after ${maxRetries} retries: ${failedChecks}`);
            jl?.setStep("실패");
            checkpoint({ plan: coreResult.plan, phaseResults: coreResult.phaseResults });
            const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
            printResult(report);
            saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
            return { success: false, state: "FAILED", error: `Final validation failed after ${maxRetries} retries: ${failedChecks}`, report };
          }
        }

        checkpoint({ plan: coreResult.plan, phaseResults: coreResult.phaseResults });
      }
    }

    // === Safety: validate before push (sensitive paths, change limits, base branch) ===
    await validateBeforePush({
      safetyConfig: project.safety,
      gitConfig,
      cwd: worktreePath!,
      baseBranch: project.baseBranch,
    });

    // === Conflict detection before push ===
    {
      // Fetch latest base branch to ensure we're comparing against current remote
      const fetchResult = await runCli(
        gitConfig.gitPath,
        ["fetch", gitConfig.remoteAlias, project.baseBranch],
        { cwd: worktreePath! }
      );
      if (fetchResult.exitCode !== 0) {
        logger.warn(`Failed to fetch ${project.baseBranch} for conflict check: ${fetchResult.stderr}`);
      } else {
        const conflictCheck = await checkConflicts(gitConfig, project.baseBranch, { cwd: worktreePath! });
        if (conflictCheck.hasConflicts) {
          logger.warn(`Conflicts detected with ${project.baseBranch}: ${conflictCheck.conflictFiles.join(", ") || "(unknown files)"}`);
          jl?.log(`충돌 감지됨, rebase 시도 중...`);
          const rebaseResult = await attemptRebase(gitConfig, project.baseBranch, { cwd: worktreePath! });
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
    timer.assertNotExpired("push");
    jl?.setStep("Push 중...");
    if (!config.general.dryRun) {
      await pushBranch(gitConfig, branchName!, { cwd: worktreePath! });
    }

    // === Create Draft PR ===
    state = "DRAFT_PR_CREATED";
    jl?.setProgress(PROGRESS_PR_CREATED);
    const prResult = await createDraftPR(
      project.pr,
      project.commands.ghCli,
      {
        issueNumber,
        issueTitle: issue.title,
        repo,
        plan: coreResult.plan,
        phaseResults: coreResult.phaseResults,
        branchName: branchName!,
        baseBranch: project.baseBranch,
      },
      { cwd: worktreePath!, promptsDir, dryRun: config.general.dryRun }
    );
    const prUrl = prResult.url;
    logger.info(`[DRAFT_PR_CREATED] PR: ${prUrl}`);
    jl?.log(`PR: ${prUrl}`);

    // === Enable auto-merge if configured ===
    if (project.pr.autoMerge && prResult.number > 0) {
      jl?.setStep("Auto-merge 설정 중...");
      const merged = await enableAutoMerge(
        prResult.number,
        repo,
        project.pr.mergeMethod,
        { ghPath: project.commands.ghCli.path, dryRun: config.general.dryRun, isDraft: project.pr.draft }
      );
      if (merged) {
        jl?.log(`Auto-merge 활성화 (${project.pr.mergeMethod})`);
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
        { ghPath: project.commands.ghCli.path, dryRun: config.general.dryRun }
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

    // === Cleanup worktree on success ===
    if (config.worktree.cleanupOnSuccess && worktreePath) {
      try {
        await removeWorktree(gitConfig, worktreePath, { cwd: projectRoot });
        logger.info(`Worktree cleaned up`);
      } catch (e) {
        logger.warn(`Failed to cleanup worktree: ${e}`);
      }
    }

    state = "DONE";
    jl?.setProgress(PROGRESS_DONE);
    // Record success pattern
    try {
      patternStore.add({
        issueNumber,
        repo,
        type: "success",
        tags: [],
      });
    } catch { /* non-fatal */ }
    const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime, prUrl);
    printResult(report);
    saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
    removeCheckpoint(dataDir, issueNumber);

    return { success: true, state, prUrl, report };

  } catch (error) {
    const errMsg = errorMessage(error);
    logger.error(`[FAILED] Pipeline failed at state ${state}: ${errMsg}`);
    jl?.log(`실패: ${errMsg}`);
    jl?.setStep("실패");

    // === Rollback on exception ===
    let rollbackInfo: string | undefined;
    const exceptionRollbackStrategy = rollbackStrategy;
    if (worktreePath && exceptionRollbackStrategy !== "none" && rollbackHash) {
      try {
        await doRollback(rollbackHash, { cwd: worktreePath, gitPath: gitConfig.gitPath });
        rollbackInfo = `Rolled back to ${rollbackHash.slice(0, 8)} (strategy: ${exceptionRollbackStrategy})`;
        logger.info(rollbackInfo);
      } catch (rbErr) {
        logger.warn(`Rollback failed: ${rbErr}`);
      }
    }

    // Cleanup worktree on failure if configured
    if (worktreePath && config.worktree.cleanupOnFailure) {
      try {
        await removeWorktree(gitConfig, worktreePath, { cwd: projectRoot, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    // Cleanup orphaned branch on failure if configured
    if (branchName && config.worktree.cleanupOnFailure) {
      try {
        await runCli(gitConfig.gitPath, ["branch", "-D", branchName], { cwd: projectRoot });
        logger.info(`Cleaned up branch: ${branchName}`);
      } catch {
        // ignore — branch may not exist
      }
    }

    return { success: false, state: "FAILED", error: rollbackInfo ? `${errMsg}. ${rollbackInfo}` : errMsg };
  }
}
