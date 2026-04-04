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

/** Characters per token by locale */
export const CHARS_PER_TOKEN_BY_LOCALE = {
  /** English - standard ratio */
  en: {
    code: 3.2,
    natural: 4.0,
  },
  /** Korean - denser token usage due to more information per character */
  ko: {
    code: 2.0,
    natural: 2.4,
  },
} as const;

/** Default characters per token (backwards compatibility) */
export const CHARS_PER_TOKEN = CHARS_PER_TOKEN_BY_TYPE.natural;

/**
 * Gets locale-specific character-to-token ratios
 * Defaults to English if locale not found
 */
function getLocaleRatios(locale: string): typeof CHARS_PER_TOKEN_BY_LOCALE.en {
  return CHARS_PER_TOKEN_BY_LOCALE[locale as keyof typeof CHARS_PER_TOKEN_BY_LOCALE]
    || CHARS_PER_TOKEN_BY_LOCALE.en;
}

/**
 * Gets the appropriate chars-per-token ratio for text in a given locale
 * Detects code vs natural language and returns the corresponding ratio
 */
function getCharsPerToken(text: string, locale: string): number {
  const localeRatios = getLocaleRatios(locale);
  return isCodeContent(text) ? localeRatios.code : localeRatios.natural;
}

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
  if (sampleText.includes('diff --git') || sampleText.includes('@@') || /^[+-].*$/m.test(sampleText)) {
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
    if (/^\s*[\w$]+\s*[:=].*[{;]$|^\s*[\w$]+\([^)]*\)\s*[{=>]|^\s*\/\/|^\s*\/\*/.test(line)) {
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
 * @param locale Language locale for token estimation (defaults to 'en')
 */
export function estimateTokenCount(text: string, contentType: ContentType = 'auto', locale: string = 'en'): number {
  if (!text || text.length === 0) {
    return 0;
  }

  let charsPerToken: number;

  if (contentType === 'auto') {
    // Auto-detect content type
    charsPerToken = getCharsPerToken(text, locale);
  } else {
    const localeRatios = getLocaleRatios(locale);
    charsPerToken = localeRatios[contentType];
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
 * @param text The text to analyze
 * @param modelName The Claude model name
 * @param locale Language locale for token estimation (defaults to 'en')
 */
export function analyzeTokenUsage(text: string, modelName: string, locale: string = 'en'): TokenUsageInfo {
  const estimatedTokens = estimateTokenCount(text, 'auto', locale);
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

/**
 * Truncates text to fit within a token budget
 * Attempts to preserve sentence boundaries when possible
 * @param text The text to truncate
 * @param maxTokens Maximum token budget
 * @param locale Language locale for token estimation (defaults to 'en')
 */
export function truncateToTokenBudget(text: string, maxTokens: number, locale: string = 'en'): string {
  if (!text || maxTokens <= 0) return '';

  const estimatedTokens = estimateTokenCount(text, 'auto', locale);
  if (estimatedTokens <= maxTokens) return text;

  // Reserve tokens for ellipsis
  const ellipsisTokens = estimateTokenCount('...', 'auto', locale);
  const availableTokens = Math.max(1, maxTokens - ellipsisTokens);

  // Calculate approximate character limit
  const charsPerToken = getCharsPerToken(text, locale);
  const targetChars = Math.floor(availableTokens * charsPerToken);
  if (targetChars <= 0) return '';

  // Try to truncate at sentence boundaries first
  const sentences = text.split(/(?<=[.!?])\s+/);
  let result = '';

  for (const sentence of sentences) {
    const testResult = result + (result ? ' ' : '') + sentence;
    if (estimateTokenCount(testResult, 'auto', locale) > availableTokens) {
      break;
    }
    result = testResult;
  }

  // If no complete sentences fit, truncate at word boundaries
  if (!result && targetChars > 0) {
    const truncated = text.substring(0, targetChars);
    const lastSpace = truncated.lastIndexOf(' ');
    result = lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
  }

  // Add ellipsis if we truncated
  if (result.length < text.length) {
    result += '...';
  }

  return result;
}

/**
 * Summarizes text to fit within a target token budget
 * Keeps beginning and end, with summary indicator in the middle
 * @param text The text to summarize
 * @param targetTokens Target token budget
 * @param locale Language locale for token estimation (defaults to 'en')
 */
export function summarizeForBudget(text: string, targetTokens: number, locale: string = 'en'): string {
  if (!text || targetTokens <= 0) return '';

  const estimatedTokens = estimateTokenCount(text, 'auto', locale);
  if (estimatedTokens <= targetTokens) return text;

  // Reserve tokens for summary indicator
  const summaryIndicator = '\n\n[... content truncated ...]\n\n';
  const reservedTokens = estimateTokenCount(summaryIndicator, 'auto', locale);
  const availableTokens = Math.max(0, targetTokens - reservedTokens);

  if (availableTokens < 10) {
    // If too little space, just truncate
    return truncateToTokenBudget(text, targetTokens, locale);
  }

  // Split available tokens between beginning and end
  const beginTokens = Math.floor(availableTokens * 0.6);
  const endTokens = availableTokens - beginTokens;

  const charsPerToken = getCharsPerToken(text, locale);
  const beginChars = Math.floor(beginTokens * charsPerToken);
  const endChars = Math.floor(endTokens * charsPerToken);

  if (beginChars <= 0 || endChars <= 0) {
    return truncateToTokenBudget(text, targetTokens, locale);
  }

  // Get beginning part
  let beginning = text.substring(0, beginChars);
  const lastSpaceBegin = beginning.lastIndexOf(' ');
  if (lastSpaceBegin > 0) {
    beginning = beginning.substring(0, lastSpaceBegin);
  }

  // Get ending part - start from the right position
  const endStartPos = Math.max(0, text.length - endChars);
  let ending = text.substring(endStartPos);
  const firstSpaceEnd = ending.indexOf(' ');
  if (firstSpaceEnd > 0 && firstSpaceEnd < ending.length - 1) {
    ending = ending.substring(firstSpaceEnd + 1);
  }

  // Make sure we don't have overlapping or adjacent parts
  if (beginning.length + ending.length >= text.length - 10) {
    return truncateToTokenBudget(text, targetTokens, locale);
  }

  return beginning + summaryIndicator + ending;
}

/**
 * Truncates repository structure to fit within token budget
 * Prioritizes important files and directories
 * @param structure The repository structure string
 * @param maxTokens Maximum token budget
 * @param locale Language locale for token estimation (defaults to 'en')
 */
export function truncateRepoStructure(structure: string, maxTokens: number, locale: string = 'en'): string {
  if (!structure || maxTokens <= 0) return '';

  const estimatedTokens = estimateTokenCount(structure, 'auto', locale);
  if (estimatedTokens <= maxTokens) return structure;

  const lines = structure.split('\n').filter(line => line.trim());

  // Priority patterns (higher priority = more important)
  const priorities = [
    { pattern: /(README|package\.json|tsconfig|\.gitignore)/i, priority: 10 },
    { pattern: /^[^/\s]/, priority: 9 }, // Root level files
    { pattern: /\/(src|lib|app)\//, priority: 8 }, // Source directories
    { pattern: /\.(ts|tsx|js|jsx)$/i, priority: 7 }, // TypeScript/JavaScript files
    { pattern: /\/(test|spec)\/.*\.(test|spec)\./i, priority: 6 }, // Test files
    { pattern: /\/(docs?|documentation)\//, priority: 5 }, // Documentation
    { pattern: /\/(config|settings)\//, priority: 4 }, // Configuration
    { pattern: /\.(json|yaml|yml)$/i, priority: 3 }, // Config files
    { pattern: /\.(md|txt)$/i, priority: 2 }, // Documentation files
    { pattern: /node_modules/, priority: 0 }, // Lowest priority
  ];

  // Score each line
  const scoredLines = lines.map((line, index) => {
    let score = 1; // Base score
    for (const { pattern, priority } of priorities) {
      if (pattern.test(line)) {
        score = Math.max(score, priority);
      }
    }
    return { line, score, originalIndex: index };
  });

  // Sort by score (descending) and then by original order
  scoredLines.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return a.originalIndex - b.originalIndex;
  });

  // Always include at least one high-priority line if possible
  const result: { line: string; originalIndex: number }[] = [];
  let currentTokens = 0;

  // First, try to include the highest priority items
  for (const item of scoredLines) {
    const lineTokens = estimateTokenCount(item.line + '\n', 'auto', locale);
    if (currentTokens + lineTokens <= maxTokens) {
      result.push(item);
      currentTokens += lineTokens;
    } else if (result.length === 0 && item.score >= 9) {
      // Force include at least one high priority item even if it's close to budget
      result.push(item);
      currentTokens += lineTokens;
      break;
    }
  }

  // If we truncated, add indicator (but only if we have room)
  if (result.length < lines.length) {
    const truncatedCount = lines.length - result.length;
    const indicator = `... (${truncatedCount} more files/directories truncated)`;
    const indicatorTokens = estimateTokenCount(indicator + '\n', 'auto', locale);

    // Only add indicator if we have room and it's useful
    if (currentTokens + indicatorTokens <= maxTokens && result.length > 0) {
      result.push({ line: indicator, originalIndex: lines.length });
    } else if (result.length === 0) {
      // If nothing fits, return at least the indicator
      return indicator;
    }
  }

  // Sort final result by original line order (except for the indicator)
  const normalLines = result.filter(item => !item.line.startsWith('...'));
  const indicators = result.filter(item => item.line.startsWith('...'));

  normalLines.sort((a, b) => a.originalIndex - b.originalIndex);

  const finalLines = [...normalLines, ...indicators].map(item => item.line);
  return finalLines.join('\n');
}