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
import { runValidationPhase } from "./pipeline-validation.js";
import { pushAndCreatePR, cleanupOnSuccess, handlePipelineFailure } from "./pipeline-publish.js";
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
    const validationContext = {
      commands: {
        claudeCli: project.commands.claudeCli,
      },
      cwd: worktreePath!,
      gitPath: gitConfig.gitPath,
      maxRetries: project.safety.maxRetries,
      plan: coreResult.plan,
      phaseResults: coreResult.phaseResults,
      jl,
    };

    const validationResult = await runValidationPhase(
      validationContext,
      timer,
      (checkState: string) => isPastState(state, checkState as PipelineState),
      preset.skipFinalValidation,
      (overrides?: any) => checkpoint(overrides || { plan: coreResult.plan, phaseResults: coreResult.phaseResults }),
      issueNumber,
      repo,
      startTime,
      config,
      project.commands,
      aqRoot,
      projectRoot
    );

    if (!validationResult.success) {
      return { success: false, state: "FAILED", error: validationResult.error, report: validationResult.report };
    }

    if (!preset.skipFinalValidation && !isPastState(state, "FINAL_VALIDATING")) {
      state = "FINAL_VALIDATING";
    }

    // === Push branch, create PR, and handle post-PR tasks ===
    timer.assertNotExpired("push");

    const publishContext = {
      issueNumber,
      repo,
      issue,
      plan: coreResult.plan,
      phaseResults: coreResult.phaseResults,
      branchName: branchName!,
      baseBranch: project.baseBranch,
      worktreePath: worktreePath!,
      gitConfig,
      projectConfig: project,
      promptsDir,
      dryRun: config.general.dryRun,
      jl,
    };

    const publishResult = await pushAndCreatePR(publishContext);

    if (!publishResult.success) {
      return { success: false, state: "FAILED", error: publishResult.error };
    }

    const prUrl = publishResult.prUrl;
    state = "DRAFT_PR_CREATED";

    // === Cleanup on success and finalize ===
    const cleanupContext = {
      worktreePath,
      gitConfig,
      projectRoot,
      cleanupOnSuccess: config.worktree.cleanupOnSuccess,
      cleanupOnFailure: config.worktree.cleanupOnFailure,
      issueNumber,
      repo,
      plan: coreResult.plan,
      phaseResults: coreResult.phaseResults,
      startTime,
      prUrl,
      config,
      aqRoot,
      dataDir,
    };

    await cleanupOnSuccess(cleanupContext);

    state = "DONE";
    jl?.setProgress(PROGRESS_DONE);

    return { success: true, state, prUrl, report: formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime, prUrl) };

  } catch (error) {
    const failureContext = {
      error,
      state,
      worktreePath,
      branchName,
      rollbackHash,
      rollbackStrategy,
      gitConfig,
      projectRoot,
      cleanupOnFailure: config.worktree.cleanupOnFailure,
      jl,
    };

    const finalErrorMessage = await handlePipelineFailure(failureContext);

    return { success: false, state: "FAILED", error: finalErrorMessage };
  }
}
