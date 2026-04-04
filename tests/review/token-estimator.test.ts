import { describe, it, expect } from "vitest";
import {
  estimateTokenCount,
  getTokenLimit,
  getEffectiveTokenLimit,
  exceedsTokenLimit,
  analyzeTokenUsage,
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
});