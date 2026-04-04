import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import type { TemplateVariables } from "../prompt/template-renderer.js";
import { runClaude, extractJson } from "../claude/claude-runner.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { AnalystResult, AnalystFinding } from "../types/review.js";
import type { UsageInfo } from "../types/pipeline.js";
import { analyzeTokenUsage } from "./token-estimator.js";
import { splitDiffByFiles, groupFilesByTokenBudget, combineBatchDiffs, generateSplitStats } from "./diff-splitter.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export interface AnalystContext {
  promptsDir: string;
  claudeConfig: ClaudeCliConfig;
  cwd: string;
  variables: TemplateVariables;
}

const EMPTY_COVERAGE = { implemented: [] as string[], missing: [] as string[], excess: [] as string[] };

function createAnalystResult(
  verdict: "COMPLETE" | "INCOMPLETE" | "MISALIGNED",
  durationMs: number,
  findings: AnalystFinding[] = [],
  summary: string = "",
  coverage = EMPTY_COVERAGE,
  costUsd?: number,
  usage?: UsageInfo
): AnalystResult {
  return { verdict, findings, summary, coverage, durationMs, costUsd, usage };
}

function extractVerdictFromText(text: string): "COMPLETE" | "INCOMPLETE" | "MISALIGNED" {
  const lower = text.toLowerCase();
  if (lower.includes('"complete"') || lower.includes("verdict: complete")) return "COMPLETE";
  if (lower.includes('"misaligned"') || lower.includes("verdict: misaligned")) return "MISALIGNED";
  return "INCOMPLETE";
}

/**
 * 단일 diff에 대해 analyst 분석을 실행합니다.
 */
async function runSingleAnalyst(ctx: AnalystContext): Promise<AnalystResult> {
  const startTime = Date.now();
  const durationMs = () => Date.now() - startTime;

  const templatePath = resolve(ctx.promptsDir, "analyst-requirements.md");
  const template = loadTemplate(templatePath);
  const rendered = renderTemplate(template, ctx.variables);

  const result = await runClaude({
    prompt: rendered,
    cwd: ctx.cwd,
    config: ctx.claudeConfig,
    enableAgents: false,
  });

  if (!result.success) {
    return createAnalystResult(
      "INCOMPLETE",
      durationMs(),
      [{
        type: "mismatch",
        requirement: "Claude analysis execution",
        severity: "error",
        message: `Claude invocation failed: ${result.output}`
      }],
      "Analysis failed due to Claude error",
      EMPTY_COVERAGE,
      result.costUsd,
      result.usage
    );
  }

  try {
    const parsed = extractJson<{
      verdict: "COMPLETE" | "INCOMPLETE" | "MISALIGNED";
      findings?: AnalystFinding[];
      summary?: string;
      coverage?: {
        implemented: string[];
        missing: string[];
        excess: string[];
      };
    }>(result.output);

    return createAnalystResult(
      parsed.verdict || "INCOMPLETE",
      durationMs(),
      parsed.findings || [],
      parsed.summary || "",
      parsed.coverage || EMPTY_COVERAGE,
      result.costUsd,
      result.usage
    );
  } catch {
    return createAnalystResult(
      extractVerdictFromText(result.output),
      durationMs(),
      [],
      result.output.slice(0, 500),
      EMPTY_COVERAGE,
      result.costUsd,
      result.usage
    );
  }
}

/**
 * 메인 analyst 함수 - 토큰 한도 확인 후 필요시 분할 분석 수행
 */
export async function runAnalyst(ctx: AnalystContext): Promise<AnalystResult> {
  const templatePath = resolve(ctx.promptsDir, "analyst-requirements.md");
  const template = loadTemplate(templatePath);
  const rendered = renderTemplate(template, ctx.variables);

  // 토큰 사용량 분석
  const tokenUsage = analyzeTokenUsage(rendered, ctx.claudeConfig.model || "sonnet");

  if (!tokenUsage.exceedsLimit) {
    logger.info(`Analyst prompt within limits (${tokenUsage.estimatedTokens} tokens, ${tokenUsage.usagePercentage.toFixed(1)}%), running single analysis`);
    return runSingleAnalyst(ctx);
  }

  logger.info(`Analyst prompt exceeds token limit (${tokenUsage.estimatedTokens} tokens, ${tokenUsage.usagePercentage.toFixed(1)}%), splitting by files`);
  return runSplitAnalyst(ctx, tokenUsage.effectiveLimit);
}

/**
 * diff를 파일별로 분할하여 분석하고 결과를 병합합니다.
 */
async function runSplitAnalyst(ctx: AnalystContext, tokenBudget: number): Promise<AnalystResult> {
  const startTime = Date.now();
  const templatePath = resolve(ctx.promptsDir, "analyst-requirements.md");
  const template = loadTemplate(templatePath);

  // diff 추출 및 분할
  const fullDiff = (ctx.variables.diff as { full: string }).full;
  const fileDiffs = splitDiffByFiles(fullDiff);

  if (fileDiffs.length === 0) {
    logger.warn("No file diffs found for splitting");
    return runSingleAnalyst(ctx);
  }

  // 템플릿에서 diff 부분을 제외한 나머지 내용 계산
  const templateWithoutDiff = renderTemplate(template, { ...ctx.variables, diff: { full: "" } });

  // 파일들을 토큰 예산에 맞게 그룹화
  const batches = groupFilesByTokenBudget(fileDiffs, tokenBudget, templateWithoutDiff);

  if (batches.length === 0) {
    logger.warn("No valid batches created, falling back to single analysis");
    return runSingleAnalyst(ctx);
  }

  const splitStats = generateSplitStats(fileDiffs, batches);
  logger.info(`Split analysis: ${splitStats.totalFiles} files → ${splitStats.totalBatches} batches`);

  // 각 배치별로 분석 실행
  const batchResults: AnalystResult[] = [];

  for (const [index, batch] of batches.entries()) {
    logger.info(`Analyzing batch ${index + 1}/${batches.length} (${batch.files.length} files, ~${batch.totalEstimatedTokens} tokens)`);

    const batchDiff = combineBatchDiffs(batch);
    const batchVariables = {
      ...ctx.variables,
      diff: { full: batchDiff }
    };

    const batchContext: AnalystContext = {
      ...ctx,
      variables: batchVariables
    };

    const result = await runSingleAnalyst(batchContext);
    batchResults.push(result);
  }

  // 결과 병합
  return mergeAnalystResults(batchResults, Date.now() - startTime);
}

/**
 * 분할된 analyst 결과들을 하나로 병합합니다.
 */
function mergeAnalystResults(results: AnalystResult[], totalDurationMs: number): AnalystResult {
  if (results.length === 0) {
    return createAnalystResult("INCOMPLETE", totalDurationMs, [], "No analysis results to merge");
  }

  if (results.length === 1) {
    return { ...results[0], durationMs: totalDurationMs };
  }

  // 비용과 usage 누적
  let totalCostUsd: number | undefined;
  let totalUsage: UsageInfo | undefined;

  for (const result of results) {
    if (result.costUsd !== undefined) {
      totalCostUsd = (totalCostUsd || 0) + result.costUsd;
    }

    if (result.usage) {
      if (!totalUsage) {
        totalUsage = {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        };
      }
      totalUsage.input_tokens += result.usage.input_tokens;
      totalUsage.output_tokens += result.usage.output_tokens;
      if (result.usage.cache_creation_input_tokens) {
        totalUsage.cache_creation_input_tokens = (totalUsage.cache_creation_input_tokens || 0) + result.usage.cache_creation_input_tokens;
      }
      if (result.usage.cache_read_input_tokens) {
        totalUsage.cache_read_input_tokens = (totalUsage.cache_read_input_tokens || 0) + result.usage.cache_read_input_tokens;
      }
    }
  }

  // findings 병합 및 중복 제거
  const allFindings = results.flatMap(result => result.findings);
  const uniqueFindings = deduplicateAnalystFindings(allFindings);

  // verdict 결정: MISALIGNED > INCOMPLETE > COMPLETE
  const verdictPriority = { "MISALIGNED": 3, "INCOMPLETE": 2, "COMPLETE": 1 };
  const verdict = results.reduce((highest, r) =>
    verdictPriority[r.verdict] > verdictPriority[highest] ? r.verdict : highest
  , "COMPLETE" as "COMPLETE" | "INCOMPLETE" | "MISALIGNED");

  // coverage 병합
  const coverage = {
    implemented: [...new Set(results.flatMap(r => r.coverage.implemented))],
    missing: [...new Set(results.flatMap(r => r.coverage.missing))],
    excess: [...new Set(results.flatMap(r => r.coverage.excess))]
  };

  // summary 생성
  const summaries = results
    .map(result => result.summary)
    .filter(summary => summary && summary.trim() !== "");

  const summary = summaries.length > 0
    ? `Split analysis from ${results.length} batches:\n\n${summaries.map((s, i) => `**Batch ${i + 1}**: ${s}`).join('\n\n')}`
    : `Split analysis from ${results.length} batches with no detailed summaries.`;

  return createAnalystResult(verdict, totalDurationMs, uniqueFindings, summary, coverage, totalCostUsd, totalUsage);
}

function deduplicateAnalystFindings(findings: AnalystFinding[]): AnalystFinding[] {
  const seen = new Set<string>();
  const result: AnalystFinding[] = [];

  for (const finding of findings) {
    const key = `${finding.type}:${finding.requirement}:${finding.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(finding);
    }
  }

  return result;
}