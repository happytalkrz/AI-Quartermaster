import { describe, it, expect } from "vitest";
import {
  calculateCostFromUsage,
  calculateCacheHitRatio,
  getModelPricingInfo,
  MODEL_PRICING,
  DEFAULT_PRICING,
  CACHE_PRICING
} from "../../src/claude/token-pricing.js";
import type { UsageInfo } from "../../src/types/pipeline.js";

describe("token-pricing", () => {
  describe("calculateCostFromUsage", () => {
    it("should calculate cost for basic input/output tokens (sonnet)", () => {
      const usage: UsageInfo = {
        input_tokens: 1_000_000, // 1M tokens
        output_tokens: 500_000,  // 0.5M tokens
      };

      const cost = calculateCostFromUsage(usage, "claude-3-sonnet-20240229");

      // Expected: 1M * $3 + 0.5M * $15 = $3 + $7.5 = $10.5
      expect(cost).toBeCloseTo(10.5, 6);
    });

    it("should calculate cost for haiku model", () => {
      const usage: UsageInfo = {
        input_tokens: 2_000_000, // 2M tokens
        output_tokens: 1_000_000, // 1M tokens
      };

      const cost = calculateCostFromUsage(usage, "claude-3-haiku-20240307");

      // Expected: 2M * $0.25 + 1M * $1.25 = $0.5 + $1.25 = $1.75
      expect(cost).toBeCloseTo(1.75, 6);
    });

    it("should calculate cost for opus model", () => {
      const usage: UsageInfo = {
        input_tokens: 100_000, // 0.1M tokens
        output_tokens: 50_000,  // 0.05M tokens
      };

      const cost = calculateCostFromUsage(usage, "claude-3-opus-20240229");

      // Expected: 0.1M * $15 + 0.05M * $75 = $1.5 + $3.75 = $5.25
      expect(cost).toBeCloseTo(5.25, 6);
    });

    it("should handle cache read tokens", () => {
      const usage: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 200_000, // 0.2M tokens
      };

      const cost = calculateCostFromUsage(usage, "sonnet");

      // Expected:
      // Base: 1M * $3 + 0.5M * $15 = $10.5
      // Cache read: 0.2M * $3 * 0.1 = $0.06
      // Total: $10.5 + $0.06 = $10.56
      expect(cost).toBeCloseTo(10.56, 6);
    });

    it("should handle cache creation tokens", () => {
      const usage: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_creation_input_tokens: 100_000, // 0.1M tokens
      };

      const cost = calculateCostFromUsage(usage, "sonnet");

      // Expected:
      // Base: 1M * $3 + 0.5M * $15 = $10.5
      // Cache creation: 0.1M * $3 * 1.25 = $0.375
      // Total: $10.5 + $0.375 = $10.875
      expect(cost).toBeCloseTo(10.875, 6);
    });

    it("should handle all token types together", () => {
      const usage: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 200_000,
        cache_creation_input_tokens: 100_000,
      };

      const cost = calculateCostFromUsage(usage, "sonnet");

      // Expected:
      // Base: 1M * $3 + 0.5M * $15 = $10.5
      // Cache read: 0.2M * $3 * 0.1 = $0.06
      // Cache creation: 0.1M * $3 * 1.25 = $0.375
      // Total: $10.5 + $0.06 + $0.375 = $10.935
      expect(cost).toBeCloseTo(10.935, 6);
    });

    it("should use default pricing for unknown models", () => {
      const usage: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
      };

      const cost = calculateCostFromUsage(usage, "unknown-model");

      // Should use default pricing (same as sonnet)
      // Expected: 1M * $3 + 0.5M * $15 = $10.5
      expect(cost).toBeCloseTo(10.5, 6);
    });

    it("should handle zero tokens", () => {
      const usage: UsageInfo = {
        input_tokens: 0,
        output_tokens: 0,
      };

      const cost = calculateCostFromUsage(usage, "sonnet");
      expect(cost).toBe(0);
    });

    it("should normalize model names correctly", () => {
      const usage: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
      };

      // Test various model name formats
      const sonnetCost1 = calculateCostFromUsage(usage, "claude-3-sonnet-20240229");
      const sonnetCost2 = calculateCostFromUsage(usage, "SONNET");
      const sonnetCost3 = calculateCostFromUsage(usage, "sonnet");

      expect(sonnetCost1).toBeCloseTo(sonnetCost2, 6);
      expect(sonnetCost2).toBeCloseTo(sonnetCost3, 6);

      const haikuCost1 = calculateCostFromUsage(usage, "claude-3-haiku-20240307");
      const haikuCost2 = calculateCostFromUsage(usage, "HAIKU");

      // Haiku should be different from sonnet
      expect(haikuCost1).not.toBeCloseTo(sonnetCost1, 6);
      expect(haikuCost1).toBeCloseTo(haikuCost2, 6);
    });
  });

  describe("getModelPricingInfo", () => {
    it("should return pricing info for known models", () => {
      const info = getModelPricingInfo("claude-3-sonnet-20240229");

      expect(info.normalizedName).toBe("sonnet");
      expect(info.input).toBe(MODEL_PRICING.sonnet.input);
      expect(info.output).toBe(MODEL_PRICING.sonnet.output);
    });

    it("should return pricing info for haiku", () => {
      const info = getModelPricingInfo("haiku");

      expect(info.normalizedName).toBe("haiku");
      expect(info.input).toBe(MODEL_PRICING.haiku.input);
      expect(info.output).toBe(MODEL_PRICING.haiku.output);
    });

    it("should return pricing info for opus", () => {
      const info = getModelPricingInfo("claude-3-opus-20240229");

      expect(info.normalizedName).toBe("opus");
      expect(info.input).toBe(MODEL_PRICING.opus.input);
      expect(info.output).toBe(MODEL_PRICING.opus.output);
    });

    it("should return default pricing for unknown models", () => {
      const info = getModelPricingInfo("unknown-model");

      expect(info.normalizedName).toBe("unknown");
      expect(info.input).toBe(DEFAULT_PRICING.input);
      expect(info.output).toBe(DEFAULT_PRICING.output);
    });

    it("should handle case insensitive model names", () => {
      const info1 = getModelPricingInfo("SONNET");
      const info2 = getModelPricingInfo("sonnet");
      const info3 = getModelPricingInfo("Sonnet");

      expect(info1).toEqual(info2);
      expect(info2).toEqual(info3);
    });
  });

  describe("constants", () => {
    it("should have correct model pricing values", () => {
      expect(MODEL_PRICING.sonnet.input).toBe(3.0);
      expect(MODEL_PRICING.sonnet.output).toBe(15.0);

      expect(MODEL_PRICING.haiku.input).toBe(0.25);
      expect(MODEL_PRICING.haiku.output).toBe(1.25);

      expect(MODEL_PRICING.opus.input).toBe(15.0);
      expect(MODEL_PRICING.opus.output).toBe(75.0);
    });

    it("should have correct cache pricing multipliers", () => {
      expect(CACHE_PRICING.READ_MULTIPLIER).toBe(0.1);
      expect(CACHE_PRICING.CREATION_MULTIPLIER).toBe(1.25);
    });

    it("should have default pricing that matches sonnet", () => {
      expect(DEFAULT_PRICING.input).toBe(MODEL_PRICING.sonnet.input);
      expect(DEFAULT_PRICING.output).toBe(MODEL_PRICING.sonnet.output);
    });
  });

  describe("calculateCacheHitRatio", () => {
    it("should return 0 when no cache read tokens", () => {
      const usage: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
      };
      expect(calculateCacheHitRatio(usage)).toBe(0);
    });

    it("should calculate ratio correctly with cache read tokens", () => {
      const usage: UsageInfo = {
        input_tokens: 800_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 200_000,
      };
      // 200_000 / (800_000 + 200_000) = 0.2
      expect(calculateCacheHitRatio(usage)).toBeCloseTo(0.2, 9);
    });

    it("should return 1 when all tokens are cache read", () => {
      const usage: UsageInfo = {
        input_tokens: 0,
        output_tokens: 500_000,
        cache_read_input_tokens: 1_000_000,
      };
      // 1_000_000 / (0 + 1_000_000) = 1.0
      expect(calculateCacheHitRatio(usage)).toBe(1);
    });

    it("should return 0 when all tokens are zero", () => {
      const usage: UsageInfo = {
        input_tokens: 0,
        output_tokens: 0,
      };
      expect(calculateCacheHitRatio(usage)).toBe(0);
    });

    it("should ignore cache_creation tokens in ratio", () => {
      const usage: UsageInfo = {
        input_tokens: 800_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 200_000,
        cache_creation_input_tokens: 500_000,
      };
      // cache_creation은 분자/분모 모두 포함하지 않음
      // 200_000 / (800_000 + 200_000) = 0.2
      expect(calculateCacheHitRatio(usage)).toBeCloseTo(0.2, 9);
    });
  });

  describe("edge cases", () => {
    it("should handle very small token amounts", () => {
      const usage: UsageInfo = {
        input_tokens: 1, // 1 token
        output_tokens: 1, // 1 token
      };

      const cost = calculateCostFromUsage(usage, "sonnet");

      // Expected: 1 * $3 / 1M + 1 * $15 / 1M = $0.000003 + $0.000015 = $0.000018
      expect(cost).toBeCloseTo(0.000018, 9);
    });

    it("should handle very large token amounts", () => {
      const usage: UsageInfo = {
        input_tokens: 100_000_000, // 100M tokens
        output_tokens: 50_000_000,  // 50M tokens
      };

      const cost = calculateCostFromUsage(usage, "sonnet");

      // Expected: 100M * $3 / 1M + 50M * $15 / 1M = $300 + $750 = $1050
      expect(cost).toBeCloseTo(1050, 6);
    });

    it("should handle missing optional cache tokens", () => {
      const usageWithoutCache: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        // No cache tokens
      };

      const usageWithUndefinedCache: UsageInfo = {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_input_tokens: undefined,
        cache_creation_input_tokens: undefined,
      };

      const cost1 = calculateCostFromUsage(usageWithoutCache, "sonnet");
      const cost2 = calculateCostFromUsage(usageWithUndefinedCache, "sonnet");

      expect(cost1).toBeCloseTo(cost2, 6);
      expect(cost1).toBeCloseTo(10.5, 6); // Base cost only
    });
  });
});