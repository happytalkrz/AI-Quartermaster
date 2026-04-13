import type { PhaseResult, ErrorCategory } from "../../types/pipeline.js";

/**
 * Pseudo-phase 이름 컨벤션.
 * core-loop의 executor phase와 구분하기 위해 "카테고리:액션" 형식 사용.
 */
export type PseudoPhaseName =
  | "setup:worktree"
  | "setup:dependency"
  | "plan:generate"
  | "review:code"
  | "review:simplify"
  | "validation:check"
  | "publish:pr";

/**
 * Pseudo-phase index 할당표.
 * core-loop phase는 0부터 시작하는 양수 인덱스를 사용하므로
 * pseudo-phase는 음수 인덱스로 구분한다.
 */
export const PSEUDO_PHASE_INDEX: Record<PseudoPhaseName, number> = {
  "setup:worktree": -7,
  "setup:dependency": -6,
  "plan:generate": -5,
  "review:code": -4,
  "review:simplify": -3,
  "validation:check": -2,
  "publish:pr": -1,
};

/**
 * 성공한 pseudo-phase PhaseResult를 생성한다.
 */
export function makePseudoPhaseSuccess(
  name: PseudoPhaseName,
  durationMs: number,
  opts?: {
    startedAt?: string;
    completedAt?: string;
    costUsd?: number;
  }
): PhaseResult {
  return {
    phaseIndex: PSEUDO_PHASE_INDEX[name],
    phaseName: name,
    success: true,
    durationMs,
    startedAt: opts?.startedAt,
    completedAt: opts?.completedAt,
    costUsd: opts?.costUsd,
  };
}

/**
 * 실패한 pseudo-phase PhaseResult를 생성한다.
 */
export function makePseudoPhaseFailure(
  name: PseudoPhaseName,
  durationMs: number,
  error: string,
  opts?: {
    startedAt?: string;
    completedAt?: string;
    errorCategory?: ErrorCategory;
    costUsd?: number;
  }
): PhaseResult {
  return {
    phaseIndex: PSEUDO_PHASE_INDEX[name],
    phaseName: name,
    success: false,
    durationMs,
    error,
    startedAt: opts?.startedAt,
    completedAt: opts?.completedAt,
    errorCategory: opts?.errorCategory,
    costUsd: opts?.costUsd,
  };
}

/**
 * pseudo-phase 여부를 판별한다 (phaseIndex < 0).
 */
export function isPseudoPhase(result: PhaseResult): boolean {
  return result.phaseIndex < 0;
}

/**
 * ISO 8601 타임스탬프를 반환하는 유틸리티.
 */
export function nowIso(): string {
  return new Date().toISOString();
}
