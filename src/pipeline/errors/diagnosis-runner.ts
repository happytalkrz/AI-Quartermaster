import { resolve } from "path";
import { z } from "zod";
import { collectErrorContext } from "./error-context-collector.js";
import type { DiagnosisInput } from "./error-context-collector.js";
import { renderTemplate, loadTemplate } from "../../prompt/template-renderer.js";
import { runClaude, extractJson } from "../../claude/claude-runner.js";
import type { ClaudeCliConfig } from "../../types/config.js";
import type { DiagnosisReport, ErrorCategory } from "../../types/pipeline.js";
import { CLAUDE_MODELS } from "../../claude/model-constants.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";

const logger = getLogger();

const ERROR_CATEGORY_VALUES = [
  "TS_ERROR",
  "TIMEOUT",
  "CLI_CRASH",
  "VERIFICATION_FAILED",
  "SAFETY_VIOLATION",
  "RATE_LIMIT",
  "PROMPT_TOO_LONG",
  "UNKNOWN",
] as const;

const DiagnosisReportSchema = z.object({
  rootCause: z.string(),
  recommendedActions: z.array(z.string()),
  canAutoRetry: z.boolean(),
  retryStrategy: z.string().nullable().optional(),
  errorCategory: z.enum(ERROR_CATEGORY_VALUES),
  confidence: z.enum(["high", "medium", "low"]),
});

const DIAGNOSIS_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    rootCause: { type: "string" },
    recommendedActions: { type: "array", items: { type: "string" } },
    canAutoRetry: { type: "boolean" },
    retryStrategy: { type: ["string", "null"] },
    errorCategory: {
      type: "string",
      enum: [...ERROR_CATEGORY_VALUES],
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["rootCause", "recommendedActions", "canAutoRetry", "errorCategory", "confidence"],
});

export interface DiagnosisRunnerOptions {
  input: DiagnosisInput;
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd?: string;
}

/**
 * 파이프라인 실패 시 Claude haiku를 1회 호출하여 진단 리포트를 생성합니다.
 * non-fatal: 진단 실패 시 undefined를 반환하며 파이프라인 흐름에 영향을 주지 않습니다.
 */
export async function runDiagnosis(
  options: DiagnosisRunnerOptions
): Promise<DiagnosisReport | undefined> {
  const { input, claudeConfig, promptsDir, cwd } = options;

  try {
    // (1) error-context-collector로 컨텍스트 수집
    const variables = collectErrorContext(input);

    // (2) template-renderer로 프롬프트 렌더링
    const templatePath = resolve(promptsDir, "error-diagnosis.md");
    const template = loadTemplate(templatePath);
    const prompt = renderTemplate(template, variables);

    // haiku 모델 사용 (비용 최소화)
    const diagnosisConfig: ClaudeCliConfig = {
      ...claudeConfig,
      model: CLAUDE_MODELS.HAIKU,
    };

    // (3) claude-runner의 runClaude를 jsonSchema 옵션과 함께 호출
    const result = await runClaude({
      prompt,
      cwd,
      config: diagnosisConfig,
      jsonSchema: DIAGNOSIS_JSON_SCHEMA,
      maxTurns: 1,
    });

    if (!result.success) {
      logger.warn(`Diagnosis Claude call failed: ${result.output}`);
      return undefined;
    }

    // (4) Zod로 응답 파싱하여 DiagnosisReport 반환
    let raw: unknown;
    try {
      raw = JSON.parse(result.output);
    } catch (_parseErr: unknown) {
      raw = extractJson(result.output);
    }

    const parsed = DiagnosisReportSchema.parse(raw);

    return {
      rootCause: parsed.rootCause,
      recommendedActions: parsed.recommendedActions,
      canAutoRetry: parsed.canAutoRetry,
      retryStrategy: parsed.retryStrategy ?? undefined,
      errorCategory: parsed.errorCategory as ErrorCategory,
      confidence: parsed.confidence,
      generatedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    logger.warn(`Diagnosis runner failed (non-fatal): ${getErrorMessage(err)}`);
    return undefined;
  }
}
