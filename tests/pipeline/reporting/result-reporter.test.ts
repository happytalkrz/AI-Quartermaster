import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { formatResult, printResult } from "../../../src/pipeline/reporting/result-reporter.js";
import type { PipelineReport } from "../../../src/pipeline/reporting/result-reporter.js";
import type { Plan, PhaseResult } from "../../../src/types/pipeline.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    issueNumber: 42,
    title: "Test Plan",
    problemDefinition: "Fix a bug",
    requirements: [],
    affectedFiles: [],
    risks: [],
    phases: [
      { index: 0, name: "Phase 1", description: "First", targetFiles: [], commitStrategy: "", verificationCriteria: [] },
    ],
    verificationPoints: [],
    stopConditions: [],
    ...overrides,
  };
}

describe("formatResult usedModel field", () => {
  it("includes usedModel in phase report when fallback model was used", () => {
    const results: PhaseResult[] = [
      {
        phaseIndex: 0,
        phaseName: "Phase 1",
        success: true,
        commitHash: "abc12345",
        durationMs: 1000,
        usedModel: "claude-haiku-4-5-20251001",
      },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 1000);
    expect(report.phases[0].usedModel).toBe("claude-haiku-4-5-20251001");
  });

  it("has undefined usedModel when not set in PhaseResult", () => {
    const results: PhaseResult[] = [
      {
        phaseIndex: 0,
        phaseName: "Phase 1",
        success: true,
        commitHash: "abc12345",
        durationMs: 1000,
      },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 1000);
    expect(report.phases[0].usedModel).toBeUndefined();
  });

  it("maps usedModel for each phase independently", () => {
    const plan = makePlan({
      phases: [
        { index: 0, name: "Phase 1", description: "First", targetFiles: [], commitStrategy: "", verificationCriteria: [] },
        { index: 1, name: "Phase 2", description: "Second", targetFiles: [], commitStrategy: "", verificationCriteria: [] },
      ],
    });
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: true, durationMs: 1000 },
      { phaseIndex: 1, phaseName: "Phase 2", success: true, durationMs: 2000, usedModel: "claude-haiku-4-5-20251001" },
    ];
    const report = formatResult(42, "test/repo", plan, results, Date.now() - 3000);
    expect(report.phases[0].usedModel).toBeUndefined();
    expect(report.phases[1].usedModel).toBe("claude-haiku-4-5-20251001");
  });
});

describe("formatResult cacheHitRatio", () => {
  it("calculates cacheHitRatio from totalUsage when cache tokens are present", () => {
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: true, durationMs: 1000 },
    ];
    const totalUsage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 3000 };
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 1000, undefined, totalUsage);
    expect(report.totalUsage).toEqual(totalUsage);
    expect(report.cacheHitRatio).toBeCloseTo(0.75, 5);
  });

  it("leaves cacheHitRatio undefined when totalUsage is not provided", () => {
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: true, durationMs: 1000 },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 1000);
    expect(report.totalUsage).toBeUndefined();
    expect(report.cacheHitRatio).toBeUndefined();
  });
});

describe("printResult cache line", () => {
  it("outputs '캐시 히트율' line with percentage and saved tokens when cache tokens are present", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const report: PipelineReport = {
      issueNumber: 42,
      repo: "test/repo",
      success: true,
      plan: { title: "Test Plan", phaseCount: 1 },
      phases: [],
      totalDurationMs: 1000,
      totalUsage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 3000 },
      cacheHitRatio: 0.75,
    };
    printResult(report);
    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).toContain("캐시 히트율: 75.0%, 절감 토큰: 3000");
    consoleSpy.mockRestore();
  });

  it("does not output '캐시 히트율' line when totalUsage is absent", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const report: PipelineReport = {
      issueNumber: 42,
      repo: "test/repo",
      success: true,
      plan: { title: "Test Plan", phaseCount: 1 },
      phases: [],
      totalDurationMs: 1000,
    };
    printResult(report);
    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).not.toContain("캐시 히트율");
    consoleSpy.mockRestore();
  });

  it("does not output '캐시 히트율' line when input + cache_read denominator is zero", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const report: PipelineReport = {
      issueNumber: 42,
      repo: "test/repo",
      success: true,
      plan: { title: "Test Plan", phaseCount: 1 },
      phases: [],
      totalDurationMs: 1000,
      totalUsage: { input_tokens: 0, output_tokens: 0 },
      cacheHitRatio: 0,
    };
    printResult(report);
    const output = consoleSpy.mock.calls.flat().join("\n");
    expect(output).not.toContain("캐시 히트율");
    consoleSpy.mockRestore();
  });
});
