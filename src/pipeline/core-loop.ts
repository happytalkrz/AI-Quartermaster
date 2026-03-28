import { resolve } from "path";
import { generatePlan, PlanGeneratorContext } from "./plan-generator.js";
import { executePhase, PhaseExecutorContext } from "./phase-executor.js";
import { retryPhase } from "./phase-retry.js";
import { checkPhaseLimit } from "../safety/phase-limit-guard.js";
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

  for (const phase of plan.phases) {
    // Skip phases already completed (from checkpoint resume)
    const alreadyDone = phaseResults.find(r => r.phaseIndex === phase.index && r.success);
    if (alreadyDone) {
      logger.info(`\n--- Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name} [SKIP - already completed] ---`);
      jl?.log(`Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name} (이전 완료, 스킵)`);
      jl?.setProgress(phaseStart(phase.index + 1, plan.phases.length));
      continue;
    }

    logger.info(`\n--- Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name} ---`);
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

  logger.info(`\nAll ${plan.phases.length} phases completed successfully`);
  return { plan, phaseResults, success: true };
}
