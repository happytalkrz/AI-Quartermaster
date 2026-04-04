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

  // Performance optimization: sample large texts
  let sampleText = text;
  if (text.length > 50_000) {
    const start = text.substring(0, 5000);
    const middle = text.substring(Math.floor(text.length / 2) - 2500, Math.floor(text.length / 2) + 2500);
    const end = text.substring(text.length - 5000);
    sampleText = start + '\n' + middle + '\n' + end;
  }

  // Check for diff headers (strong indicator of code review context)
  if (sampleText.includes('diff --git') || sampleText.includes('@@') || /^[\+\-].*$/m.test(sampleText)) {
    return true;
  }

  // Check for import/export statements
  if (/^\s*(import|export|from)\s+|\brequire\s*\(/m.test(sampleText)) {
    return true;
  }

  // Check for function declarations (including async)
  if (/^\s*(async\s+)?function\s+\w+|^\s*(const|let|var)\s+\w+\s*=.*(\(.*\)|=>)/m.test(sampleText)) {
    return true;
  }

  // Check for type/class declarations
  if (/^\s*(class|interface|type|enum)\s+\w+/m.test(sampleText)) {
    return true;
  }

  // Check for JSON structure
  if (/[{[][\s\S]*"[^"]+"\s*:/.test(sampleText)) {
    return true;
  }

  // Check for programming keywords
  const keywordMatches = sampleText.match(/\b(if|else|for|while|switch|case|return|throw|try|catch|finally)\b/g) || [];
  if (keywordMatches.length > sampleText.split(/\s+/).length * 0.05) {
    return true;
  }

  // Analyze line patterns for code vs natural language
  const lines = sampleText.split('\n');
  let strongCodeLines = 0;
  let naturalLanguageLines = 0;

  for (const line of lines.slice(0, 200)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for natural language patterns (markdown, sentences)
    if (/^#+\s+|^-\s+|^\*\s+|^>\s+|\.\s*$|[.!?]\s+[A-Z]/.test(trimmed)) {
      naturalLanguageLines++;
      continue;
    }

    // Check for code patterns
    if (/^\s*[\w\$]+\s*[:=].*[{;]$|^\s*[\w\$]+\([^)]*\)\s*[{=>]|^\s*\/\/|^\s*\/\*/.test(line)) {
      strongCodeLines++;
    }
  }

  const totalLines = strongCodeLines + naturalLanguageLines;
  if (totalLines === 0) return false;

  // If >30% natural language, need >40% strong code indicators
  if (naturalLanguageLines > totalLines * 0.3) {
    return strongCodeLines > totalLines * 0.4;
  }

  return strongCodeLines > 0;
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