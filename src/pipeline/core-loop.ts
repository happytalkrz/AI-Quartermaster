import { generatePlan } from "./plan-generator.js";
import { executePhase } from "./phase-executor.js";
import { retryPhase } from "./phase-retry.js";
import { checkPhaseLimit } from "../safety/phase-limit-guard.js";
import { schedulePhases } from "./phase-scheduler.js";
import type { AQConfig } from "../types/config.js";
import type { Plan, PhaseResult } from "../types/pipeline.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { getLogger } from "../utils/logger.js";
import type { JobLogger } from "../queue/job-logger.js";
import { PatternStore } from "../learning/pattern-store.js";
import { PROGRESS_PLAN_GENERATED, phaseStart } from "./progress-tracker.js";

const logger = getLogger();

export interface CoreLoopContext {
  issue: GitHubIssue;
  repo: { owner: string; name: string };
  branch: { base: string; work: string };
  repoStructure: string;
  config: AQConfig;
  promptsDir: string;
  cwd: string;
  modeHint?: string;
  projectConventions?: string;
  dataDir?: string;
  jobLogger?: JobLogger;
  previousPhaseResults?: PhaseResult[];  // from checkpoint resume
}

export interface CoreLoopResult {
  plan: Plan;
  phaseResults: PhaseResult[];
  success: boolean;
}

export async function runCoreLoop(ctx: CoreLoopContext): Promise<CoreLoopResult> {
  // Step 1: Generate plan
  logger.info(`Generating plan for issue #${ctx.issue.number}...`);

  const plan = await generatePlan({
    issue: ctx.issue,
    repo: ctx.repo,
    branch: ctx.branch,
    repoStructure: ctx.repoStructure,
    claudeConfig: ctx.config.commands.claudeCli,
    promptsDir: ctx.promptsDir,
    cwd: ctx.cwd,
    modeHint: ctx.modeHint,
    maxPhases: ctx.config.safety.maxPhases,
    sensitivePaths: ctx.config.safety.sensitivePaths.join(", "),
  });

  logger.info(`Plan generated: ${plan.phases.length} phases`);
  checkPhaseLimit(plan.phases.length, ctx.config.safety.maxPhases);

  // Step 2: Execute phases sequentially with retry
  const jl = ctx.jobLogger;
  jl?.setProgress(PROGRESS_PLAN_GENERATED);
  const phaseResults: PhaseResult[] = [...(ctx.previousPhaseResults ?? [])];
  const maxRetries = ctx.config.safety.maxRetries;
  const repoFull = `${ctx.repo.owner}/${ctx.repo.name}`;

  // Load past failures for this repo to inject into phase prompts
  let pastFailures = "";
  if (ctx.dataDir) {
    try {
      const patternStore = new PatternStore(ctx.dataDir);
      const recentFailures = patternStore.getRecentFailures(repoFull, 5);
      pastFailures = patternStore.formatForPrompt(recentFailures);
    } catch {
      // non-fatal: ignore pattern load errors
    }
  }

  // Schedule phases for parallel execution based on dependencies
  const scheduleResult = schedulePhases(plan.phases);
  if (!scheduleResult.success) {
    logger.error(`Failed to schedule phases: ${scheduleResult.error}`);
    jl?.log(`Phase 스케줄링 실패: ${scheduleResult.error}`);
    return { plan, phaseResults, success: false };
  }

  logger.info(`Scheduled ${plan.phases.length} phases in ${scheduleResult.groups.length} parallel levels`);
  jl?.log(`${scheduleResult.groups.length}개 레벨로 병렬 실행 스케줄링`);

  // Execute phases level by level (parallel within level, sequential between levels)
  for (const group of scheduleResult.groups) {
    logger.info(`\n--- Level ${group.level}: ${group.phases.length} phases in parallel ---`);
    jl?.log(`레벨 ${group.level}: ${group.phases.length}개 Phase 병렬 실행`);

    // Identify already completed phases
    const completedIndices = new Set(phaseResults.filter(r => r.success).map(r => r.phaseIndex));

    // Log skipped phases and filter remaining
    const remainingPhases = group.phases.filter(phase => {
      if (completedIndices.has(phase.index)) {
        logger.info(`Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name} [SKIP - already completed]`);
        jl?.log(`Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name} (이전 완료, 스킵)`);
        jl?.setProgress(phaseStart(phase.index + 1, plan.phases.length));
        return false;
      }
      return true;
    });

    if (remainingPhases.length === 0) {
      logger.info(`All phases in level ${group.level} already completed, skipping`);
      continue;
    }

    // Execute phases in parallel within the current level
    const phasePromises = remainingPhases.map(async (phase) => {
      logger.info(`Starting Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name}`);
      jl?.setStep(`Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name}`);
      jl?.setProgress(phaseStart(phase.index, plan.phases.length));

      let result = await executePhase({
        issue: ctx.issue,
        plan,
        phase,
        previousResults: phaseResults,
        claudeConfig: ctx.config.commands.claudeCli,
        promptsDir: ctx.promptsDir,
        cwd: ctx.cwd,
        testCommand: ctx.config.commands.test,
        lintCommand: ctx.config.commands.lint,
        gitPath: ctx.config.git.gitPath,
        projectConventions: ctx.projectConventions,
        pastFailures: pastFailures || undefined,
        jobLogger: jl,
      });

      // Retry on failure (skip for TIMEOUT and SAFETY_VIOLATION — not recoverable by retry)
      if (!result.success && result.errorCategory !== "TIMEOUT" && result.errorCategory !== "SAFETY_VIOLATION") {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          logger.warn(`Phase ${phase.index + 1} failed (${result.errorCategory ?? "UNKNOWN"}), retry ${attempt}/${maxRetries}...`);
          jl?.log(`Phase ${phase.index + 1} 재시도 ${attempt}/${maxRetries}: ${result.errorCategory}`);

          result = await retryPhase({
            issue: ctx.issue,
            plan,
            phase,
            previousError: result.error ?? "Unknown error",
            errorCategory: result.errorCategory ?? "UNKNOWN",
            attempt,
            maxRetries,
            claudeConfig: ctx.config.commands.claudeCli,
            promptsDir: ctx.promptsDir,
            cwd: ctx.cwd,
            testCommand: ctx.config.commands.test,
            lintCommand: ctx.config.commands.lint,
            gitPath: ctx.config.git.gitPath,
            jobLogger: jl,
          });

          if (result.success) {
            logger.info(`Phase ${phase.index + 1} succeeded on retry ${attempt}`);
            jl?.log(`Phase ${phase.index + 1} 재시도 ${attempt} 성공`);
            break;
          }
        }
      }

      return { phase, result };
    });

    // Wait for all phases in current level to complete
    const levelResults = await Promise.all(phasePromises);

    // Add results in order (sequential commits to avoid git conflicts)
    for (const { phase, result } of levelResults.sort((a, b) => a.phase.index - b.phase.index)) {
      phaseResults.push(result);

      // Phase 완료할 때마다 대시보드에 진행률 반영
      jl?.setPhaseResults(phaseResults.map(r => ({
        name: r.phaseName,
        success: r.success,
        commit: r.commitHash?.slice(0, 8),
        durationMs: r.durationMs,
        error: r.error,
      })));

      if (!result.success) {
        logger.error(`Phase ${phase.index + 1} failed after retries: ${result.error}`);
        jl?.log(`Phase ${phase.index + 1} 최종 실패: ${result.error}`);
        return { plan, phaseResults, success: false };
      }

      logger.info(`Phase ${phase.index + 1} completed (commit: ${result.commitHash?.slice(0, 8)})`);
      jl?.log(`Phase ${phase.index + 1} 완료 (${result.commitHash?.slice(0, 8)})`);
      jl?.setProgress(phaseStart(phase.index + 1, plan.phases.length));
    }

    logger.info(`Level ${group.level} completed: ${remainingPhases.length} phases executed`);
  }

  logger.info(`\nAll ${plan.phases.length} phases completed successfully`);
  return { plan, phaseResults, success: true };
}
