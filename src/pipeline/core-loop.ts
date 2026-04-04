import { generatePlan } from "./plan-generator.js";
import { executePhase } from "./phase-executor.js";
import { retryPhase } from "./phase-retry.js";
import { checkPhaseLimit } from "../safety/phase-limit-guard.js";
import { schedulePhases } from "./phase-scheduler.js";
import type { AQConfig } from "../types/config.js";
import type { Plan, PhaseResult, ErrorHistoryEntry, ErrorCategory, PlanWithCost } from "../types/pipeline.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { JobLogger } from "../queue/job-logger.js";
import { PatternStore } from "../learning/pattern-store.js";
import { PROGRESS_PLAN_GENERATED, phaseStart } from "./progress-tracker.js";
import { createWorktree, removeWorktree } from "../git/worktree-manager.js";
import { createCheckpoint } from "../safety/rollback-manager.js";
import { createSlug } from "../utils/slug.js";

const logger = getLogger();

function sumUsage(usages: (import("../types/pipeline.js").UsageInfo | undefined)[]): import("../types/pipeline.js").UsageInfo | undefined {
  const validUsages = usages.filter((usage): usage is import("../types/pipeline.js").UsageInfo => !!usage);
  if (validUsages.length === 0) return undefined;

  return validUsages.reduce((acc, usage) => ({
    input_tokens: acc.input_tokens + usage.input_tokens,
    output_tokens: acc.output_tokens + usage.output_tokens,
    cache_creation_input_tokens: (acc.cache_creation_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (acc.cache_read_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
  }), {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  });
}

function addErrorToHistory(
  historyMap: Map<number, ErrorHistoryEntry[]>,
  phaseIndex: number,
  attempt: number,
  errorCategory: string | undefined,
  error: string | undefined,
): ErrorHistoryEntry[] {
  const history = historyMap.get(phaseIndex) || [];
  history.push({
    attempt,
    errorCategory: (errorCategory ?? "UNKNOWN") as ErrorCategory,
    errorMessage: error ?? "Unknown error",
    timestamp: new Date().toISOString(),
  });
  historyMap.set(phaseIndex, history);
  return history;
}

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
  skillsContext?: string;
  dataDir?: string;
  jobLogger?: JobLogger;
  previousPhaseResults?: PhaseResult[];  // from checkpoint resume
  checkpoint?: string;  // checkpoint hash for rollback
  worktreeInfo?: { path: string; branch: string };  // worktree information
  slug?: string;  // issue slug for worktree naming
}

export interface CoreLoopResult {
  plan: Plan;
  phaseResults: PhaseResult[];
  success: boolean;
  totalCostUsd?: number;
  totalUsage?: import("../types/pipeline.js").UsageInfo;
}

export async function runCoreLoop(ctx: CoreLoopContext): Promise<CoreLoopResult> {
  // Step 1: Generate plan
  logger.info(`Generating plan for issue #${ctx.issue.number}...`);

  let plan: Plan;
  let planCostUsd: number | undefined;
  let planUsage: import("../types/pipeline.js").UsageInfo | undefined;
  try {
    const planResult = await generatePlan({
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
    plan = planResult.plan;
    planCostUsd = planResult.costUsd;
    planUsage = planResult.usage;

    logger.info(`Plan generated: ${plan.phases.length} phases`);
    ctx.jobLogger?.log(`Plan 생성 완료: ${plan.phases.length}개 Phase`);
  } catch (planError: unknown) {
    const errorMessage = getErrorMessage(planError);
    logger.error(`Plan generation failed for issue #${ctx.issue.number}: ${errorMessage}`);
    ctx.jobLogger?.log(`Plan 생성 실패: ${errorMessage}`);

    // Plan 생성 실패 시 빈 결과 반환 (상위에서 적절한 실패 처리)
    return {
      plan: {
        mode: "code",
        issueNumber: ctx.issue.number,
        title: ctx.issue.title,
        problemDefinition: "Plan 생성 실패",
        requirements: [],
        affectedFiles: [],
        risks: [],
        phases: [],
        verificationPoints: [],
        stopConditions: [],
      },
      phaseResults: [],
      success: false,
      totalCostUsd: 0,
      totalUsage: undefined,
    };
  }

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
    } catch (patternError: unknown) {
      // non-fatal: ignore pattern load errors
      logger.debug(`Failed to load pattern store: ${getErrorMessage(patternError)}`);
    }
  }

  // Schedule phases for parallel execution based on dependencies
  const scheduleResult = schedulePhases(plan.phases);
  if (!scheduleResult.success) {
    logger.error(`Failed to schedule phases: ${scheduleResult.error}`);
    jl?.log(`Phase 스케줄링 실패: ${scheduleResult.error}`);
    return {
      plan,
      phaseResults,
      success: false,
      totalCostUsd: planCostUsd ?? 0,
      totalUsage: planUsage,
    };
  }

  logger.info(`Scheduled ${plan.phases.length} phases in ${scheduleResult.groups.length} parallel levels`);
  jl?.log(`${scheduleResult.groups.length}개 레벨로 병렬 실행 스케줄링`);

  // Track error history for each phase (phase index -> error history)
  const phaseErrorHistories = new Map<number, ErrorHistoryEntry[]>();

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
        skillsContext: ctx.skillsContext,
        pastFailures: pastFailures || undefined,
        jobLogger: jl,
      });

      // Retry on failure (skip for TIMEOUT and SAFETY_VIOLATION — not recoverable by retry)
      if (!result.success && result.errorCategory !== "TIMEOUT" && result.errorCategory !== "SAFETY_VIOLATION") {
        let errorHistory = addErrorToHistory(phaseErrorHistories, phase.index, 0, result.errorCategory, result.error);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          logger.warn(`Phase ${phase.index + 1} failed (${result.errorCategory ?? "UNKNOWN"}), retry ${attempt}/${maxRetries}...`);
          jl?.log(`Phase ${phase.index + 1} 재시도 ${attempt}/${maxRetries}: ${result.errorCategory}`);

          let checkpoint = ctx.checkpoint;
          if (!checkpoint) {
            try {
              checkpoint = await createCheckpoint({ cwd: ctx.cwd, gitPath: ctx.config.git.gitPath });
            } catch (checkpointError) {
              logger.warn(`Failed to create checkpoint for retry: ${checkpointError}`);
              checkpoint = "fallback";
            }
          }

          result = await retryPhase({
            issue: ctx.issue,
            plan,
            phase,
            previousError: result.error ?? "Unknown error",
            errorCategory: result.errorCategory ?? "UNKNOWN",
            errorHistory: [...errorHistory],
            attempt,
            maxRetries,
            claudeConfig: ctx.config.commands.claudeCli,
            promptsDir: ctx.promptsDir,
            cwd: ctx.cwd,
            testCommand: ctx.config.commands.test,
            lintCommand: ctx.config.commands.lint,
            gitPath: ctx.config.git.gitPath,
            jobLogger: jl,
            checkpoint,
            worktreeManager: { createWorktree, removeWorktree },
            worktreeInfo: ctx.worktreeInfo ?? { path: ctx.cwd, branch: ctx.branch.work },
            gitConfig: ctx.config.git,
            worktreeConfig: ctx.config.worktree,
            slug: ctx.slug ?? createSlug(ctx.issue.title),
          });

          if (result.success) {
            logger.info(`Phase ${phase.index + 1} succeeded on retry ${attempt}`);
            jl?.log(`Phase ${phase.index + 1} 재시도 ${attempt} 성공`);
            phaseErrorHistories.delete(phase.index);
            break;
          }

          errorHistory = addErrorToHistory(phaseErrorHistories, phase.index, attempt, result.errorCategory, result.error);
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
        const totalCostUsd = phaseResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) + (planCostUsd ?? 0);
        const allUsages = [planUsage, ...phaseResults.map(r => r.usage)];
        const totalUsage = sumUsage(allUsages);
        return { plan, phaseResults, success: false, totalCostUsd, totalUsage };
      }

      logger.info(`Phase ${phase.index + 1} completed (commit: ${result.commitHash?.slice(0, 8)})`);
      jl?.log(`Phase ${phase.index + 1} 완료 (${result.commitHash?.slice(0, 8)})`);
      jl?.setProgress(phaseStart(phase.index + 1, plan.phases.length));
    }

    logger.info(`Level ${group.level} completed: ${remainingPhases.length} phases executed`);
  }

  // Calculate total cost from phase results and plan generation
  const phasesTotalCost = phaseResults.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
  const totalCostUsd = phasesTotalCost + (planCostUsd ?? 0);

  // Calculate total usage from plan and phase results
  const allUsages = [planUsage, ...phaseResults.map(r => r.usage)];
  const totalUsage = sumUsage(allUsages);

  logger.info(`\nAll ${plan.phases.length} phases completed successfully`);
  logger.info(`Total pipeline cost: $${totalCostUsd.toFixed(4)} (plan: $${(planCostUsd ?? 0).toFixed(4)}, phases: $${phasesTotalCost.toFixed(4)})`);
  if (totalUsage) {
    logger.info(`Total usage: input=${totalUsage.input_tokens}, output=${totalUsage.output_tokens}, cache_creation=${totalUsage.cache_creation_input_tokens ?? 0}, cache_read=${totalUsage.cache_read_input_tokens ?? 0}`);
  }

  return { plan, phaseResults, success: true, totalCostUsd, totalUsage };
}
