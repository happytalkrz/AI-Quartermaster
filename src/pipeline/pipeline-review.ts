import { resolve } from "path";
import { existsSync } from "fs";
import { runClaude } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";
import { getDiffContent } from "../git/diff-collector.js";
import { runReviews } from "../review/review-orchestrator.js";
import { runAnalyst } from "../review/analyst-runner.js";
import { runSimplify } from "../review/simplify-runner.js";
import { getLogger } from "../utils/logger.js";
import type {
  ReviewVariables,
  ReviewPipelineResult,
  AnalystResult,
  ReviewFixAttempt
} from "../types/review.js";
import type {
  GitConfig,
  ProjectConfig
} from "../types/config.js";
import type { PipelineState, Plan } from "../types/pipeline.js";
import type { JobLogger } from "../queue/job-logger.js";
import type { PipelineTimer } from "../safety/timeout-manager.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import type { TemplateVariables } from "../prompt/template-renderer.js";

const logger = getLogger();

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
  checkpoint: (data: unknown) => void;
}

export interface SimplifyContext {
  project: ProjectConfig;
  worktreePath: string;
  promptsDir: string;
  reviewVariables: ReviewVariables;
  gitConfig: GitConfig;
  jl?: JobLogger;
  timer: PipelineTimer;
  checkpoint: (data: unknown) => void;
}

function toTemplateVariables(vars: ReviewVariables): TemplateVariables {
  return vars as unknown as TemplateVariables;
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
  preset: { skipReview: boolean },
  state: PipelineState,
  isPastState: (current: PipelineState, target: PipelineState) => boolean
): Promise<{
  success: boolean;
  reviewResult?: ReviewPipelineResult;
  reviewVariables?: ReviewVariables;
  error?: string;
}> {
  const PROGRESS_REVIEW_START = 30;

  let reviewVariables: ReviewVariables | undefined;

  if (!preset.skipReview) {
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
          variables: toTemplateVariables(reviewVariables),
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
        variables: toTemplateVariables(reviewVariables),
      });

      if (analystResult) {
        reviewResult.analyst = analystResult;
      }

      for (const round of reviewResult.rounds) {
        ctx.jl?.log(`리뷰 "${round.roundName}": ${round.verdict}`);
      }

      const hasCriticalAnalystIssues = analystResult?.findings.some(f =>
        f.severity === "error" && (f.type === "missing" || f.type === "mismatch")
      ) || false;

      if (hasCriticalAnalystIssues || !reviewResult.allPassed) {
        if (!ctx.project.safety?.maxRetries) {
          throw new Error("Safety configuration not found");
        }
        const maxRetries = ctx.project.safety.maxRetries;
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
          ctx.jl?.log(`리뷰 실패 수정 시도 ${attempt}/${maxRetries}: ${findingsSummary}`);
          ctx.jl?.setStep(`리뷰 오류 수정 중 (${attempt}/${maxRetries})...`);

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
          if (!ctx.project.commands?.claudeCli) {
            throw new Error("Claude CLI configuration not found");
          }
          const claudeConfig = configForTask(ctx.project.commands.claudeCli, "fallback");
          let fixSuccess = false;
          let fixError: string | undefined;

          try {
            await runClaude({
              prompt: fixPrompt,
              cwd: ctx.worktreePath,
              config: claudeConfig,
            });

            await autoCommitIfDirty(ctx.gitConfig.gitPath, ctx.worktreePath, `fix: review 오류 수정 (retry ${attempt})`);

            // Re-run reviews
            if (!reviewVariables) {
              reviewVariables = await buildReviewVars(ctx);
            }

            const retryReviewResult = await runReviews({
              reviewConfig: ctx.project.review as Required<typeof ctx.project.review>,
              claudeConfig: ctx.project.commands.claudeCli,
              promptsDir: ctx.promptsDir,
              cwd: ctx.worktreePath,
              variables: toTemplateVariables(reviewVariables),
            });

            let retryAnalystResult: AnalystResult | undefined;
            if (analystResult) {
              retryAnalystResult = await runAnalyst({
                promptsDir: ctx.promptsDir,
                claudeConfig: ctx.project.commands.claudeCli,
                cwd: ctx.worktreePath,
                variables: toTemplateVariables(reviewVariables),
              });
            }

            const retryHasCriticalAnalystIssues = retryAnalystResult?.findings.some(f =>
              f.severity === "error" && (f.type === "missing" || f.type === "mismatch")
            ) || false;

            fixSuccess = !retryHasCriticalAnalystIssues && retryReviewResult.allPassed;

            if (fixSuccess) {
              logger.info(`[REVIEWING] Passed after retry ${attempt}`);
              ctx.jl?.log(`리뷰 통과 (retry ${attempt})`);
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
                ctx.jl?.log(`리뷰 "${round.roundName}": ${round.verdict} (retry ${attempt})`);
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
          ctx.jl?.log(`실패: Review failed after ${maxRetries} retries: ${finalSummary}`);
          ctx.jl?.setStep("실패");

          // Add fix attempts to final result
          reviewResult.fixAttempts = fixAttempts;

          return {
            success: false,
            error: `Review failed after ${maxRetries} retries: ${finalSummary}`,
            reviewResult,
            reviewVariables
          };
        }
      }

      ctx.checkpoint({ plan: ctx.coreResult.plan, phaseResults: ctx.coreResult.phaseResults });

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
  preset: { skipSimplify: boolean },
  state: PipelineState,
  isPastState: (current: PipelineState, target: PipelineState) => boolean
): Promise<{ success: boolean; error?: string }> {
  const PROGRESS_SIMPLIFY_START = 80;

  if (!preset.skipSimplify && ctx.project.review?.simplify?.enabled) {
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
        variables: toTemplateVariables(ctx.reviewVariables),
        gitPath: ctx.gitConfig.gitPath,
      });

      ctx.checkpoint({ plan: "placeholder", phaseResults: [] });
    }
  }

  return { success: true };
}