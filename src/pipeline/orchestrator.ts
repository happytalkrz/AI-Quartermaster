import { resolve } from "path";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { fetchIssue } from "../github/issue-fetcher.js";
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
import { getDiffContent } from "../git/diff-collector.js";
import { validateIssue, validateBeforePush } from "../safety/safety-checker.js";
import { createCheckpoint, rollbackToCheckpoint as doRollback } from "../safety/rollback-manager.js";
import { PipelineTimer } from "../safety/timeout-manager.js";
import { createSlugWithFallback } from "../utils/slug.js";
import { runCli } from "../utils/cli-runner.js";
import { errorMessage } from "../types/errors.js";
import { getLogger } from "../utils/logger.js";
import type { AQConfig } from "../types/config.js";
import type { PipelineState } from "../types/pipeline.js";
import type { ReviewPipelineResult, AnalystResult, ReviewFixAttempt } from "../types/review.js";
import { resolveProject } from "../config/project-resolver.js";
import { getModePreset, detectModeFromLabels } from "../config/mode-presets.js";
import type { JobLogger } from "../queue/job-logger.js";
import { PatternStore } from "../learning/pattern-store.js";
import { saveCheckpoint, removeCheckpoint } from "./checkpoint.js";
import type { PipelineCheckpoint } from "./checkpoint.js";
import { withRepoLock } from "../git/repo-lock.js";
import { loadSkills, formatSkillsForPrompt } from "../config/skill-loader.js";
import { runValidationPhase } from "./pipeline-validation.js";
import { pushAndCreatePR, cleanupOnSuccess, handlePipelineFailure } from "./pipeline-publish.js";
import {
  PROGRESS_ISSUE_VALIDATED,
  PROGRESS_PLAN_GENERATED,
  PROGRESS_REVIEW_START,
  PROGRESS_SIMPLIFY_START,
  PROGRESS_VALIDATION_START,
  PROGRESS_PR_CREATED,
  PROGRESS_DONE,
} from "./progress-tracker.js";

export interface OrchestratorInput {
  issueNumber: number;
  repo: string; // "owner/repo"
  config: AQConfig;
  projectRoot?: string;  // optional override; falls back to project config
  aqRoot?: string;       // AI Quartermaster root (where prompts/ lives)
  jobLogger?: JobLogger;
  resumeFrom?: PipelineCheckpoint;
  isRetry?: boolean;     // true if this is a retry of a previously failed job
}

const STATE_ORDER: PipelineState[] = [
  "RECEIVED",
  "VALIDATED",
  "BASE_SYNCED",
  "BRANCH_CREATED",
  "WORKTREE_CREATED",
  "PLAN_GENERATED",
  "REVIEWING",
  "SIMPLIFYING",
  "FINAL_VALIDATING",
  "DRAFT_PR_CREATED",
  "DONE",
];

function isPastState(checkpointState: PipelineState, current: PipelineState): boolean {
  const checkpointIdx = STATE_ORDER.indexOf(checkpointState);
  const currentIdx = STATE_ORDER.indexOf(current);
  // States not in STATE_ORDER (FAILED, PHASE_FAILED) return -1 → re-execute all stages
  if (checkpointIdx === -1 || currentIdx === -1) return false;
  return checkpointIdx > currentIdx;
}

export interface OrchestratorResult {
  success: boolean;
  state: PipelineState;
  prUrl?: string;
  report?: PipelineReport;
  error?: string;
}

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
    // Resolve per-project config (merges project overrides with global defaults)
    const project = resolveProject(repo, config);
    // Allow explicit --target override, otherwise use resolved project path
    projectRoot = input.projectRoot ?? resumeFrom?.projectRoot ?? project.path;
    promptsDir = resolve(aqRoot ?? projectRoot, "prompts");

    // Build a git config that reflects per-project branch settings
    gitConfig = {
      ...config.git,
      defaultBaseBranch: project.baseBranch,
      branchTemplate: project.branchTemplate,
    };

    // Start pipeline-level timer
    const timer = new PipelineTimer(config.safety.maxTotalDurationMs);

    const dataDir = resolve(aqRoot ?? projectRoot, "data");

    // Check if a PR already exists for this issue (prevents duplicate work)
    // Skip this check for retry jobs to allow re-execution of failed jobs
    if (!input.isRetry) {
      try {
        const prCheckResult = await runCli(
          project.commands.ghCli.path,
          ["pr", "list", "--repo", repo, "--search", `#${issueNumber} in:title`, "--json", "number,url", "--limit", "1"],
          { timeout: 10000 }
        );
        if (prCheckResult.exitCode === 0) {
          const prs = JSON.parse(prCheckResult.stdout);
          if (prs.length > 0) {
            logger.info(`[SKIP] Issue #${issueNumber} already has PR: ${prs[0].url} — marking as complete`);
            jl?.log(`이슈에 이미 PR이 존재합니다: ${prs[0].url}`);
            jl?.setProgress(PROGRESS_DONE);
            jl?.setStep("완료 (기존 PR)");
            removeCheckpoint(dataDir, issueNumber);
            return { success: true, state: "DONE", prUrl: prs[0].url };
          }
        }
      } catch {
        // non-fatal: continue pipeline if PR check fails
      }
    }

    // === RECEIVED → VALIDATED ===
    let issue: Awaited<ReturnType<typeof fetchIssue>>;
    if (isPastState(state, "VALIDATED")) {
      logger.info(`[SKIP] RECEIVED → VALIDATED (already done)`);
      // Still need to fetch issue for later stages
      issue = await fetchIssue(repo, issueNumber, {
        ghPath: project.commands.ghCli.path,
        timeout: project.commands.ghCli.timeout,
      });
    } else {
      logger.info(`[RECEIVED] Issue #${issueNumber} from ${repo}`);
      jl?.setStep("이슈 정보 가져오는 중...");

      timer.assertNotExpired("issue-fetch");
      issue = await fetchIssue(repo, issueNumber, {
        ghPath: project.commands.ghCli.path,
        timeout: project.commands.ghCli.timeout,
      });
      logger.info(`[VALIDATED] Issue: ${issue.title}`);
      jl?.log(`이슈: ${issue.title}`);
      state = "VALIDATED";
      jl?.setProgress(PROGRESS_ISSUE_VALIDATED);

      // === Safety: validate issue labels ===
      validateIssue(issue, project.safety);

      saveCheckpoint(dataDir, issueNumber, {
        issueNumber, repo, state, projectRoot,
        worktreePath, branchName, phaseResults: [], mode: "code", savedAt: new Date().toISOString(),
      });
    }

    // Determine initial pipeline mode: issue label > project config > default
    let mode = resumeFrom?.mode || detectModeFromLabels(issue.labels, project.mode ?? "code");
    let preset = getModePreset(mode);
    logger.info(`Pipeline mode (초기): ${mode}`);
    jl?.log(`모드: ${mode}`);

    const checkpoint = (overrides?: Partial<PipelineCheckpoint>) => {
      saveCheckpoint(dataDir, issueNumber, {
        issueNumber, repo, state, projectRoot,
        worktreePath, branchName, phaseResults: [],
        mode, savedAt: new Date().toISOString(),
        ...overrides,
      });
    };

    // === VALIDATED → BASE_SYNCED → BRANCH_CREATED → WORKTREE_CREATED ===
    // Serialize git operations per-repo to prevent concurrent branch/worktree conflicts
    await withRepoLock(repo, async () => {
      if (isPastState(state, "BASE_SYNCED")) {
        logger.info(`[SKIP] VALIDATED → BASE_SYNCED (already done)`);
      } else {
        await syncBaseBranch(gitConfig, { cwd: projectRoot });
        state = "BASE_SYNCED";
        logger.info(`[BASE_SYNCED] Base branch ${project.baseBranch} synced`);
        jl?.setStep("브랜치 생성 중...");

        checkpoint();
      }

      // === BASE_SYNCED → BRANCH_CREATED ===
      if (isPastState(state, "BRANCH_CREATED")) {
        logger.info(`[SKIP] BASE_SYNCED → BRANCH_CREATED (already done, branch: ${branchName})`);
      } else {
        const branchInfo = await createWorkBranch(
          gitConfig,
          issueNumber,
          issue.title,
          { cwd: projectRoot }
        );
        branchName = branchInfo.workBranch;
        state = "BRANCH_CREATED";
        logger.info(`[BRANCH_CREATED] Branch: ${branchName}`);
        jl?.log(`브랜치: ${branchName}`);

        checkpoint();
      }

      // === BRANCH_CREATED → WORKTREE_CREATED ===
      // For retry jobs, clean up existing worktree to remove dirty state from previous failed attempts
      if (input.isRetry && worktreePath && existsSync(worktreePath)) {
        jl?.log("재시도 작업 - 기존 worktree 정리 시도 중...");

        try {
          await removeWorktree(gitConfig, worktreePath, { cwd: projectRoot, force: true });
          logger.info(`[RETRY] Removed worktree: ${worktreePath}`);
          jl?.log("재시도 작업 - 기존 worktree 정리 완료");
        } catch (e) {
          logger.warn(`[RETRY] Primary cleanup failed: ${e}`);
          try {
            await runCli(gitConfig.gitPath, ["worktree", "prune"], { cwd: projectRoot });
            logger.info(`[RETRY] Pruned stale entries`);
          } catch (pruneError) {
            logger.warn(`[RETRY] Prune failed: ${pruneError}`);
          }
          logger.warn(`[RETRY] Cleanup failed; continuing (branch-manager handles full cleanup)`);
          jl?.log("워크트리 정리 실패했지만 계속 진행 (branch-manager에서 완전 정리 예정)");
        }

        worktreePath = undefined;
        state = "BRANCH_CREATED";
      }

      if (isPastState(state, "WORKTREE_CREATED") && !input.isRetry) {
        logger.info(`[SKIP] BRANCH_CREATED → WORKTREE_CREATED (already done, worktree: ${worktreePath})`);
        // Verify worktree still exists
        if (worktreePath && !existsSync(worktreePath)) {
          throw new Error(`Resume failed: worktree path no longer exists: ${worktreePath}`);
        }
      } else {
        const slug = createSlugWithFallback(issue.title);
        const worktreeInfo = await createWorktree(
          gitConfig,
          config.worktree,
          branchName!,
          issueNumber,
          slug,
          { cwd: projectRoot }
        );
        worktreePath = worktreeInfo.path;
        state = "WORKTREE_CREATED";
        logger.info(`[WORKTREE_CREATED] Worktree: ${worktreePath}`);

        checkpoint();
      }
    });

    // === Create rollback checkpoint (before any phase commits) ===
    rollbackStrategy = project.safety.rollbackStrategy;
    if (rollbackStrategy !== "none" && worktreePath) {
      try {
        const hash = await createCheckpoint({ cwd: worktreePath, gitPath: gitConfig.gitPath });
        rollbackHash = hash;
        logger.info(`Rollback checkpoint set: ${hash.slice(0, 8)}`);
      } catch (e) {
        logger.warn(`Failed to create rollback checkpoint: ${e}`);
      }
    }

    // === Install dependencies in worktree ===
    if (project.commands.preInstall) {
      jl?.setStep("의존성 설치 중...");
      await installDependencies(project.commands.preInstall, { cwd: worktreePath! });
    }

    // === Read CLAUDE.md for project conventions ===
    let projectConventions = "";
    const claudeMdPath = project.commands.claudeMdPath;
    if (claudeMdPath) {
      // Check worktree first (committed CLAUDE.md), then project root
      const worktreeMd = resolve(worktreePath!, claudeMdPath);
      const rootMd = resolve(projectRoot, claudeMdPath);
      if (existsSync(worktreeMd)) {
        projectConventions = readFileSync(worktreeMd, "utf-8");
        logger.info(`CLAUDE.md loaded from worktree`);
      } else if (existsSync(rootMd)) {
        projectConventions = readFileSync(rootMd, "utf-8");
        logger.info(`CLAUDE.md loaded from project root`);
      } else {
        logger.debug(`No CLAUDE.md found at ${claudeMdPath}`);
      }
    }

    // === Load skills for prompt injection ===
    let skillsContext = "";
    const skillsPath = project.commands.skillsPath;
    if (skillsPath) {
      // Use original project root (not worktree) for skills
      const resolvedSkillsPath = resolve(projectRoot, skillsPath);
      const skills = loadSkills(resolvedSkillsPath);
      if (skills.length > 0) {
        skillsContext = formatSkillsForPrompt(skills);
        logger.info(`Loaded ${skills.length} skills from ${resolvedSkillsPath}`);
      } else {
        logger.debug(`No skills found at ${resolvedSkillsPath}`);
      }
    }

    // === Get repo structure for plan generation (tracked files only) ===
    const structureResult = await runCli(
      gitConfig.gitPath, ["ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: worktreePath! }
    );
    // Limit output so prompt stays manageable
    structureResult.stdout = structureResult.stdout.split("\n").slice(0, 200).join("\n");

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
      repoStructure: structureResult.stdout,
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
    type ReviewVars = {
      issue: { number: string; title: string; body: string };
      plan: { summary: string };
      diff: { full: string };
      config: { testCommand: string; lintCommand: string };
      skillsContext: string;
    };
    const buildReviewVars = async (): Promise<ReviewVars> => ({
      issue: { number: String(issueNumber), title: issue.title, body: issue.body },
      plan: { summary: coreResult.plan.problemDefinition },
      diff: { full: await getDiffContent(gitConfig, project.baseBranch, { cwd: worktreePath! }) },
      config: { testCommand: project.commands.test, lintCommand: project.commands.lint },
      skillsContext: skillsContext,
    });
    let reviewVariables: ReviewVars | undefined;

    if (!preset.skipReview) {
      if (isPastState(state, "REVIEWING")) {
        logger.info(`[SKIP] PLAN_GENERATED → REVIEWING (already done)`);
      } else {
        timer.assertNotExpired("review");
        state = "REVIEWING";
        logger.info("[REVIEWING] Starting analyst and review rounds...");
        jl?.setStep("요구사항 대조 분석 중...");
        jl?.setProgress(PROGRESS_REVIEW_START);

        reviewVariables = await buildReviewVars();

        // === Phase 1: Requirements Analysis ===
        const analystTemplatePath = resolve(promptsDir, "analyst-requirements.md");
        let analystResult: AnalystResult | undefined;

        if (existsSync(analystTemplatePath)) {
          analystResult = await runAnalyst({
            promptsDir,
            claudeConfig: project.commands.claudeCli,
            cwd: worktreePath!,
            variables: reviewVariables,
          });
          jl?.log(`분석: ${analystResult.verdict} (${analystResult.findings.length}개 발견)`);
        } else {
          logger.info("[REVIEWING] Analyst template not found, skipping requirements analysis");
        }

        // === Phase 2: Code Review Rounds ===
        jl?.setStep("리뷰 진행 중...");
        let reviewResult: ReviewPipelineResult = await runReviews({
          reviewConfig: project.review,
          claudeConfig: project.commands.claudeCli,
          promptsDir,
          cwd: worktreePath!,
          variables: reviewVariables,
        });

        if (analystResult) {
          reviewResult.analyst = analystResult;
        }

        for (const round of reviewResult.rounds) {
          jl?.log(`리뷰 "${round.roundName}": ${round.verdict}`);
        }

        const hasCriticalAnalystIssues = analystResult?.findings.some(f =>
          f.severity === "error" && (f.type === "missing" || f.type === "mismatch")
        ) || false;

        if (hasCriticalAnalystIssues || !reviewResult.allPassed) {
          const maxRetries = project.safety.maxRetries;
          let retrySuccess = false;
          const fixAttempts: ReviewFixAttempt[] = [];

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // Extract findings for this attempt
            const analystFindings = analystResult?.findings.filter(f =>
              f.severity === "error" && (f.type === "missing" || f.type === "mismatch")
            ) || [];
            const reviewFindings = reviewResult.rounds.flatMap(round =>
              round.findings.filter(f => f.severity === "error")
            );

            const allFindings = [...analystFindings, ...reviewFindings];
            const findingsSummary = allFindings.map(f => f.message).join(", ");

            logger.info(`[REVIEWING] Retry ${attempt}/${maxRetries} — fixing: ${findingsSummary}`);
            jl?.log(`리뷰 실패 수정 시도 ${attempt}/${maxRetries}: ${findingsSummary}`);
            jl?.setStep(`리뷰 오류 수정 중 (${attempt}/${maxRetries})...`);

            // Prepare fix prompt
            const details = [];
            if (hasCriticalAnalystIssues) {
              details.push("=== Requirements Analysis Issues ===");
              details.push(...analystFindings.map(f => `- ${f.message}${f.suggestion ? ` (Suggestion: ${f.suggestion})` : ""}`));
            }
            if (!reviewResult.allPassed) {
              details.push("=== Code Review Issues ===");
              details.push(...reviewFindings.map(f => `- ${f.message}${f.suggestion ? ` (Suggestion: ${f.suggestion})` : ""}${f.file && f.line ? ` (${f.file}:${f.line})` : ""}`));
            }

            const fixPrompt = [
              "The following review issues were found. Fix the errors only — do not add new features or refactor unrelated code.",
              "",
              details.join("\n"),
            ].join("\n");

            // Run Claude with fallback model
            const claudeConfig = configForTask(project.commands.claudeCli, "fallback");
            let fixSuccess = false;
            let fixError: string | undefined;

            try {
              await runClaude({
                prompt: fixPrompt,
                cwd: worktreePath!,
                config: claudeConfig,
              });

              await autoCommitIfDirty(gitConfig.gitPath, worktreePath!, `fix: review 오류 수정 (retry ${attempt})`);

              // Re-run reviews
              if (!reviewVariables) {
                reviewVariables = await buildReviewVars();
              }

              const retryReviewResult = await runReviews({
                reviewConfig: project.review,
                claudeConfig: project.commands.claudeCli,
                promptsDir,
                cwd: worktreePath!,
                variables: reviewVariables,
              });

              let retryAnalystResult: AnalystResult | undefined;
              if (analystResult) {
                retryAnalystResult = await runAnalyst({
                  promptsDir,
                  claudeConfig: project.commands.claudeCli,
                  cwd: worktreePath!,
                  variables: reviewVariables,
                });
              }

              const retryHasCriticalAnalystIssues = retryAnalystResult?.findings.some(f =>
                f.severity === "error" && (f.type === "missing" || f.type === "mismatch")
              ) || false;

              fixSuccess = !retryHasCriticalAnalystIssues && retryReviewResult.allPassed;

              if (fixSuccess) {
                logger.info(`[REVIEWING] Passed after retry ${attempt}`);
                jl?.log(`리뷰 통과 (retry ${attempt})`);
                reviewResult = { ...retryReviewResult, fixAttempts };
                if (retryAnalystResult) {
                  reviewResult.analyst = retryAnalystResult;
                }
                retrySuccess = true;
              } else {
                // Update for next iteration
                reviewResult = retryReviewResult;
                analystResult = retryAnalystResult;
                for (const round of reviewResult.rounds) {
                  jl?.log(`리뷰 "${round.roundName}": ${round.verdict} (retry ${attempt})`);
                }
              }
            } catch (error) {
              fixError = error instanceof Error ? error.message : String(error);
              logger.error(`[REVIEWING] Fix attempt ${attempt} failed: ${fixError}`);
            }

            // Record fix attempt
            fixAttempts.push({
              attempt,
              findingsSnapshot: {
                analystFindings,
                reviewFindings,
              },
              fixResult: {
                success: fixSuccess,
                filesModified: [],
                summary: fixSuccess ? `Fixed ${allFindings.length} issues` : `Fix failed: ${fixError}`,
                error: fixError,
              },
            });

            if (fixSuccess) {
              break;
            }
          }

          if (!retrySuccess) {
            const finalFindings = [
              ...(analystResult?.findings.filter(f => f.severity === "error") || []),
              ...reviewResult.rounds.flatMap(round => round.findings.filter(f => f.severity === "error"))
            ];
            const finalSummary = finalFindings.map(f => f.message).join(", ");

            logger.error(`[REVIEWING] Failed after ${maxRetries} retries: ${finalSummary}`);
            jl?.log(`실패: Review failed after ${maxRetries} retries: ${finalSummary}`);
            jl?.setStep("실패");

            // Add fix attempts to final result
            reviewResult.fixAttempts = fixAttempts;

            checkpoint({ plan: coreResult.plan, phaseResults: coreResult.phaseResults });
            const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
            printResult(report);
            saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
            return {
              success: false,
              state: "FAILED",
              error: `Review failed after ${maxRetries} retries: ${finalSummary}`,
              report
            };
          }
        }

        checkpoint({ plan: coreResult.plan, phaseResults: coreResult.phaseResults });
      }
    }

    // === SIMPLIFYING ===
    if (!preset.skipSimplify && project.review.simplify.enabled) {
      if (isPastState(state, "SIMPLIFYING")) {
        logger.info(`[SKIP] REVIEWING → SIMPLIFYING (already done)`);
      } else {
        timer.assertNotExpired("simplify");
        state = "SIMPLIFYING";
        logger.info("[SIMPLIFYING] Running code simplification...");
        jl?.setStep("코드 간소화 중...");
        jl?.setProgress(PROGRESS_SIMPLIFY_START);
        if (!reviewVariables) {
          reviewVariables = await buildReviewVars();
        }
        await runSimplify({
          promptTemplate: project.review.simplify.promptTemplate,
          promptsDir,
          claudeConfig: project.commands.claudeCli,
          cwd: worktreePath!,
          testCommand: project.commands.test,
          variables: reviewVariables,
          gitPath: gitConfig.gitPath,
        });

        checkpoint({ plan: coreResult.plan, phaseResults: coreResult.phaseResults });
      }
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

function saveResult(config: AQConfig, projectRoot: string, issueNumber: number, report: PipelineReport): void {
  try {
    const logDir = resolve(projectRoot, config.general.logDir);
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      resolve(logDir, `issue-${issueNumber}-result.json`),
      JSON.stringify(report, null, 2)
    );
  } catch {
    // non-fatal
  }
}
