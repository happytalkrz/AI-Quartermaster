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
  jobLogger?: JobLogger;
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
  const phaseResults: PhaseResult[] = [];
  const maxRetries = ctx.config.safety.maxRetries;

  for (const phase of plan.phases) {
    logger.info(`\n--- Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name} ---`);
    jl?.setStep(`Phase ${phase.index + 1}/${plan.phases.length}: ${phase.name}`);

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

    if (!result.success) {
      logger.error(`Phase ${phase.index + 1} failed after retries: ${result.error}`);
      jl?.log(`Phase ${phase.index + 1} 최종 실패: ${result.error}`);
      return { plan, phaseResults, success: false };
    }

    logger.info(`Phase ${phase.index + 1} completed (commit: ${result.commitHash?.slice(0, 8)})`);
    jl?.log(`Phase ${phase.index + 1} 완료 (${result.commitHash?.slice(0, 8)})`);
  }

  logger.info(`\nAll ${plan.phases.length} phases completed successfully`);
  return { plan, phaseResults, success: true };
}
