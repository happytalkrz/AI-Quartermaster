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

/** Content type for token estimation */
export type ContentType = 'code' | 'natural' | 'auto';

/** Characters per token by content type */
export const CHARS_PER_TOKEN_BY_TYPE = {
  /** Code content (variables, symbols, brackets) - denser token usage */
  code: 3.2,
  /** Natural language - standard ratio */
  natural: 4,
} as const;

/** Default characters per token (backwards compatibility) */
export const CHARS_PER_TOKEN = CHARS_PER_TOKEN_BY_TYPE.natural;

/**
 * Detects if the content is primarily code based on various patterns
 */
export function isCodeContent(text: string): boolean {
  if (!text || text.length === 0) {
    return false;
  }

  // Check for diff headers (strong indicator of code review context)
  if (text.includes('diff --git') || text.includes('@@') || /^[\+\-].*$/m.test(text)) {
    return true;
  }

  // Check for import/export statements
  if (/^\s*(import|export|from|require\()/m.test(text)) {
    return true;
  }

  // Check for function declarations
  if (/^\s*(function|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)/m.test(text)) {
    return true;
  }

  // Check for code-like patterns (class, interface, type declarations)
  if (/^\s*(class|interface|type|enum)\s+\w+/m.test(text)) {
    return true;
  }

  // Check for common programming language keywords
  if (/\b(if|else|for|while|switch|case|return|throw|try|catch|finally)\b/m.test(text)) {
    return true;
  }

  // Analyze character density for code patterns, but be more conservative
  const lines = text.split('\n');
  let codePatternScore = 0;
  let totalLines = 0;
  let hasStrongCodeIndicators = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    totalLines++;

    // Strong code indicators (more specific patterns)
    if (/^\s*[\w\$]+\s*[:=].*[{;]$|^\s*[\w\$]+\([^)]*\)\s*[{=>]|^\s*\/\/.*$|^\s*\/\*.*\*\/$/.test(line)) {
      hasStrongCodeIndicators = true;
      codePatternScore += 2; // Higher weight for strong indicators
    }

    // Count structural code characters: brackets, semicolons (but not general punctuation)
    const structuralChars = (trimmed.match(/[{}();]/g) || []).length;
    const structuralRatio = structuralChars / trimmed.length;

    // Only count lines with significant structural patterns
    if (structuralRatio > 0.15 && trimmed.length > 5) {
      codePatternScore++;
    }
  }

  // Require either strong indicators OR high pattern density (more than 50%)
  return hasStrongCodeIndicators || (totalLines > 0 && (codePatternScore / totalLines) > 0.5);
}

/**
 * Estimates the token count for a given text
 * @param text The text to analyze
 * @param contentType Content type hint ('code', 'natural', or 'auto' for detection)
 */
export function estimateTokenCount(text: string, contentType: ContentType = 'auto'): number {
  if (!text || text.length === 0) {
    return 0;
  }

  let charsPerToken: number;

  if (contentType === 'auto') {
    // Auto-detect content type
    charsPerToken = isCodeContent(text)
      ? CHARS_PER_TOKEN_BY_TYPE.code
      : CHARS_PER_TOKEN_BY_TYPE.natural;
  } else {
    charsPerToken = CHARS_PER_TOKEN_BY_TYPE[contentType];
  }

  return Math.ceil(text.length / charsPerToken);
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