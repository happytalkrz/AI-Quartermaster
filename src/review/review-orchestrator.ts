import { runReviewRound } from "./review-runner.js";
import { configForTaskWithMode } from "../claude/model-router.js";
import { runClaude, extractJson } from "../claude/claude-runner.js";
import { loadTemplate, renderTemplate, type TemplateVariables } from "../prompt/template-renderer.js";
import { exceedsTokenLimit, getEffectiveTokenLimit } from "./token-estimator.js";
import { splitDiffByFiles, groupFilesByTokenBudget, combineBatchDiffs } from "./diff-splitter.js";
import { mergeReviewResults } from "./result-merger.js";
import { getLogger } from "../utils/logger.js";
import { resolve } from "path";
import type { ReviewConfig, ReviewRound, ClaudeCliConfig, ExecutionMode } from "../types/config.js";
import type { ReviewResult, ReviewPipelineResult, SplitReviewResult, UnifiedReviewResult, UnifiedReviewPerspective, ReviewFinding } from "../types/review.js";

// 통합 리뷰 API 응답 타입
type UnifiedReviewResponse = {
  functionalCompliance: { verdict: "PASS" | "FAIL"; findings: ReviewFinding[]; summary: string };
  architectureDesign: { verdict: "PASS" | "FAIL"; findings: ReviewFinding[]; summary: string };
  simplification: { verdict: "PASS" | "FAIL"; findings: ReviewFinding[]; summary: string };
  overall: { verdict: "PASS" | "FAIL"; criticalIssues: string[]; summary: string };
};

const logger = getLogger();

export interface ReviewOrchestratorContext {
  reviewConfig: ReviewConfig;
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  variables: TemplateVariables;
  maxRounds?: number; // Limit number of rounds based on ExecutionModePreset
  executionMode: ExecutionMode;
}

function applyRoundModes(variables: TemplateVariables, round: ReviewRound): TemplateVariables {
  let result = variables;

  if (round.blind) {
    result = {
      ...result,
      issue: { ...(result.issue as Record<string, unknown>), body: "" },
      plan: { ...(result.plan as Record<string, unknown>), summary: "" },
    };
  }

  const { reviewerRole, reviewInstructions } = round.adversarial
    ? {
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

아래 구현을 **의심의 눈으로** 검토하고, 숨겨진 문제점들을 발굴하세요.`,
      }
    : {
        reviewerRole: "시니어 코드 리뷰어",
        reviewInstructions: "아래 구현이 이슈 요구사항을 정확히 충족하는지 검토하세요.",
      };

  return { ...result, reviewerRole, reviewInstructions };
}

/**
 * 분할 리뷰를 실행합니다.
 * diff를 파일별로 분할하여 토큰 한도 내에서 개별 리뷰를 실행하고 결과를 병합합니다.
 */
async function runSplitReview(
  ctx: ReviewOrchestratorContext,
  round: ReviewRound,
  claudeConfig: ClaudeCliConfig,
  template: string,
  roundVariables: TemplateVariables
): Promise<ReviewResult> {
  const fullDiff = String(roundVariables.diff);
  logger.info(`Splitting review for round "${round.name}" due to token limit exceeded`);

  // diff를 파일별로 분할
  const fileDiffs = splitDiffByFiles(fullDiff);
  if (fileDiffs.length === 0) {
    logger.warn("No file diffs found for split review");
    return {
      roundName: round.name,
      verdict: "PASS",
      findings: [],
      summary: "No changes to review",
      durationMs: 0,
    };
  }

  // 토큰 예산 계산 (diff 외의 템플릿 콘텐츠)
  const templateWithoutDiff = renderTemplate(template, { ...roundVariables, diff: "" });
  const effectiveLimit = getEffectiveTokenLimit(claudeConfig.model || "default");

  // 파일들을 토큰 예산에 맞춰 배치로 그룹화
  const batches = groupFilesByTokenBudget(fileDiffs, effectiveLimit, templateWithoutDiff);

  logger.info(`Split into ${batches.length} batches for review`);

  // 각 배치별로 리뷰 실행
  const splitResults: SplitReviewResult[] = [];

  for (const batch of batches) {
    const batchDiff = combineBatchDiffs(batch);
    const batchVariables = {
      ...roundVariables,
      diff: batchDiff,
    };

    const result = await runReviewRound({
      roundName: `${round.name} (Split ${batch.batchIndex + 1}/${batches.length})`,
      promptTemplate: round.promptTemplate,
      promptsDir: ctx.promptsDir,
      claudeConfig,
      cwd: ctx.cwd,
      variables: batchVariables,
    });

    // 분할 정보 추가
    const splitResult: SplitReviewResult = {
      ...result,
      splitInfo: {
        totalSplits: batches.length,
        currentSplit: batch.batchIndex,
        splitBy: "file",
      },
    };

    splitResults.push(splitResult);
  }

  // 결과 병합
  const mergedResult = mergeReviewResults(splitResults, round.name);

  logger.info(`Completed split review for "${round.name}": ${mergedResult.verdict}`);
  return mergedResult;
}

/**
 * 통합 리뷰 응답을 관점 객체로 변환합니다.
 */
function parsePerspectives(parsed: UnifiedReviewResponse): UnifiedReviewPerspective[] {
  return [
    {
      perspective: "functionality",
      verdict: parsed.functionalCompliance.verdict,
      findings: parsed.functionalCompliance.findings || [],
      summary: parsed.functionalCompliance.summary || "",
    },
    {
      perspective: "architecture",
      verdict: parsed.architectureDesign.verdict,
      findings: parsed.architectureDesign.findings || [],
      summary: parsed.architectureDesign.summary || "",
    },
    {
      perspective: "simplification",
      verdict: parsed.simplification.verdict,
      findings: parsed.simplification.findings || [],
      summary: parsed.simplification.summary || "",
    },
  ];
}

/**
 * 통합 리뷰를 실행합니다.
 * 1회 호출로 기능 정합성, 구조/설계, 단순화 관점을 모두 평가합니다.
 */
async function runUnifiedReview(ctx: ReviewOrchestratorContext): Promise<UnifiedReviewResult> {
  const startTime = Date.now();
  logger.info("Starting unified review (3 perspectives in 1 call)");

  // unified review용 Claude 설정
  const claudeConfig = configForTaskWithMode(ctx.claudeConfig, "review", ctx.executionMode);

  // 통합 리뷰 프롬프트 템플릿 로드
  const templatePath = resolve(ctx.promptsDir, "review-unified.md");
  const template = loadTemplate(templatePath);

  // 기본 변수에 reviewerRole과 reviewInstructions 추가
  const reviewVariables = {
    ...ctx.variables,
    reviewerRole: "시니어 코드 리뷰어",
    reviewInstructions: "아래 구현이 이슈 요구사항을 정확히 충족하는지 검토하세요.",
  };

  const rendered = renderTemplate(template, reviewVariables);

  // Claude 호출
  const result = await runClaude({
    prompt: rendered,
    cwd: ctx.cwd,
    config: claudeConfig,
    enableAgents: false, // 통합 리뷰는 단일 호출로 처리
  });

  if (!result.success) {
    logger.error(`Unified review failed: ${result.output}`);
    return {
      overallVerdict: "FAIL",
      perspectives: [],
      overallSummary: `Unified review failed due to Claude error: ${result.output}`,
      durationMs: Date.now() - startTime,
      model: claudeConfig.model,
    };
  }

  try {
    const parsed = extractJson<UnifiedReviewResponse>(result.output);
    const perspectives = parsePerspectives(parsed);
    const durationMs = Date.now() - startTime;

    logger.info(`Unified review completed in ${durationMs}ms: ${parsed.overall.verdict}`);
    logger.info(
      `Perspectives: functionality=${parsed.functionalCompliance.verdict}, ` +
      `architecture=${parsed.architectureDesign.verdict}, ` +
      `simplification=${parsed.simplification.verdict}`
    );

    return {
      overallVerdict: parsed.overall.verdict,
      perspectives,
      overallSummary: parsed.overall.summary || "",
      durationMs,
      model: claudeConfig.model,
    };
  } catch (err: unknown) {
    logger.error(`Failed to parse unified review JSON response: ${err}`);
    const output = result.output.toLowerCase();
    const verdict = output.includes('"pass"') || output.includes("verdict: pass") ? "PASS" : "FAIL";

    return {
      overallVerdict: verdict as "PASS" | "FAIL",
      perspectives: [],
      overallSummary: `JSON parsing failed. Raw output: ${result.output.slice(0, 500)}`,
      durationMs: Date.now() - startTime,
      model: claudeConfig.model,
    };
  }
}

export async function runReviews(ctx: ReviewOrchestratorContext): Promise<ReviewPipelineResult> {
  if (!ctx.reviewConfig.enabled) {
    logger.info("Reviews disabled, skipping");
    return { rounds: [], allPassed: true };
  }

  // 통합 리뷰 모드가 활성화된 경우 단일 호출로 처리
  if (ctx.reviewConfig.unifiedMode) {
    logger.info("Unified review mode enabled - running 3 perspectives in 1 call");
    const unifiedResult = await runUnifiedReview(ctx);

    // UnifiedReviewResult를 ReviewPipelineResult로 변환
    const convertedRounds: ReviewResult[] = unifiedResult.perspectives.map(perspective => ({
      roundName: `Unified Review - ${perspective.perspective}`,
      verdict: perspective.verdict,
      findings: perspective.findings,
      summary: perspective.summary,
      durationMs: Math.round(unifiedResult.durationMs / unifiedResult.perspectives.length), // 시간을 관점별로 균등 분배
    }));

    return {
      rounds: convertedRounds,
      allPassed: unifiedResult.overallVerdict === "PASS",
    };
  }

  // 기존 라운드별 순차 리뷰 방식
  const results: ReviewResult[] = [];
  let allPassed = true;

  // Limit rounds based on ExecutionModePreset
  const roundsToExecute = ctx.maxRounds !== undefined
    ? ctx.reviewConfig.rounds.slice(0, ctx.maxRounds)
    : ctx.reviewConfig.rounds;

  if (ctx.maxRounds !== undefined && ctx.maxRounds < ctx.reviewConfig.rounds.length) {
    logger.info(`Limited review rounds: executing ${ctx.maxRounds}/${ctx.reviewConfig.rounds.length} rounds`);
  }

  for (const round of roundsToExecute) {
    logger.info(`\n--- Review Round: ${round.name} ---`);

    let result: ReviewResult | undefined;
    let attempts = 0;
    const maxAttempts = round.failAction === "retry" ? round.maxRetries + 1 : 1;

    while (attempts < maxAttempts) {
      attempts++;

      const claudeConfig = round.model
        ? { ...ctx.claudeConfig, model: round.model }
        : configForTaskWithMode(ctx.claudeConfig, "review", ctx.executionMode);

      const roundVariables = applyRoundModes(ctx.variables, round);

      // 토큰 체크를 위해 템플릿 미리 렌더링
      const templatePath = resolve(ctx.promptsDir, round.promptTemplate);
      const template = loadTemplate(templatePath);
      const renderedPrompt = renderTemplate(template, roundVariables);

      // 토큰 한도 체크
      const modelName = claudeConfig.model || "default";
      if (exceedsTokenLimit(renderedPrompt, modelName)) {
        logger.info(`Token limit exceeded for round "${round.name}", using split review`);
        result = await runSplitReview(ctx, round, claudeConfig, template, roundVariables);
      } else {
        logger.info(`Token limit within bounds for round "${round.name}", using standard review`);
        result = await runReviewRound({
          roundName: round.name,
          promptTemplate: round.promptTemplate,
          promptsDir: ctx.promptsDir,
          claudeConfig,
          cwd: ctx.cwd,
          variables: roundVariables,
        });
      }

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
