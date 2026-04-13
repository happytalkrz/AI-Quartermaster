import { describe, it, expect } from "vitest";
import { buildCostBreakdown } from "../src/pipeline/core/core-loop.js";
import { buildPhaseCostTable, buildModelSummary } from "../src/github/pr-creator.js";
import type { PhaseResult, ModelCostEntry, CostBreakdown } from "../src/types/pipeline.js";

vi.mock("../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  setGlobalLogLevel: vi.fn(),
}));

import { vi } from "vitest";

function makeModelCost(model: string, costUsd: number, input = 100, output = 50): ModelCostEntry {
  return {
    model,
    costUsd,
    usage: { input_tokens: input, output_tokens: output },
  };
}

function makePhaseResult(opts: {
  phaseIndex?: number;
  phaseName?: string;
  costUsd?: number;
  retryCostUsd?: number;
  retryCount?: number;
  modelCosts?: ModelCostEntry[];
}): PhaseResult {
  return {
    phaseIndex: opts.phaseIndex ?? 0,
    phaseName: opts.phaseName ?? `Phase ${(opts.phaseIndex ?? 0) + 1}`,
    success: true,
    durationMs: 1000,
    costUsd: opts.costUsd,
    retryCostUsd: opts.retryCostUsd,
    retryCount: opts.retryCount,
    modelCosts: opts.modelCosts,
  };
}

describe("buildCostBreakdown", () => {
  describe("총합 계산", () => {
    it("plan + phase + retry + review 비용의 합이 totalCostUsd와 일치한다", () => {
      const planCostUsd = 0.01;
      const reviewCostUsd = 0.003;
      const phaseResults = [
        makePhaseResult({ phaseIndex: 0, costUsd: 0.02, retryCostUsd: 0.005, retryCount: 1 }),
        makePhaseResult({ phaseIndex: 1, costUsd: 0.015, retryCostUsd: 0, retryCount: 0 }),
      ];

      const result = buildCostBreakdown(planCostUsd, phaseResults, reviewCostUsd);

      // 0.01 + (0.02 + 0.005) + (0.015 + 0) + 0.003 = 0.053
      expect(result.totalCostUsd).toBeCloseTo(0.053, 6);
      expect(result.planCostUsd).toBe(0.01);
      expect(result.reviewCostUsd).toBe(0.003);
    });

    it("planCostUsd가 undefined이면 0으로 처리된다", () => {
      const phaseResults = [makePhaseResult({ costUsd: 0.05 })];
      const result = buildCostBreakdown(undefined, phaseResults, 0.01);

      expect(result.planCostUsd).toBe(0);
      expect(result.totalCostUsd).toBeCloseTo(0.06, 6);
    });

    it("reviewCostUsd 기본값은 0이다", () => {
      const phaseResults = [makePhaseResult({ costUsd: 0.05 })];
      const result = buildCostBreakdown(0.01, phaseResults);

      expect(result.reviewCostUsd).toBe(0);
      expect(result.totalCostUsd).toBeCloseTo(0.06, 6);
    });

    it("phaseResults가 비어 있으면 planCost + reviewCost만 합산된다", () => {
      const result = buildCostBreakdown(0.01, [], 0.005);

      expect(result.totalCostUsd).toBeCloseTo(0.015, 6);
      expect(result.phaseCosts).toHaveLength(0);
    });

    it("모든 비용이 undefined/0이면 totalCostUsd는 0이다", () => {
      const result = buildCostBreakdown(undefined, []);

      expect(result.totalCostUsd).toBe(0);
    });
  });

  describe("phaseCosts 조립", () => {
    it("phaseResult의 비용 필드를 올바르게 매핑한다", () => {
      const phaseResults = [
        makePhaseResult({ phaseIndex: 0, phaseName: "타입 정의", costUsd: 0.01, retryCostUsd: 0.002, retryCount: 1 }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.phaseCosts).toHaveLength(1);
      expect(result.phaseCosts[0]).toEqual({
        phaseIndex: 0,
        phaseName: "타입 정의",
        costUsd: 0.01,
        retryCostUsd: 0.002,
        retryCount: 1,
        modelCosts: [],
      });
    });

    it("costUsd, retryCostUsd, retryCount가 undefined이면 0으로 처리된다", () => {
      const phaseResults = [makePhaseResult({ phaseIndex: 0 })];

      const result = buildCostBreakdown(0, phaseResults);

      const phase = result.phaseCosts[0];
      expect(phase.costUsd).toBe(0);
      expect(phase.retryCostUsd).toBe(0);
      expect(phase.retryCount).toBe(0);
    });

    it("modelCosts가 undefined이면 빈 배열로 처리된다", () => {
      const phaseResults = [makePhaseResult({ phaseIndex: 0, costUsd: 0.01 })];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.phaseCosts[0].modelCosts).toEqual([]);
    });

    it("여러 phase 결과가 각각 phaseCosts 항목으로 매핑된다", () => {
      const phaseResults = [
        makePhaseResult({ phaseIndex: 0, phaseName: "Phase A", costUsd: 0.01 }),
        makePhaseResult({ phaseIndex: 1, phaseName: "Phase B", costUsd: 0.02 }),
        makePhaseResult({ phaseIndex: 2, phaseName: "Phase C", costUsd: 0.03 }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.phaseCosts).toHaveLength(3);
      expect(result.phaseCosts.map(p => p.phaseName)).toEqual(["Phase A", "Phase B", "Phase C"]);
    });
  });

  describe("model별 비용 집계 (modelSummary)", () => {
    it("단일 phase의 modelCosts가 modelSummary에 그대로 반영된다", () => {
      const phaseResults = [
        makePhaseResult({
          phaseIndex: 0,
          costUsd: 0.05,
          modelCosts: [makeModelCost("claude-sonnet-4-6", 0.05, 1000, 500)],
        }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.modelSummary).toHaveLength(1);
      expect(result.modelSummary[0].model).toBe("claude-sonnet-4-6");
      expect(result.modelSummary[0].costUsd).toBeCloseTo(0.05, 6);
      expect(result.modelSummary[0].usage.input_tokens).toBe(1000);
      expect(result.modelSummary[0].usage.output_tokens).toBe(500);
    });

    it("같은 모델이 여러 phase에 걸쳐 있으면 비용과 토큰이 합산된다", () => {
      const phaseResults = [
        makePhaseResult({
          phaseIndex: 0,
          costUsd: 0.03,
          modelCosts: [makeModelCost("claude-sonnet-4-6", 0.03, 600, 300)],
        }),
        makePhaseResult({
          phaseIndex: 1,
          costUsd: 0.04,
          modelCosts: [makeModelCost("claude-sonnet-4-6", 0.04, 800, 400)],
        }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.modelSummary).toHaveLength(1);
      const entry = result.modelSummary[0];
      expect(entry.model).toBe("claude-sonnet-4-6");
      expect(entry.costUsd).toBeCloseTo(0.07, 6);
      expect(entry.usage.input_tokens).toBe(1400);
      expect(entry.usage.output_tokens).toBe(700);
    });

    it("다른 모델은 별도 modelSummary 항목으로 집계된다", () => {
      const phaseResults = [
        makePhaseResult({
          phaseIndex: 0,
          costUsd: 0.03,
          modelCosts: [makeModelCost("claude-sonnet-4-6", 0.03, 600, 300)],
        }),
        makePhaseResult({
          phaseIndex: 1,
          costUsd: 0.05,
          modelCosts: [makeModelCost("claude-opus-4-6", 0.05, 200, 100)],
        }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.modelSummary).toHaveLength(2);
      const models = result.modelSummary.map(m => m.model);
      expect(models).toContain("claude-sonnet-4-6");
      expect(models).toContain("claude-opus-4-6");
    });

    it("한 phase에 여러 모델이 있을 때 각각 집계된다", () => {
      const phaseResults = [
        makePhaseResult({
          phaseIndex: 0,
          costUsd: 0.08,
          modelCosts: [
            makeModelCost("claude-sonnet-4-6", 0.03, 600, 300),
            makeModelCost("claude-haiku-4-5", 0.05, 1000, 500),
          ],
        }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.modelSummary).toHaveLength(2);
    });

    it("modelCosts가 없는 phase만 있으면 modelSummary는 빈 배열이다", () => {
      const phaseResults = [
        makePhaseResult({ phaseIndex: 0, costUsd: 0.01 }),
        makePhaseResult({ phaseIndex: 1, costUsd: 0.02 }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      expect(result.modelSummary).toEqual([]);
    });

    it("cache 토큰 필드가 있으면 합산된다", () => {
      const phaseResults = [
        makePhaseResult({
          phaseIndex: 0,
          costUsd: 0.03,
          modelCosts: [{
            model: "claude-sonnet-4-6",
            costUsd: 0.03,
            usage: {
              input_tokens: 500,
              output_tokens: 200,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 50,
            },
          }],
        }),
        makePhaseResult({
          phaseIndex: 1,
          costUsd: 0.02,
          modelCosts: [{
            model: "claude-sonnet-4-6",
            costUsd: 0.02,
            usage: {
              input_tokens: 400,
              output_tokens: 150,
              cache_creation_input_tokens: 80,
              cache_read_input_tokens: 60,
            },
          }],
        }),
      ];

      const result = buildCostBreakdown(0, phaseResults);

      const entry = result.modelSummary[0];
      expect(entry.usage.cache_creation_input_tokens).toBe(180);
      expect(entry.usage.cache_read_input_tokens).toBe(110);
    });
  });

  describe("edge case", () => {
    it("phaseResults에 비용 필드가 일부만 있는 경우 합산이 정상 동작한다", () => {
      const phaseResults = [
        makePhaseResult({ phaseIndex: 0, costUsd: 0.01 }),
        makePhaseResult({ phaseIndex: 1 }), // costUsd 없음
        makePhaseResult({ phaseIndex: 2, costUsd: 0.03, retryCostUsd: 0.01 }),
      ];

      const result = buildCostBreakdown(0.005, phaseResults);

      // 0.005 + 0.01 + 0 + 0.03 + 0.01 = 0.055
      expect(result.totalCostUsd).toBeCloseTo(0.055, 6);
    });

    it("planCostUsd=0, phaseResults=[], reviewCostUsd=0 → 모두 0", () => {
      const result = buildCostBreakdown(0, [], 0);

      expect(result.planCostUsd).toBe(0);
      expect(result.reviewCostUsd).toBe(0);
      expect(result.totalCostUsd).toBe(0);
      expect(result.phaseCosts).toEqual([]);
      expect(result.modelSummary).toEqual([]);
    });
  });
});

describe("buildPhaseCostTable", () => {
  it("breakdown이 undefined이면 빈 문자열을 반환한다", () => {
    expect(buildPhaseCostTable(undefined)).toBe('');
  });

  it("phaseCosts가 빈 배열이면 빈 문자열을 반환한다", () => {
    const breakdown: CostBreakdown = {
      planCostUsd: 0,
      phaseCosts: [],
      reviewCostUsd: 0,
      totalCostUsd: 0,
      modelSummary: [],
    };
    expect(buildPhaseCostTable(breakdown)).toBe('');
  });

  it("단일 phase → 올바른 마크다운 테이블 형식을 반환한다", () => {
    const breakdown: CostBreakdown = {
      planCostUsd: 0.01,
      phaseCosts: [{
        phaseIndex: 0,
        phaseName: "타입 정의",
        costUsd: 0.02,
        retryCostUsd: 0.005,
        retryCount: 1,
        modelCosts: [],
      }],
      reviewCostUsd: 0,
      totalCostUsd: 0.035,
      modelSummary: [],
    };

    const result = buildPhaseCostTable(breakdown);

    expect(result).toContain("### Phase Cost Breakdown");
    expect(result).toContain("| Phase | Cost | Retries | Retry Cost |");
    expect(result).toContain("타입 정의");
    expect(result).toContain("$0.0200");
    expect(result).toContain("$0.0050");
    expect(result).toContain("1");
  });

  it("여러 phase → 각 row가 포함된 테이블을 반환한다", () => {
    const breakdown: CostBreakdown = {
      planCostUsd: 0,
      phaseCosts: [
        { phaseIndex: 0, phaseName: "Phase A", costUsd: 0.01, retryCostUsd: 0, retryCount: 0, modelCosts: [] },
        { phaseIndex: 1, phaseName: "Phase B", costUsd: 0.02, retryCostUsd: 0.001, retryCount: 1, modelCosts: [] },
      ],
      reviewCostUsd: 0,
      totalCostUsd: 0.031,
      modelSummary: [],
    };

    const result = buildPhaseCostTable(breakdown);

    expect(result).toContain("Phase A");
    expect(result).toContain("Phase B");
  });
});

describe("buildModelSummary", () => {
  it("breakdown이 undefined이면 빈 문자열을 반환한다", () => {
    expect(buildModelSummary(undefined)).toBe('');
  });

  it("modelSummary가 빈 배열이면 빈 문자열을 반환한다", () => {
    const breakdown: CostBreakdown = {
      planCostUsd: 0,
      phaseCosts: [],
      reviewCostUsd: 0,
      totalCostUsd: 0,
      modelSummary: [],
    };
    expect(buildModelSummary(breakdown)).toBe('');
  });

  it("모델이 있으면 올바른 마크다운 테이블 형식을 반환한다", () => {
    const breakdown: CostBreakdown = {
      planCostUsd: 0,
      phaseCosts: [],
      reviewCostUsd: 0,
      totalCostUsd: 0.05,
      modelSummary: [makeModelCost("claude-sonnet-4-6", 0.05)],
    };

    const result = buildModelSummary(breakdown);

    expect(result).toContain("### Model Usage");
    expect(result).toContain("| Model | Cost |");
    expect(result).toContain("claude-sonnet-4-6");
    expect(result).toContain("$0.0500");
  });

  it("여러 모델이 있으면 각 row가 포함된다", () => {
    const breakdown: CostBreakdown = {
      planCostUsd: 0,
      phaseCosts: [],
      reviewCostUsd: 0,
      totalCostUsd: 0.08,
      modelSummary: [
        makeModelCost("claude-sonnet-4-6", 0.03),
        makeModelCost("claude-opus-4-6", 0.05),
      ],
    };

    const result = buildModelSummary(breakdown);

    expect(result).toContain("claude-sonnet-4-6");
    expect(result).toContain("claude-opus-4-6");
  });
});
