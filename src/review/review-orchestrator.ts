import { runReviewRound } from "./review-runner.js";
import { configForTask } from "../claude/model-router.js";
import type { TemplateVariables } from "../prompt/template-renderer.js";
import { getLogger } from "../utils/logger.js";
import type { ReviewConfig, ClaudeCliConfig } from "../types/config.js";
import type { ReviewResult, ReviewPipelineResult } from "../types/review.js";

const logger = getLogger();

export interface ReviewOrchestratorContext {
  reviewConfig: ReviewConfig;
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  variables: TemplateVariables;
}

export async function runReviews(ctx: ReviewOrchestratorContext): Promise<ReviewPipelineResult> {
  if (!ctx.reviewConfig.enabled) {
    logger.info("Reviews disabled, skipping");
    return { rounds: [], allPassed: true };
  }

  const results: ReviewResult[] = [];
  let allPassed = true;

  for (const round of ctx.reviewConfig.rounds) {
    logger.info(`\n--- Review Round: ${round.name} ---`);

    let result: ReviewResult | undefined;
    let attempts = 0;
    const maxAttempts = round.failAction === "retry" ? round.maxRetries + 1 : 1;

    while (attempts < maxAttempts) {
      attempts++;

      const claudeConfig = round.model
        ? { ...ctx.claudeConfig, model: round.model }
        : configForTask(ctx.claudeConfig, "review");

      // Apply blind mode filtering if enabled for this round
      let roundVariables = ctx.variables;
      if (round.blind) {
        roundVariables = {
          ...ctx.variables,
          issue: {
            ...ctx.variables.issue,
            body: ""
          },
          plan: {
            ...ctx.variables.plan,
            summary: ""
          }
        };
      }

      result = await runReviewRound({
        roundName: round.name,
        promptTemplate: round.promptTemplate,
        promptsDir: ctx.promptsDir,
        claudeConfig,
        cwd: ctx.cwd,
        variables: roundVariables,
      });

      if (result.verdict === "PASS") {
        logger.info(`Review "${round.name}" PASSED`);
        break;
      }

      if (attempts < maxAttempts) {
        logger.warn(`Review "${round.name}" FAILED (attempt ${attempts}/${maxAttempts}), retrying...`);
      }
    }

    if (!result) continue;
    results.push(result);

    if (result.verdict === "FAIL") {
      switch (round.failAction) {
        case "block":
          logger.error(`Review "${round.name}" FAILED with block action. Pipeline halted.`);
          return { rounds: results, allPassed: false };
        case "warn":
          logger.warn(`Review "${round.name}" FAILED with warn action. Continuing.`);
          break;
        case "retry":
          // Already retried above, if still failing it's a block
          logger.error(`Review "${round.name}" FAILED after ${maxAttempts} attempts.`);
          allPassed = false;
          return { rounds: results, allPassed: false };
      }
    }
  }

  return { rounds: results, allPassed };
}
