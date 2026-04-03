import { resolve } from "path";
import { runCoreLoop } from "./core-loop.js";
import { getModePreset } from "../config/mode-presets.js";
import { resolveProject } from "../config/project-resolver.js";
import { PatternStore } from "../learning/pattern-store.js";
import { getLogger } from "../utils/logger.js";
import { handleCoreLoopFailure } from "./pipeline-error-handler.js";
import { runReviewPhase, runSimplifyPhase, type ReviewContext, type SimplifyContext } from "./pipeline-review.js";
import { runValidationPhase } from "./pipeline-validation.js";
import { pushAndCreatePR, cleanupOnSuccess } from "./pipeline-publish.js";
import { setupGitEnvironment, prepareWorkEnvironment } from "./pipeline-git-setup.js";
import { resolveResolvedProject, checkDuplicatePR, fetchAndValidateIssue } from "./pipeline-setup.js";
import { PipelineTimer } from "../safety/timeout-manager.js";
import { formatResult } from "./result-reporter.js";
import { saveResult, transitionState, isPastState, type PipelineRuntime } from "./pipeline-context.js";
import {
  PROGRESS_REVIEW_START,
  PROGRESS_DONE
} from "./progress-tracker.js";
import type { AQConfig, PipelineMode } from "../types/config.js";
import type { OrchestratorInput } from "./pipeline-context.js";
import type { CoreLoopResult } from "./core-loop.js";

const logger = getLogger();

export interface InitialSetupResult {
  projectRoot: string;
  promptsDir: string;
  gitConfig: any;
  project: any;
  dataDir: string;
  timer: PipelineTimer;
  duplicatePRUrl?: string;
  issue?: any;
  mode?: PipelineMode;
  checkpoint?: (overrides?: any) => void;
}

export interface EnvironmentSetupResult {
  projectConventions: string;
  skillsContext: string;
  repoStructure: string;
  rollbackHash?: string;
}

export interface CoreLoopExecutionResult {
  coreResult: CoreLoopResult;
  preset: any;
  mode: PipelineMode;
}

export interface PostProcessingContext {
  issue: any;
  coreResult: CoreLoopResult;
  gitConfig: any;
  project: any;
  worktreePath: string;
  promptsDir: string;
  skillsContext: string;
  preset: any;
  timer: PipelineTimer;
  checkpoint: (overrides?: any) => void;
}

/**
 * Execute initial setup phases: project resolution, duplicate PR check, issue validation
 */
export async function executeInitialSetupPhases(
  input: OrchestratorInput,
  runtime: PipelineRuntime,
  config: AQConfig,
  aqRoot?: string
): Promise<InitialSetupResult> {
  const { issueNumber, repo } = input;
  const jl = input.jobLogger;

  // Phase 1: Resolve project setup
  const setupResult = resolveResolvedProject(
    repo,
    config,
    input.projectRoot,
    input.resumeFrom?.projectRoot,
    aqRoot
  );

  const { projectRoot, promptsDir, gitConfig } = setupResult;

  // Start pipeline-level timer
  const timer = new PipelineTimer(config.safety.maxTotalDurationMs);
  const dataDir = resolve(aqRoot ?? projectRoot, "data");
  const project = resolveProject(repo, config);

  // Phase 2: Check duplicate PR
  const duplicateResult = await checkDuplicatePR(
    repo,
    issueNumber,
    project,
    input.isRetry ?? false,
    jl,
    dataDir
  );

  if (duplicateResult.hasDuplicatePR) {
    return {
      projectRoot,
      promptsDir,
      gitConfig,
      project,
      dataDir,
      timer,
      duplicatePRUrl: duplicateResult.prUrl
    };
  }

  // Phase 3: Fetch and validate issue
  const issueResult = await fetchAndValidateIssue(
    repo,
    issueNumber,
    project,
    runtime.state,
    timer,
    jl,
    input.resumeFrom?.mode,
    {
      projectRoot,
      worktreePath: runtime.worktreePath,
      branchName: runtime.branchName,
      dataDir,
    }
  );

  const { issue, checkpoint } = issueResult;
  const mode = issueResult.mode;
  transitionState(runtime, "VALIDATED");

  return {
    projectRoot,
    promptsDir,
    gitConfig,
    project,
    dataDir,
    timer,
    issue,
    mode,
    checkpoint
  };
}

/**
 * Execute environment setup: Git environment and work environment preparation
 */
export async function executeEnvironmentSetup(
  input: OrchestratorInput,
  runtime: PipelineRuntime,
  issue: any,
  project: any,
  gitConfig: any,
  projectRoot: string,
  config: AQConfig,
  checkpoint: (overrides?: any) => void
): Promise<EnvironmentSetupResult> {
  const { issueNumber, repo } = input;
  const jl = input.jobLogger;

  // Setup Git Environment
  const gitSetupResult = await setupGitEnvironment({
    issueNumber,
    issueTitle: issue.title,
    repo,
    projectRoot,
    gitConfig,
    worktreeConfig: config.worktree,
    state: runtime.state,
    isRetry: input.isRetry || false,
    jl,
  });

  transitionState(runtime, gitSetupResult.state, {
    branchName: gitSetupResult.branchName,
    worktreePath: gitSetupResult.worktreePath
  });

  checkpoint({
    branchName: runtime.branchName,
    worktreePath: runtime.worktreePath
  });

  // Prepare Work Environment
  const rollbackStrategy = project.safety.rollbackStrategy;
  let envPrepResult: any;

  if (runtime.worktreePath) {
    envPrepResult = await prepareWorkEnvironment({
      projectRoot,
      worktreePath: runtime.worktreePath,
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

  return {
    projectConventions: envPrepResult.projectConventions,
    skillsContext: envPrepResult.skillsContext,
    repoStructure: envPrepResult.repoStructure,
    rollbackHash: envPrepResult.rollbackHash,
  };
}

/**
 * Execute core loop phase: Plan generation and phase execution
 */
export async function executeCoreLoopPhase(
  input: OrchestratorInput,
  runtime: PipelineRuntime,
  issue: any,
  project: any,
  config: AQConfig,
  promptsDir: string,
  dataDir: string,
  envResult: EnvironmentSetupResult,
  timer: PipelineTimer,
  mode: PipelineMode
): Promise<CoreLoopExecutionResult> {
  const { repo } = input;
  const jl = input.jobLogger;

  jl?.setStep("Plan 생성 중...");
  timer.assertNotExpired("plan-generation");

  const [owner, name] = repo.split("/");
  const projectConfig = { ...config, commands: project.commands, safety: project.safety };
  const patternStore = new PatternStore(dataDir);
  const preset = getModePreset(mode);

  const coreResult = await runCoreLoop({
    issue,
    repo: { owner, name },
    branch: { base: project.baseBranch, work: runtime.branchName! },
    repoStructure: envResult.repoStructure,
    config: projectConfig,
    promptsDir,
    cwd: runtime.worktreePath!,
    modeHint: preset.planHint,
    projectConventions: envResult.projectConventions,
    skillsContext: envResult.skillsContext,
    dataDir,
    jobLogger: jl,
    progressCallback: input.progressCallback,
    previousPhaseResults: input.resumeFrom?.phaseResults?.map(r => ({
      phaseIndex: r.phaseIndex ?? 0,
      phaseName: r.phaseName ?? "",
      success: r.success ?? false,
      commitHash: r.commitHash,
      error: r.error,
      durationMs: r.durationMs ?? 0,
    })),
  });

  // Re-evaluate mode from Claude's Plan judgment
  let finalMode = mode;
  let finalPreset = preset;

  if (coreResult.plan.mode && !issue.labels.some((l: string) => l.startsWith("aq-mode:"))) {
    const planMode = coreResult.plan.mode;
    if (planMode !== mode) {
      finalMode = planMode;
      finalPreset = getModePreset(finalMode);
      logger.info(`Pipeline mode updated by Plan: ${finalMode}`);
      jl?.log(`모드 변경 (Claude 판단): ${finalMode}`);
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
      issueNumber: input.issueNumber,
      repo,
      coreResult,
      worktreePath: runtime.worktreePath,
      rollbackHash: envResult.rollbackHash,
      rollbackStrategy: project.safety.rollbackStrategy,
      gitConfig: runtime.gitConfig,
      startTime: Date.now(),
      config,
      aqRoot: input.aqRoot ?? runtime.projectRoot,
      projectRoot: runtime.projectRoot,
      dataDir,
      patternStore,
      jl,
      checkpoint: (overrides?: any) => {},
    });
    // Create an error that includes the failure result for proper reporting
    const errorWithReport = new Error(failureResult.error) as Error & { failureResult: typeof failureResult };
    errorWithReport.failureResult = failureResult;
    throw errorWithReport;
  }

  transitionState(runtime, "PLAN_GENERATED");

  return {
    coreResult,
    preset: finalPreset,
    mode: finalMode
  };
}

/**
 * Execute post-processing phases: Review, Simplify, Validation, Publish
 */
export async function executePostProcessingPhases(
  context: PostProcessingContext,
  runtime: PipelineRuntime,
  input: OrchestratorInput,
  config: AQConfig,
  startTime: number
): Promise<{ prUrl?: string; report: any }> {
  const { issue, coreResult, gitConfig, project, worktreePath, promptsDir, skillsContext, preset, timer, checkpoint } = context;
  const { issueNumber, repo, aqRoot } = input;
  const jl = input.jobLogger;

  jl?.setProgress(PROGRESS_REVIEW_START);

  // Review Phase
  const reviewContext: ReviewContext = {
    issue,
    coreResult,
    gitConfig,
    project,
    worktreePath,
    promptsDir,
    skillsContext,
    jl,
    timer,
    checkpoint
  };

  const reviewResult = await runReviewPhase(reviewContext, preset, runtime.state, isPastState);

  if (!reviewResult.success) {
    const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
    saveResult(config, aqRoot ?? runtime.projectRoot, issueNumber, report);
    throw new Error(reviewResult.error || "Review phase failed");
  }

  const reviewVariables = reviewResult.reviewVariables;
  transitionState(runtime, "REVIEWING");

  // Simplify Phase
  if (reviewVariables) {
    const simplifyContext: SimplifyContext = {
      project,
      worktreePath,
      promptsDir,
      reviewVariables,
      gitConfig,
      jl,
      timer,
      checkpoint
    };

    const simplifyResult = await runSimplifyPhase(simplifyContext, preset, runtime.state, isPastState);

    if (!simplifyResult.success) {
      const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
      saveResult(config, aqRoot ?? runtime.projectRoot, issueNumber, report);
      throw new Error(simplifyResult.error || "Simplify phase failed");
    }

    transitionState(runtime, "SIMPLIFYING");
  }

  // Validation Phase
  const validationContext = {
    commands: {
      claudeCli: project.commands.claudeCli,
    },
    cwd: worktreePath,
    gitPath: gitConfig.gitPath,
    maxRetries: project.safety.maxRetries,
    plan: coreResult.plan,
    phaseResults: coreResult.phaseResults,
    jl,
  };

  const validationResult = await runValidationPhase(
    validationContext,
    timer,
    (checkState: string) => isPastState(runtime.state, checkState as any),
    preset.skipFinalValidation,
    (overrides?: any) => checkpoint(overrides || { plan: coreResult.plan, phaseResults: coreResult.phaseResults }),
    issueNumber,
    repo,
    startTime,
    config,
    project.commands,
    aqRoot,
    runtime.projectRoot
  );

  if (!validationResult.success) {
    throw new Error(validationResult.error || "Validation phase failed");
  }

  if (!preset.skipFinalValidation && !isPastState(runtime.state, "FINAL_VALIDATING")) {
    transitionState(runtime, "FINAL_VALIDATING");
  }

  // Publish Phase
  timer.assertNotExpired("push");

  const publishContext = {
    issueNumber,
    repo,
    issue,
    plan: coreResult.plan,
    phaseResults: coreResult.phaseResults,
    branchName: runtime.branchName!,
    baseBranch: project.baseBranch,
    worktreePath,
    gitConfig,
    projectConfig: project,
    promptsDir,
    dryRun: config.general.dryRun,
    jl,
  };

  const publishResult = await pushAndCreatePR(publishContext);

  if (!publishResult.success) {
    throw new Error(publishResult.error || "Publish phase failed");
  }

  const prUrl = publishResult.prUrl;
  transitionState(runtime, "DRAFT_PR_CREATED");

  // Cleanup on success
  const cleanupContext = {
    worktreePath: runtime.worktreePath,
    gitConfig,
    projectRoot: runtime.projectRoot,
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
    dataDir: resolve(aqRoot ?? runtime.projectRoot, "data"),
  };

  await cleanupOnSuccess(cleanupContext);

  transitionState(runtime, "DONE");
  jl?.setProgress(PROGRESS_DONE);

  return {
    prUrl,
    report: formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime, prUrl)
  };
}