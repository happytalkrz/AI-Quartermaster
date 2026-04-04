/**
 * Token estimation utilities for Claude models
 * Used to determine if review prompts exceed model context limits
 */

/** Claude model token limits (in tokens) */
export const MODEL_TOKEN_LIMITS = {
  // Claude 4.x models typically have 200K token limit
  'claude-opus-4-5': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-haiku-4-5': 200_000,
  // Fallback for unknown models
  'default': 200_000,
} as const;

/** Safety margin percentage (20%) */
export const SAFETY_MARGIN = 0.2;

/** Average characters per token (4 characters = 1 token) */
export const CHARS_PER_TOKEN = 4;

/**
 * Estimates the token count for a given text
 * Uses a simple heuristic: 4 characters = 1 token
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Gets the token limit for a specific Claude model
 */
export function getTokenLimit(modelName: string): number {
  // Handle null/undefined/empty model names
  if (!modelName || typeof modelName !== 'string') {
    return MODEL_TOKEN_LIMITS.default;
  }

  // Try exact match first
  if (modelName in MODEL_TOKEN_LIMITS) {
    return MODEL_TOKEN_LIMITS[modelName as keyof typeof MODEL_TOKEN_LIMITS];
  }

  // Try pattern matching for similar models
  if (modelName.includes('opus')) {
    return MODEL_TOKEN_LIMITS['claude-opus-4-5'];
  }
  if (modelName.includes('sonnet')) {
    return MODEL_TOKEN_LIMITS['claude-sonnet-4-20250514'];
  }
  if (modelName.includes('haiku')) {
    return MODEL_TOKEN_LIMITS['claude-haiku-4-5-20251001'];
  }

  // Fallback to default
  return MODEL_TOKEN_LIMITS.default;
}

/**
 * Gets the effective token limit with safety margin applied
 */
export function getEffectiveTokenLimit(modelName: string): number {
  const baseLimit = getTokenLimit(modelName);
  return Math.floor(baseLimit * (1 - SAFETY_MARGIN));
}

/**
 * Checks if a text would exceed the token limit for a given model
 */
export function exceedsTokenLimit(text: string, modelName: string): boolean {
  const tokenCount = estimateTokenCount(text);
  const effectiveLimit = getEffectiveTokenLimit(modelName);
  return tokenCount > effectiveLimit;
}

/**
 * Gets token usage info for a text and model
 */
export interface TokenUsageInfo {
  /** Estimated token count */
  estimatedTokens: number;
  /** Model's base token limit */
  modelLimit: number;
  /** Effective limit with safety margin */
  effectiveLimit: number;
  /** Whether the text exceeds the effective limit */
  exceedsLimit: boolean;
  /** Usage percentage (estimated tokens / effective limit) */
  usagePercentage: number;
}

/**
 * Analyzes token usage for a text and model
 */
export function analyzeTokenUsage(text: string, modelName: string): TokenUsageInfo {
  const estimatedTokens = estimateTokenCount(text);
  const modelLimit = getTokenLimit(modelName);
  const effectiveLimit = getEffectiveTokenLimit(modelName);
  const exceedsLimit = estimatedTokens > effectiveLimit;
  const usagePercentage = (estimatedTokens / effectiveLimit) * 100;

  return {
    estimatedTokens,
    modelLimit,
    effectiveLimit,
    exceedsLimit,
    usagePercentage,
  };
}