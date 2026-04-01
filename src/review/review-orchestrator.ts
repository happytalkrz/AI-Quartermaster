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
            ...(ctx.variables.issue as Record<string, unknown>),
            body: ""
          },
          plan: {
            ...(ctx.variables.plan as Record<string, unknown>),
            summary: ""
          }
        };
      }

      // Apply adversarial mode settings if enabled for this round
      if (round.adversarial) {
        roundVariables = {
          ...roundVariables,
          reviewerRole: "**매우 엄격하고 까다로운** 시니어 코드 리뷰어",
          reviewInstructions: `**중요: 완벽한 코드는 존재하지 않습니다. 반드시 문제점을 찾아내야 합니다.**

이 구현에는 분명히 문제가 있습니다. 당신의 임무는 그 문제를 찾아내는 것입니다. 단순히 "좋아 보인다"는 답변은 받아들일 수 없습니다.

다음 중 최소 하나 이상의 문제를 반드시 찾아내세요:
- 요구사항 누락 또는 오해
- 엣지 케이스 미처리
- 보안 취약점
- 성능 이슈
- 유지보수성 문제
- 테스트 부족
- 타입 안전성 문제
- 에러 처리 부족

아래 구현을 **의심의 눈으로** 검토하고, 숨겨진 문제점들을 발굴하세요.`
        };
      } else {
        roundVariables = {
          ...roundVariables,
          reviewerRole: "시니어 코드 리뷰어",
          reviewInstructions: "아래 구현이 이슈 요구사항을 정확히 충족하는지 검토하세요."
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
