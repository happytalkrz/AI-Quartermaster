import type { AQConfig } from "../../types/config.js";

/**
 * 각 파이프라인 단계별 retry 상한 상수 (중앙화)
 *
 * config.safety.maxRetries가 기본값이며, 단계별로 override 가능한 구조.
 * 이 파일의 상수를 변경하면 모든 단계의 retry 동작이 일괄 조정된다.
 */

/** Phase 구현 재시도 상한 (config.safety.maxRetries fallback) */
export const DEFAULT_PHASE_MAX_RETRIES = 3;

/** Plan 생성 재시도 상한 */
export const DEFAULT_PLAN_MAX_RETRIES = 2;

/** Review 재시도 상한 */
export const DEFAULT_REVIEW_MAX_RETRIES = 2;

/** Final validation 재시도 상한 (config.safety.maxRetries fallback) */
export const DEFAULT_VALIDATION_MAX_RETRIES = 3;

/** CI 자동 수정 재시도 상한 (config.safety.maxRetries fallback) */
export const DEFAULT_CI_FIX_MAX_RETRIES = 3;

export type RetryStage = "phase" | "plan" | "review" | "validation" | "ci-fix";

/**
 * config.safety.maxRetries를 기반으로 각 단계별 retry 상한을 반환한다.
 *
 * @param config AQConfig (없으면 DEFAULT_* 상수 사용)
 * @param stage 파이프라인 단계
 * @returns 해당 단계의 retry 상한
 */
export function resolveRetryBudget(config: AQConfig | undefined, stage: RetryStage): number {
  const globalMax = config?.safety.maxRetries;

  switch (stage) {
    case "phase":
      return globalMax ?? DEFAULT_PHASE_MAX_RETRIES;
    case "plan":
      return DEFAULT_PLAN_MAX_RETRIES;
    case "review":
      return globalMax ?? DEFAULT_REVIEW_MAX_RETRIES;
    case "validation":
      return globalMax ?? DEFAULT_VALIDATION_MAX_RETRIES;
    case "ci-fix":
      return globalMax ?? DEFAULT_CI_FIX_MAX_RETRIES;
  }
}

/**
 * retry 상한 도달 시 사용하는 표준 실패 reason 메시지 템플릿.
 *
 * @param stage 파이프라인 단계 이름 (로그/에러 메시지용)
 * @param maxRetries 실제 상한값
 * @returns 실패 reason 문자열
 */
export function retryBudgetExhaustedReason(stage: string, maxRetries: number): string {
  return `[RETRY_BUDGET_EXHAUSTED] ${stage} failed after ${maxRetries} attempt(s). No further retries to prevent API token exhaustion.`;
}
