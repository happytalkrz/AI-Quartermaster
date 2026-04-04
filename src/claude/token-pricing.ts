import type { UsageInfo } from "../types/pipeline.js";

/**
 * 모델별 토큰 단가 (1M 토큰 기준, USD)
 */
interface ModelPricing {
  input: number;
  output: number;
}

/**
 * Claude 모델별 토큰 단가 테이블
 * 캐시: cache_read는 input의 10%, cache_creation은 input의 125%
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  sonnet: {
    input: 3.0,
    output: 15.0,
  },
  haiku: {
    input: 0.25,
    output: 1.25,
  },
  opus: {
    input: 15.0,
    output: 75.0,
  },
} as const;

/**
 * 기본 fallback 단가 (unknown 모델용)
 */
export const DEFAULT_PRICING: ModelPricing = {
  input: 3.0, // sonnet과 동일
  output: 15.0,
};

/**
 * 캐시 토큰 요율
 */
export const CACHE_PRICING = {
  READ_MULTIPLIER: 0.1, // input의 10%
  CREATION_MULTIPLIER: 1.25, // input의 125%
} as const;

/**
 * 모델 이름 정규화 (claude-3-sonnet -> sonnet)
 */
function normalizeModelName(model: string): string {
  const lowerModel = model.toLowerCase();

  if (lowerModel.includes("sonnet")) return "sonnet";
  if (lowerModel.includes("haiku")) return "haiku";
  if (lowerModel.includes("opus")) return "opus";

  return "unknown";
}

/**
 * 모델별 단가 조회
 */
function getModelPricing(model: string): ModelPricing {
  const normalizedModel = normalizeModelName(model);
  return MODEL_PRICING[normalizedModel] ?? DEFAULT_PRICING;
}

/**
 * usage 토큰 정보를 기반으로 비용을 계산합니다.
 *
 * @param usage - Claude CLI가 반환한 토큰 사용량 정보
 * @param model - Claude 모델명 (예: "claude-3-sonnet-20240229")
 * @returns USD 단위의 비용
 */
export function calculateCostFromUsage(usage: UsageInfo, model: string): number {
  const pricing = getModelPricing(model);

  // 기본 토큰 비용 계산 (1M 토큰 기준이므로 1,000,000으로 나눔)
  const inputCost = (usage.input_tokens * pricing.input) / 1_000_000;
  const outputCost = (usage.output_tokens * pricing.output) / 1_000_000;

  // 캐시 토큰 비용 계산
  const cacheReadCost = usage.cache_read_input_tokens
    ? (usage.cache_read_input_tokens * pricing.input * CACHE_PRICING.READ_MULTIPLIER) / 1_000_000
    : 0;

  const cacheCreationCost = usage.cache_creation_input_tokens
    ? (usage.cache_creation_input_tokens * pricing.input * CACHE_PRICING.CREATION_MULTIPLIER) / 1_000_000
    : 0;

  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

/**
 * 모델별 단가 정보를 반환합니다.
 *
 * @param model - Claude 모델명
 * @returns 모델의 단가 정보
 */
export function getModelPricingInfo(model: string): ModelPricing & { normalizedName: string } {
  const normalizedName = normalizeModelName(model);
  const pricing = getModelPricing(model);

  return {
    normalizedName,
    ...pricing,
  };
}