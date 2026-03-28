import { resolve } from "path";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { fetchIssue } from "../github/issue-fetcher.js";
import { createDraftPR, enableAutoMerge } from "../github/pr-creator.js";
import { syncBaseBranch, createWorkBranch, pushBranch, checkConflicts, attemptRebase } from "../git/branch-manager.js";
import { createWorktree, removeWorktree } from "../git/worktree-manager.js";
import { runCoreLoop } from "./core-loop.js";
import { installDependencies } from "./dependency-installer.js";
import { formatResult, printResult } from "./result-reporter.js";
import type { PipelineReport } from "./result-reporter.js";
import { runFinalValidation } from "./final-validator.js";
import { runReviews } from "../review/review-orchestrator.js";
import { runSimplify } from "../review/simplify-runner.js";
import { collectDiff, getDiffContent } from "../git/diff-collector.js";
import { validateIssue, validateBeforePush } from "../safety/safety-checker.js";
import { PipelineTimer } from "../safety/timeout-manager.js";
import { createSlugWithFallback } from "../utils/slug.js";
import { runCli } from "../utils/cli-runner.js";
import { errorMessage } from "../types/errors.js";
import { getLogger } from "../utils/logger.js";
import type { AQConfig } from "../types/config.js";
import type { PipelineState } from "../types/pipeline.js";
import type { ReviewPipelineResult } from "../types/review.js";
import { resolveProject } from "../config/project-resolver.js";
import { getModePreset, detectModeFromLabels } from "../config/mode-presets.js";
import type { JobLogger } from "../queue/job-logger.js";
import { PatternStore } from "../learning/pattern-store.js";

export interface OrchestratorInput {
  issueNumber: number;
  repo: string; // "owner/repo"
  config: AQConfig;
  projectRoot?: string;  // optional override; falls back to project config
  aqRoot?: string;       // AI Quartermaster root (where prompts/ lives)
  jobLogger?: JobLogger;
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
  let state: PipelineState = "RECEIVED";
  let worktreePath: string | undefined;
  let branchName: string | undefined;
  let projectRoot: string = input.projectRoot ?? "";
  let gitConfig = config.git;
  let promptsDir: string = resolve(projectRoot, "prompts");

  try {
    // Resolve per-project config (merges project overrides with global defaults)
    const project = resolveProject(repo, config);
    // Allow explicit --target override, otherwise use resolved project path
    projectRoot = input.projectRoot ?? project.path;
    promptsDir = resolve(aqRoot ?? projectRoot, "prompts");

    // Build a git config that reflects per-project branch settings
    gitConfig = {
      ...config.git,
      defaultBaseBranch: project.baseBranch,
      branchTemplate: project.branchTemplate,
    };

    // Start pipeline-level timer
    const timer = new PipelineTimer(config.safety.maxTotalDurationMs);

    // === RECEIVED → VALIDATED ===
    logger.info(`[RECEIVED] Issue #${issueNumber} from ${repo}`);
    jl?.setStep("이슈 정보 가져오는 중...");

    // Fetch issue
    timer.assertNotExpired("issue-fetch");
    const issue = await fetchIssue(repo, issueNumber, {
      ghPath: project.commands.ghCli.path,
      timeout: project.commands.ghCli.timeout,
    });
    logger.info(`[VALIDATED] Issue: ${issue.title}`);
    jl?.log(`이슈: ${issue.title}`);
    state = "VALIDATED";

    // === Safety: validate issue labels ===
    validateIssue(issue, project.safety);

    // Determine initial pipeline mode: issue label > project config > default
    let mode = detectModeFromLabels(issue.labels, project.mode ?? "code");
    let preset = getModePreset(mode);
    logger.info(`Pipeline mode (초기): ${mode}`);
    jl?.log(`모드: ${mode}`);

    // === VALIDATED → BASE_SYNCED ===
    await syncBaseBranch(gitConfig, { cwd: projectRoot });
    state = "BASE_SYNCED";
    logger.info(`[BASE_SYNCED] Base branch ${project.baseBranch} synced`);
    jl?.setStep("브랜치 생성 중...");

    // === BASE_SYNCED → BRANCH_CREATED ===
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

    // === BRANCH_CREATED → WORKTREE_CREATED ===
    const slug = createSlugWithFallback(issue.title);
    const worktreeInfo = await createWorktree(
      gitConfig,
      config.worktree,
      branchName,
      issueNumber,
      slug,
      { cwd: projectRoot }
    );
    worktreePath = worktreeInfo.path;
    state = "WORKTREE_CREATED";
    logger.info(`[WORKTREE_CREATED] Worktree: ${worktreePath}`);

    // === Install dependencies in worktree ===
    if (project.commands.preInstall) {
      jl?.setStep("의존성 설치 중...");
      await installDependencies(project.commands.preInstall, { cwd: worktreePath });
    }

    // === Read CLAUDE.md for project conventions ===
    let projectConventions = "";
    const claudeMdPath = project.commands.claudeMdPath;
    if (claudeMdPath) {
      // Check worktree first (committed CLAUDE.md), then project root
      const worktreeMd = resolve(worktreePath, claudeMdPath);
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

    // === Get repo structure for plan generation (tracked files only) ===
    const structureResult = await runCli(
      gitConfig.gitPath, ["ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: worktreePath }
    );
    // Limit output so prompt stays manageable
    structureResult.stdout = structureResult.stdout.split("\n").slice(0, 200).join("\n");

    // === WORKTREE_CREATED → PLAN_GENERATED → PHASE_IN_PROGRESS ===
    jl?.setStep("Plan 생성 중...");
    timer.assertNotExpired("plan-generation");
    const [owner, name] = repo.split("/");
    // Build a config with project-specific commands for core-loop
    const projectConfig = { ...config, commands: project.commands, safety: project.safety };
    const dataDir = resolve(aqRoot ?? projectRoot, "data");
    const patternStore = new PatternStore(dataDir);
    const coreResult = await runCoreLoop({
      issue,
      repo: { owner, name },
      branch: { base: project.baseBranch, work: branchName },
      repoStructure: structureResult.stdout,
      config: projectConfig,
      promptsDir,
      cwd: worktreePath,
      modeHint: preset.planHint,
      projectConventions,
      dataDir,
      jobLogger: jl,
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
      const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
      printResult(report);
      saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
      return { success: false, state, error: "Phase execution failed", report };
    }

    state = "PLAN_GENERATED"; // core-loop completed all phases

    // === REVIEWING: 3-round review ===
    let reviewVariables: {
      issue: { number: string; title: string; body: string };
      plan: { summary: string };
      diff: { full: string };
      config: { testCommand: string; lintCommand: string };
    } | undefined;

    if (!preset.skipReview) {
      timer.assertNotExpired("review");
      state = "REVIEWING";
      logger.info("[REVIEWING] Starting review rounds...");
      jl?.setStep("리뷰 진행 중...");

      const diffContent = await getDiffContent(gitConfig, project.baseBranch, { cwd: worktreePath });
      reviewVariables = {
        issue: {
          number: String(issueNumber),
          title: issue.title,
          body: issue.body,
        },
        plan: { summary: coreResult.plan.problemDefinition },
        diff: { full: diffContent },
        config: {
          testCommand: project.commands.test,
          lintCommand: project.commands.lint,
        },
      };

      const reviewResult: ReviewPipelineResult = await runReviews({
        reviewConfig: project.review,
        claudeConfig: project.commands.claudeCli,
        promptsDir,
        cwd: worktreePath,
        variables: reviewVariables,
      });

      for (const round of reviewResult.rounds) {
        jl?.log(`리뷰 "${round.roundName}": ${round.verdict}`);
      }

      if (!reviewResult.allPassed) {
        logger.error("[REVIEWING] Review pipeline failed");
        jl?.log(`실패: Review pipeline failed`);
        jl?.setStep("실패");
        const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
        printResult(report);
        saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
        return { success: false, state: "FAILED", error: "Review failed", report };
      }
    }

    // === SIMPLIFYING ===
    if (!preset.skipSimplify && project.review.simplify.enabled) {
      timer.assertNotExpired("simplify");
      state = "SIMPLIFYING";
      logger.info("[SIMPLIFYING] Running code simplification...");
      jl?.setStep("코드 간소화 중...");
      if (!reviewVariables) {
        const diffContent = await getDiffContent(gitConfig, project.baseBranch, { cwd: worktreePath });
        reviewVariables = {
          issue: {
            number: String(issueNumber),
            title: issue.title,
            body: issue.body,
          },
          plan: { summary: coreResult.plan.problemDefinition },
          diff: { full: diffContent },
          config: {
            testCommand: project.commands.test,
            lintCommand: project.commands.lint,
          },
        };
      }
      await runSimplify({
        promptTemplate: project.review.simplify.promptTemplate,
        promptsDir,
        claudeConfig: project.commands.claudeCli,
        cwd: worktreePath,
        testCommand: project.commands.test,
        variables: reviewVariables,
        gitPath: gitConfig.gitPath,
      });
    }

    // === FINAL_VALIDATING ===
    if (!preset.skipFinalValidation) {
      timer.assertNotExpired("final-validation");
      state = "FINAL_VALIDATING";
      logger.info("[FINAL_VALIDATING] Running final validation...");
      jl?.setStep("최종 검증 중...");
      const validation = await runFinalValidation(project.commands, { cwd: worktreePath }, gitConfig.gitPath);
      for (const check of validation.checks) {
        jl?.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}`);
      }
      if (!validation.success) {
        const failedChecks = validation.checks.filter(c => !c.passed).map(c => c.name).join(", ");
        logger.error(`[FINAL_VALIDATING] Failed checks: ${failedChecks}`);
        jl?.log(`실패: Final validation failed: ${failedChecks}`);
        jl?.setStep("실패");
        const report = formatResult(issueNumber, repo, coreResult.plan, coreResult.phaseResults, startTime);
        printResult(report);
        saveResult(config, aqRoot ?? projectRoot, issueNumber, report);
        return { success: false, state: "FAILED", error: `Final validation failed: ${failedChecks}`, report };
      }
    }

    // === Safety: validate before push (sensitive paths, change limits, base branch) ===
    await validateBeforePush({
      safetyConfig: project.safety,
      gitConfig,
      cwd: worktreePath,
      baseBranch: project.baseBranch,
    });

    // === Conflict detection before push ===
    {
      // Fetch latest base branch to ensure we're comparing against current remote
      const fetchResult = await runCli(
        gitConfig.gitPath,
        ["fetch", gitConfig.remoteAlias, project.baseBranch],
        { cwd: worktreePath }
      );
      if (fetchResult.exitCode !== 0) {
        logger.warn(`Failed to fetch ${project.baseBranch} for conflict check: ${fetchResult.stderr}`);
      } else {
        const conflictCheck = await checkConflicts(gitConfig, project.baseBranch, { cwd: worktreePath });
        if (conflictCheck.hasConflicts) {
          logger.warn(`Conflicts detected with ${project.baseBranch}: ${conflictCheck.conflictFiles.join(", ") || "(unknown files)"}`);
          jl?.log(`충돌 감지됨, rebase 시도 중...`);
          const rebaseResult = await attemptRebase(gitConfig, project.baseBranch, { cwd: worktreePath });
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
      await pushBranch(gitConfig, branchName, { cwd: worktreePath });
    }

    // === Create Draft PR ===
    state = "DRAFT_PR_CREATED";
    let prUrl: string | undefined;

    const prResult = await createDraftPR(
      project.pr,
      project.commands.ghCli,
      {
        issueNumber,
        issueTitle: issue.title,
        repo,
        plan: coreResult.plan,
        phaseResults: coreResult.phaseResults,
        branchName,
        baseBranch: project.baseBranch,
      },
      { cwd: worktreePath, promptsDir, dryRun: config.general.dryRun }
    );
    prUrl = prResult.url;
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

    return { success: true, state, prUrl, report };

  } catch (error) {
    const errMsg = errorMessage(error);
    logger.error(`[FAILED] Pipeline failed at state ${state}: ${errMsg}`);
    jl?.log(`실패: ${errMsg}`);
    jl?.setStep("실패");

    // Cleanup worktree on failure if configured
    if (worktreePath && config.worktree.cleanupOnFailure) {
      try {
        await removeWorktree(gitConfig, worktreePath, { cwd: projectRoot, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    return { success: false, state: "FAILED", error: errMsg };
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
