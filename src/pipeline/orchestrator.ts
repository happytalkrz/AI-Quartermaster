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
import { handleCoreLoopFailure } from "./pipeline-error-handler.js";
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
  type PipelineRuntime,
  STATE_ORDER,
  isPastState,
  saveResult,
  initializePipelineState,
  transitionState,
} from "./pipeline-context.js";


export async function runPipeline(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { issueNumber, repo, config, aqRoot } = input;
  const logger = getLogger();
  const jl = input.jobLogger;
  const startTime = Date.now();

  // Initialize pipeline state
  const runtime = await initializePipelineState(input, config);

  // Extract runtime variables for compatibility
  let { state, worktreePath, branchName, projectRoot, gitConfig, promptsDir, rollbackHash, rollbackStrategy } = runtime;

  try {
    // === Phase 1: Resolve project setup ===
    const setupResult = resolveResolvedProject(
      repo,
      config,
      input.projectRoot,
      input.resumeFrom?.projectRoot,
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
      input.resumeFrom?.mode,
      {
        projectRoot,
        worktreePath,
        branchName,
        dataDir,
      }
    );

    const { issue, checkpoint } = issueResult;
    let mode = issueResult.mode;
    transitionState(runtime, "VALIDATED");
    state = runtime.state;
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

    transitionState(runtime, gitSetupResult.state, {
      branchName: gitSetupResult.branchName,
      worktreePath: gitSetupResult.worktreePath
    });
    branchName = runtime.branchName;
    worktreePath = runtime.worktreePath;
    state = runtime.state;

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
      previousPhaseResults: input.resumeFrom?.phaseResults?.map(r => ({
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
      const failureResult = await handleCoreLoopFailure({
        issueNumber,
        repo,
        coreResult,
        worktreePath,
        rollbackHash,
        rollbackStrategy,
        gitConfig,
        startTime,
        config,
        aqRoot: aqRoot ?? projectRoot,
        projectRoot,
        dataDir,
        patternStore,
        jl,
        checkpoint,
      });
      transitionState(runtime, "FAILED");
      return failureResult;
    }

    transitionState(runtime, "PLAN_GENERATED"); // core-loop completed all phases
    state = runtime.state;
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
    transitionState(runtime, "REVIEWING");
    state = runtime.state;

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

      transitionState(runtime, "SIMPLIFYING");
      state = runtime.state;
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
      transitionState(runtime, "FINAL_VALIDATING");
      state = runtime.state;
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
    transitionState(runtime, "DRAFT_PR_CREATED");
    state = runtime.state;

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

    transitionState(runtime, "DONE");
    state = runtime.state;
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
