import { resolve } from "path";
import { existsSync } from "fs";
import { getDiffContent } from "../git/diff-collector.js";
import { runReviews } from "../review/review-orchestrator.js";
import { runAnalyst } from "../review/analyst-runner.js";
import { runSimplify } from "../review/simplify-runner.js";
import { retryWithClaudeFix } from "./retry-with-fix.js";
import { configForTaskWithMode } from "../claude/model-router.js";
import { getLogger } from "../utils/logger.js";
import { PROGRESS_REVIEW_START } from "./progress-tracker.js";
import type {
  ReviewVariables,
  ReviewPipelineResult,
  AnalystResult,
  ReviewFixAttempt
} from "../types/review.js";
import type { TemplateVariables } from "../prompt/template-renderer.js";
import type {
  GitConfig,
  ProjectConfig,
  ExecutionModePreset,
  ExecutionMode
} from "../types/config.js";
import type { PipelineState, Plan, PhaseResult } from "../types/pipeline.js";
import type { PipelineCheckpoint } from "./checkpoint.js";
import type { JobLogger } from "../queue/job-logger.js";
import type { PipelineTimer } from "../safety/timeout-manager.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";

const logger = getLogger();

/**
 * ExecutionModePreset에서 ExecutionMode를 역추적합니다.
 * reviewRounds 값을 기반으로 모드를 결정합니다.
 */
function getExecutionModeFromPreset(preset: ExecutionModePreset): ExecutionMode {
  if (preset.reviewRounds === 0) return "economy";
  if (preset.reviewRounds === 3) return "thorough";
  return "standard"; // reviewRounds === 1 or other values
}

function hasCriticalAnalystIssues(result: AnalystResult | undefined): boolean {
  return result?.findings.some(f =>
    f.severity === "error" && (f.type === "missing" || f.type === "mismatch")
  ) || false;
}

interface ReviewRetryResult {
  reviewResult: ReviewPipelineResult;
  analystResult?: AnalystResult;
  fixAttempts: ReviewFixAttempt[];
}

export interface ReviewContext {
  issue: GitHubIssue;
  coreResult: { plan: Plan; phaseResults: unknown[] };
  gitConfig: GitConfig;
  project: ProjectConfig;
  worktreePath: string;
  promptsDir: string;
  skillsContext: string;
  jl?: JobLogger;
  timer: PipelineTimer;
  checkpoint: (overrides?: Partial<PipelineCheckpoint>) => void;
}

export interface SimplifyContext {
  project: ProjectConfig;
  worktreePath: string;
  promptsDir: string;
  reviewVariables: ReviewVariables;
  gitConfig: GitConfig;
  jl?: JobLogger;
  timer: PipelineTimer;
  checkpoint: (overrides?: Partial<PipelineCheckpoint>) => void;
}


export async function buildReviewVars(ctx: ReviewContext): Promise<ReviewVariables> {
  if (!ctx.project.commands?.test) {
    throw new Error("Project test command not configured");
  }
  if (!ctx.project.commands?.lint) {
    throw new Error("Project lint command not configured");
  }
  if (!ctx.project.baseBranch) {
    throw new Error("Project base branch not configured");
  }

  return {
    issue: {
      number: String(ctx.issue.number),
      title: ctx.issue.title,
      body: ctx.issue.body
    },
    plan: { summary: ctx.coreResult.plan.problemDefinition },
    diff: { full: await getDiffContent(ctx.gitConfig, ctx.project.baseBranch, { cwd: ctx.worktreePath }) },
    config: {
      testCommand: ctx.project.commands.test,
      lintCommand: ctx.project.commands.lint
    },
    skillsContext: ctx.skillsContext,
  };
}

export async function runReviewPhase(
  ctx: ReviewContext,
  executionModePreset: ExecutionModePreset,
  state: PipelineState,
  isPastState: (current: PipelineState, target: PipelineState) => boolean
): Promise<{
  success: boolean;
  reviewResult?: ReviewPipelineResult;
  reviewVariables?: ReviewVariables;
  error?: string;
}> {
  let reviewVariables: ReviewVariables | undefined;

  // Skip review if executionMode is economy (reviewRounds = 0)
  if (executionModePreset.reviewRounds > 0) {
    if (isPastState(state, "REVIEWING")) {
      logger.info(`[SKIP] PLAN_GENERATED → REVIEWING (already done)`);
    } else {
      ctx.timer.assertNotExpired("review");
      logger.info("[REVIEWING] Starting analyst and review rounds...");
      ctx.jl?.setStep("요구사항 대조 분석 중...");
      ctx.jl?.setProgress(PROGRESS_REVIEW_START);

      reviewVariables = await buildReviewVars(ctx);

      // === Phase 1: Requirements Analysis ===
      const analystTemplatePath = resolve(ctx.promptsDir, "analyst-requirements.md");
      let analystResult: AnalystResult | undefined;

      if (existsSync(analystTemplatePath)) {
        if (!ctx.project.commands?.claudeCli) {
          throw new Error("Claude CLI configuration not found");
        }
        analystResult = await runAnalyst({
          promptsDir: ctx.promptsDir,
          claudeConfig: ctx.project.commands.claudeCli,
          cwd: ctx.worktreePath,
          variables: reviewVariables as unknown as TemplateVariables,
        });
        ctx.jl?.log(`분석: ${analystResult.verdict} (${analystResult.findings.length}개 발견)`);
      } else {
        logger.info("[REVIEWING] Analyst template not found, skipping requirements analysis");
      }

      // === Phase 2: Code Review Rounds ===
      ctx.jl?.setStep("리뷰 진행 중...");
      if (!ctx.project.review) {
        throw new Error("Review configuration not found");
      }
      if (!ctx.project.commands?.claudeCli) {
        throw new Error("Claude CLI configuration not found");
      }
      let reviewResult: ReviewPipelineResult = await runReviews({
        reviewConfig: ctx.project.review as Required<typeof ctx.project.review>,
        claudeConfig: ctx.project.commands.claudeCli,
        promptsDir: ctx.promptsDir,
        cwd: ctx.worktreePath,
        variables: reviewVariables as unknown as TemplateVariables,
        maxRounds: executionModePreset.reviewRounds,
        executionMode: getExecutionModeFromPreset(executionModePreset),
      });

      if (analystResult) {
        reviewResult.analyst = analystResult;
      }

      for (const round of reviewResult.rounds) {
        ctx.jl?.log(`리뷰 "${round.roundName}": ${round.verdict}`);
      }

      const hasCritical = hasCriticalAnalystIssues(analystResult);

      if (hasCritical || !reviewResult.allPassed) {
        if (!ctx.project.safety?.maxRetries) {
          throw new Error("Safety configuration not found");
        }
        if (!ctx.project.commands?.claudeCli) {
          throw new Error("Claude CLI configuration not found");
        }

        const claudeCliConfig = ctx.project.commands.claudeCli;
        const fixAttempts: ReviewFixAttempt[] = [];

        const retryResult = await retryWithClaudeFix<ReviewRetryResult>({
          checkFn: async () => {
            const currentHasCritical = hasCriticalAnalystIssues(analystResult);
            const success = !currentHasCritical && reviewResult.allPassed;
            return {
              success,
              result: {
                reviewResult,
                analystResult,
                fixAttempts: []
              }
            };
          },

          buildFixPromptFn: (result: ReviewRetryResult) => {
            const currentAnalystResult = result.analystResult;
            const currentReviewResult = result.reviewResult;
            const currentHasCritical = hasCriticalAnalystIssues(currentAnalystResult);

            const analystFindings = currentAnalystResult?.findings.filter(f =>
              f.severity === "error" && (f.type === "missing" || f.type === "mismatch")
            ) || [];
            const reviewFindings = currentReviewResult.rounds.flatMap(round =>
              round.findings.filter(f => f.severity === "error")
            );

            const details = [];
            if (currentHasCritical) {
              details.push("=== Requirements Analysis Issues ===");
              details.push(...analystFindings.map(f =>
                `- ${f.message}${f.suggestion ? ` (Suggestion: ${f.suggestion})` : ""}`
              ));
            }
            if (!currentReviewResult.allPassed) {
              details.push("=== Code Review Issues ===");
              details.push(...reviewFindings.map(f =>
                `- ${f.message}${f.suggestion ? ` (Suggestion: ${f.suggestion})` : ""}${f.file && f.line ? ` (${f.file}:${f.line})` : ""}`
              ));
            }

            return [
              "The following review issues were found. Fix the errors only — do not add new features or refactor unrelated code.",
              "",
              details.join("\n"),
            ].join("\n");
          },

          revalidateFn: async () => {
            // Re-run reviews
            if (!reviewVariables) {
              reviewVariables = await buildReviewVars(ctx);
            }

            const retryReviewResult = await runReviews({
              reviewConfig: ctx.project.review as Required<typeof ctx.project.review>,
              claudeConfig: claudeCliConfig,
              promptsDir: ctx.promptsDir,
              cwd: ctx.worktreePath,
              variables: reviewVariables as unknown as TemplateVariables,
              maxRounds: executionModePreset.reviewRounds,
              executionMode: getExecutionModeFromPreset(executionModePreset),
            });

            let retryAnalystResult: AnalystResult | undefined;
            if (analystResult) {
              retryAnalystResult = await runAnalyst({
                promptsDir: ctx.promptsDir,
                claudeConfig: claudeCliConfig,
                cwd: ctx.worktreePath,
                variables: reviewVariables as unknown as TemplateVariables,
              });
            }

            const retryHasCriticalAnalystIssues = hasCriticalAnalystIssues(retryAnalystResult);
            const success = !retryHasCriticalAnalystIssues && retryReviewResult.allPassed;

            return {
              success,
              result: {
                reviewResult: retryReviewResult,
                analystResult: retryAnalystResult,
                fixAttempts
              }
            };
          },

          maxRetries: ctx.project.safety.maxRetries,
          claudeConfig: claudeCliConfig,
          cwd: ctx.worktreePath,
          gitPath: ctx.gitConfig.gitPath,
          commitMessageTemplate: "fix: review 오류 수정 (retry {attempt})",

          onAttempt: (attempt, maxRetries, description) => {
            logger.info(`[REVIEWING] Retry ${attempt}/${maxRetries} — fixing: ${description}`);
            ctx.jl?.log(`리뷰 실패 수정 시도 ${attempt}/${maxRetries}: ${description}`);
            ctx.jl?.setStep(`리뷰 오류 수정 중 (${attempt}/${maxRetries})...`);
          },

          onSuccess: (attempt, result) => {
            logger.info(`[REVIEWING] Passed after retry ${attempt}`);
            ctx.jl?.log(`리뷰 통과 (retry ${attempt})`);

            // Update results
            reviewResult = { ...result.reviewResult, fixAttempts };
            if (result.analystResult) {
              reviewResult.analyst = result.analystResult;
              analystResult = result.analystResult;
            }
          },

          onFailure: (maxRetries, finalResult) => {
            const finalFindings = [
              ...(finalResult.analystResult?.findings.filter(f => f.severity === "error") || []),
              ...finalResult.reviewResult.rounds.flatMap(round => round.findings.filter(f => f.severity === "error"))
            ];
            const finalSummary = finalFindings.map(f => f.message).join(", ");

            logger.error(`[REVIEWING] Failed after ${maxRetries} retries: ${finalSummary}`);
            ctx.jl?.log(`실패: Review failed after ${maxRetries} retries: ${finalSummary}`);
            ctx.jl?.setStep("실패");
          }
        });

        if (!retryResult.success) {
          const finalFindings = [
            ...(retryResult.result.analystResult?.findings.filter(f => f.severity === "error") || []),
            ...retryResult.result.reviewResult.rounds.flatMap(round => round.findings.filter(f => f.severity === "error"))
          ];
          const finalSummary = finalFindings.map(f => f.message).join(", ");

          // Add fix attempts to final result
          reviewResult.fixAttempts = fixAttempts;

          return {
            success: false,
            error: `Review failed after ${ctx.project.safety.maxRetries} retries: ${finalSummary}`,
            reviewResult,
            reviewVariables
          };
        }
      }

      ctx.checkpoint({ plan: ctx.coreResult.plan, phaseResults: ctx.coreResult.phaseResults as PhaseResult[] });

      return {
        success: true,
        reviewResult,
        reviewVariables
      };
    }
  }

  return { success: true };
}

export async function runSimplifyPhase(
  ctx: SimplifyContext,
  executionModePreset: ExecutionModePreset,
  state: PipelineState,
  isPastState: (current: PipelineState, target: PipelineState) => boolean
): Promise<{ success: boolean; error?: string }> {
  const PROGRESS_SIMPLIFY_START = 80;

  if (executionModePreset.enableSimplify && ctx.project.review?.simplify?.enabled) {
    if (isPastState(state, "SIMPLIFYING")) {
      logger.info(`[SKIP] REVIEWING → SIMPLIFYING (already done)`);
    } else {
      ctx.timer.assertNotExpired("simplify");
      logger.info("[SIMPLIFYING] Running code simplification...");
      ctx.jl?.setStep("코드 간소화 중...");
      ctx.jl?.setProgress(PROGRESS_SIMPLIFY_START);

      if (!ctx.project.review?.simplify?.promptTemplate) {
        throw new Error("Simplify prompt template not configured");
      }
      if (!ctx.project.commands?.claudeCli) {
        throw new Error("Claude CLI configuration not found");
      }
      if (!ctx.project.commands?.test) {
        throw new Error("Test command not configured");
      }

      await runSimplify({
        promptTemplate: ctx.project.review.simplify.promptTemplate,
        promptsDir: ctx.promptsDir,
        claudeConfig: ctx.project.commands.claudeCli,
        cwd: ctx.worktreePath,
        testCommand: ctx.project.commands.test,
        variables: ctx.reviewVariables as unknown as TemplateVariables,
        gitPath: ctx.gitConfig.gitPath,
      });

      ctx.checkpoint();
    }
  }

  return { success: true };
}