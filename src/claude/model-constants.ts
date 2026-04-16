/**
 * Claude 모델 ID 상수.
 * 모델 업데이트 시 이 파일만 수정하면 defaults, model-router, token-estimator에 반영된다.
 */

export const CLAUDE_MODELS = {
  OPUS: "claude-opus-4-7",
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];
