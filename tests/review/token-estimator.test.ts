import { describe, it, expect } from "vitest";
import {
  estimateTokenCount,
  getTokenLimit,
  getEffectiveTokenLimit,
  exceedsTokenLimit,
  analyzeTokenUsage,
  truncateToTokenBudget,
  summarizeForBudget,
  truncateRepoStructure,
  MODEL_TOKEN_LIMITS,
  SAFETY_MARGIN,
  CHARS_PER_TOKEN,
} from "../../src/review/token-estimator.js";

describe("token-estimator", () => {
  describe("estimateTokenCount", () => {
    it("should estimate tokens based on character count", () => {
      expect(estimateTokenCount("")).toBe(0);
      expect(estimateTokenCount("a")).toBe(1); // 1 char = 1 token (rounded up)
      expect(estimateTokenCount("abcd")).toBe(1); // 4 chars = 1 token
      expect(estimateTokenCount("abcde")).toBe(2); // 5 chars = 2 tokens (rounded up)
      expect(estimateTokenCount("a".repeat(100))).toBe(25); // 100 chars = 25 tokens
    });

    it("should handle unicode characters", () => {
      expect(estimateTokenCount("한글")).toBe(1); // 2 chars = 1 token (rounded up)
      expect(estimateTokenCount("한글테스트")).toBe(2); // 5 chars = 2 tokens (rounded up)
      expect(estimateTokenCount("🚀")).toBe(1); // 1 emoji = 1 token (rounded up)
    });

    it("should handle large text", () => {
      const largeText = "a".repeat(800_000); // 800K characters
      expect(estimateTokenCount(largeText)).toBe(200_000); // 200K tokens
    });
  });

  describe("getTokenLimit", () => {
    it("should return correct limits for known models", () => {
      expect(getTokenLimit("claude-opus-4-5")).toBe(200_000);
      expect(getTokenLimit("claude-sonnet-4-20250514")).toBe(200_000);
      expect(getTokenLimit("claude-haiku-4-5-20251001")).toBe(200_000);
    });

    it("should handle pattern matching for similar models", () => {
      expect(getTokenLimit("claude-opus-4-6")).toBe(200_000);
      expect(getTokenLimit("claude-sonnet-3.5")).toBe(200_000);
      expect(getTokenLimit("claude-haiku-3")).toBe(200_000);
    });

    it("should return default limit for unknown models", () => {
      expect(getTokenLimit("gpt-4")).toBe(200_000);
      expect(getTokenLimit("unknown-model")).toBe(200_000);
      expect(getTokenLimit("")).toBe(200_000);
    });

    it("should handle case-insensitive model names", () => {
      expect(getTokenLimit("CLAUDE-OPUS-4-5")).toBe(200_000);
      expect(getTokenLimit("Claude-Sonnet-4-20250514")).toBe(200_000);
    });
  });

  describe("getEffectiveTokenLimit", () => {
    it("should apply safety margin correctly", () => {
      const baseLimit = 200_000;
      const expectedEffective = Math.floor(baseLimit * (1 - SAFETY_MARGIN));

      expect(getEffectiveTokenLimit("claude-opus-4-5")).toBe(expectedEffective);
      expect(getEffectiveTokenLimit("claude-sonnet-4-20250514")).toBe(expectedEffective);
    });

    it("should return 160,000 for 200K base limit with 20% margin", () => {
      expect(getEffectiveTokenLimit("claude-opus-4-5")).toBe(160_000);
    });
  });

  describe("exceedsTokenLimit", () => {
    it("should return false for text within limits", () => {
      const smallText = "a".repeat(100); // ~25 tokens
      expect(exceedsTokenLimit(smallText, "claude-opus-4-5")).toBe(false);
    });

    it("should return true for text exceeding effective limit", () => {
      // 700K chars = 175K tokens, which exceeds 160K effective limit
      const largeText = "a".repeat(700_000);
      expect(exceedsTokenLimit(largeText, "claude-opus-4-5")).toBe(true);
    });

    it("should return false for text at the edge of effective limit", () => {
      // 640K chars = 160K tokens, exactly at effective limit
      const edgeText = "a".repeat(640_000);
      expect(exceedsTokenLimit(edgeText, "claude-opus-4-5")).toBe(false);
    });

    it("should return true for text just over effective limit", () => {
      // 644K chars = 161K tokens, just over 160K effective limit
      const overLimitText = "a".repeat(644_000);
      expect(exceedsTokenLimit(overLimitText, "claude-opus-4-5")).toBe(true);
    });
  });

  describe("analyzeTokenUsage", () => {
    it("should provide complete token usage analysis", () => {
      const text = "a".repeat(320_000); // 80K tokens
      const analysis = analyzeTokenUsage(text, "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(80_000);
      expect(analysis.modelLimit).toBe(200_000);
      expect(analysis.effectiveLimit).toBe(160_000);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.usagePercentage).toBe(50); // 80K / 160K = 50%
    });

    it("should detect when limit is exceeded", () => {
      const text = "a".repeat(700_000); // 175K tokens
      const analysis = analyzeTokenUsage(text, "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(175_000);
      expect(analysis.exceedsLimit).toBe(true);
      expect(analysis.usagePercentage).toBeCloseTo(109.375); // 175K / 160K
    });

    it("should handle empty text", () => {
      const analysis = analyzeTokenUsage("", "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(0);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.usagePercentage).toBe(0);
    });

    it("should work with different models", () => {
      const text = "a".repeat(100_000); // 25K tokens
      const analysis = analyzeTokenUsage(text, "claude-haiku-4-5-20251001");

      expect(analysis.estimatedTokens).toBe(25_000);
      expect(analysis.modelLimit).toBe(200_000);
      expect(analysis.effectiveLimit).toBe(160_000);
      expect(analysis.exceedsLimit).toBe(false);
      expect(analysis.usagePercentage).toBeCloseTo(15.625); // 25K / 160K
    });
  });

  describe("constants", () => {
    it("should have correct safety margin", () => {
      expect(SAFETY_MARGIN).toBe(0.2);
    });

    it("should have correct chars per token ratio", () => {
      expect(CHARS_PER_TOKEN).toBe(4);
    });

    it("should have model limits defined", () => {
      expect(MODEL_TOKEN_LIMITS['claude-opus-4-5']).toBe(200_000);
      expect(MODEL_TOKEN_LIMITS['claude-sonnet-4-20250514']).toBe(200_000);
      expect(MODEL_TOKEN_LIMITS['claude-haiku-4-5-20251001']).toBe(200_000);
      expect(MODEL_TOKEN_LIMITS.default).toBe(200_000);
    });
  });

  describe("edge cases", () => {
    it("should handle very large numbers", () => {
      const hugeText = "a".repeat(10_000_000); // 10M chars = 2.5M tokens
      const analysis = analyzeTokenUsage(hugeText, "claude-opus-4-5");

      expect(analysis.estimatedTokens).toBe(2_500_000);
      expect(analysis.exceedsLimit).toBe(true);
      expect(analysis.usagePercentage).toBeCloseTo(1562.5); // way over limit
    });

    it("should handle null and undefined model names gracefully", () => {
      expect(getTokenLimit(null as unknown as string)).toBe(200_000);
      expect(getTokenLimit(undefined as unknown as string)).toBe(200_000);
    });

    it("should handle special characters and whitespace", () => {
      const specialText = "Hello\n\tWorld!@#$%^&*()";
      const tokens = estimateTokenCount(specialText);
      expect(tokens).toBe(Math.ceil(specialText.length / CHARS_PER_TOKEN));
    });
  });

  describe("truncateToTokenBudget", () => {
    it("should return empty string for invalid inputs", () => {
      expect(truncateToTokenBudget("", 100)).toBe("");
      expect(truncateToTokenBudget("text", 0)).toBe("");
      expect(truncateToTokenBudget("text", -1)).toBe("");
    });

    it("should return original text if within budget", () => {
      const text = "Hello world!";
      const tokens = estimateTokenCount(text);
      expect(truncateToTokenBudget(text, tokens + 10)).toBe(text);
      expect(truncateToTokenBudget(text, tokens)).toBe(text);
    });

    it("should truncate at sentence boundaries", () => {
      const text = "First sentence. Second sentence. Third sentence.";
      const result = truncateToTokenBudget(text, 5); // ~20 chars = 5 tokens
      expect(result).toContain("First sentence");
      expect(result.length).toBeLessThan(text.length);
    });

    it("should truncate at word boundaries when sentences don't fit", () => {
      const longSentence = "This is a very long sentence without proper punctuation";
      const result = truncateToTokenBudget(longSentence, 3); // ~12 chars = 3 tokens
      expect(result).toMatch(/^This is/);
      expect(result).toContain("...");
    });

    it("should handle text with mixed sentence endings", () => {
      const text = "Question? Statement! Exclamation. More text here.";
      const result = truncateToTokenBudget(text, 8); // Should fit first few sentences
      expect(result).toMatch(/Question\? Statement!/);
    });

    it("should add ellipsis when truncating", () => {
      const text = "a".repeat(100);
      const result = truncateToTokenBudget(text, 5);
      expect(result).toContain("...");
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(5);
    });
  });

  describe("summarizeForBudget", () => {
    it("should return empty string for invalid inputs", () => {
      expect(summarizeForBudget("", 100)).toBe("");
      expect(summarizeForBudget("text", 0)).toBe("");
      expect(summarizeForBudget("text", -1)).toBe("");
    });

    it("should return original text if within budget", () => {
      const text = "Short text";
      const tokens = estimateTokenCount(text);
      expect(summarizeForBudget(text, tokens + 10)).toBe(text);
    });

    it("should create summary with beginning and end", () => {
      const text = "Beginning part with important content. " + "Middle content ".repeat(20) + "End part with conclusion.";
      const result = summarizeForBudget(text, 20);

      expect(result).toContain("Beginning part");
      expect(result).toContain("conclusion.");
      expect(result).toContain("[... content truncated ...]");
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(20);
    });

    it("should fallback to truncation if target tokens too small", () => {
      const text = "This is some text that needs summarizing.";
      const result = summarizeForBudget(text, 5);

      expect(result).not.toContain("[... content truncated ...]");
      expect(estimateTokenCount(result)).toBeLessThanOrEqual(5);
    });

    it("should preserve word boundaries in beginning and end", () => {
      const text = "Start with words here. " + "x".repeat(200) + " End with words there.";
      const result = summarizeForBudget(text, 30);

      expect(result).toMatch(/^Start with words/);
      if (result.includes("[... content truncated ...]")) {
        expect(result).toMatch(/words there\.$/);
      }
    });
  });

  describe("truncateRepoStructure", () => {
    const sampleStructure = `README.md
package.json
src/
  index.ts
  utils/
    helper.ts
  components/
    Button.tsx
tests/
  index.test.ts
  utils/
    helper.test.ts
node_modules/
  express/
    index.js
docs/
  api.md
.gitignore
tsconfig.json`;

    it("should return empty string for invalid inputs", () => {
      expect(truncateRepoStructure("", 100)).toBe("");
      expect(truncateRepoStructure("structure", 0)).toBe("");
      expect(truncateRepoStructure("structure", -1)).toBe("");
    });

    it("should return original structure if within budget", () => {
      const tokens = estimateTokenCount(sampleStructure);
      expect(truncateRepoStructure(sampleStructure, tokens + 10)).toBe(sampleStructure);
    });

    it("should prioritize important files", () => {
      const result = truncateRepoStructure(sampleStructure, 15);

      // Should include some high-priority files
      const hasImportantFiles = result.includes("README.md") ||
                               result.includes("package.json") ||
                               result.includes("tsconfig.json");
      expect(hasImportantFiles).toBe(true);

      // Should exclude low-priority files
      expect(result).not.toContain("node_modules");
    });

    it("should maintain some semblance of order", () => {
      const result = truncateRepoStructure(sampleStructure, 20);
      const lines = result.split('\n').filter(line => line.trim());

      // README should come before package.json (if both present)
      const readmeIndex = lines.findIndex(line => line.includes("README.md"));
      const packageIndex = lines.findIndex(line => line.includes("package.json"));

      if (readmeIndex >= 0 && packageIndex >= 0) {
        expect(readmeIndex).toBeLessThan(packageIndex);
      }
    });

    it("should add truncation indicator when needed", () => {
      const result = truncateRepoStructure(sampleStructure, 3);
      const shouldHaveIndicator = result.includes("...") || result.split('\n').length < sampleStructure.split('\n').length;
      expect(shouldHaveIndicator).toBe(true);
    });

    it("should handle single line structures", () => {
      const singleLine = "README.md";
      const result = truncateRepoStructure(singleLine, 5);
      expect(result).toContain("README.md");
    });

    it("should prioritize TypeScript and source files", () => {
      const structure = `README.md
src/index.ts
src/utils.tsx
build/output.js
random.txt
package.json`;

      const result = truncateRepoStructure(structure, 12);
      const hasSourceFiles = result.includes("index.ts") || result.includes("utils.tsx");
      const hasConfigFiles = result.includes("README.md") || result.includes("package.json");

      expect(hasSourceFiles || hasConfigFiles).toBe(true);
      // Should prefer important files over random files
      expect(result).not.toContain("random.txt");
    });
  });
});