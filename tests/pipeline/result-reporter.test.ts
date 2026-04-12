import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { formatResult, printResult } from "../../src/pipeline/reporting/result-reporter.js";
import type { Plan, PhaseResult } from "../../src/types/pipeline.js";

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
      { index: 1, name: "Phase 2", description: "Second", targetFiles: [], commitStrategy: "", verificationCriteria: [] },
    ],
    verificationPoints: [],
    stopConditions: [],
    ...overrides,
  };
}

function makeSuccessResults(): PhaseResult[] {
  return [
    { phaseIndex: 0, phaseName: "Phase 1", success: true, commitHash: "abc12345def", durationMs: 1000 },
    { phaseIndex: 1, phaseName: "Phase 2", success: true, commitHash: "feedcafe123", durationMs: 2000 },
  ];
}

describe("formatResult", () => {
  it("returns success=true when all phases succeed", () => {
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000);
    expect(report.success).toBe(true);
    expect(report.issueNumber).toBe(42);
    expect(report.repo).toBe("test/repo");
  });

  it("returns success=false when any phase fails", () => {
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: true, commitHash: "abc12345", durationMs: 1000 },
      { phaseIndex: 1, phaseName: "Phase 2", success: false, error: "Tests failed: 2 failing", errorCategory: "VERIFICATION_FAILED", durationMs: 500 },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 1500);
    expect(report.success).toBe(false);
  });

  it("sets errorCategory from the first failed phase", () => {
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: false, error: "TS2345 type error", errorCategory: "TS_ERROR", durationMs: 500 },
      { phaseIndex: 1, phaseName: "Phase 2", success: false, error: "timed out", errorCategory: "TIMEOUT", durationMs: 200 },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 700);
    expect(report.errorCategory).toBe("TS_ERROR");
  });

  it("truncates errorSummary to 500 characters", () => {
    const longError = "x".repeat(800);
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: false, error: longError, errorCategory: "UNKNOWN", durationMs: 100 },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 100);
    expect(report.errorSummary).toHaveLength(500);
  });

  it("truncates commit hash to 8 characters", () => {
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000);
    expect(report.phases[0].commit).toBe("abc12345");
    expect(report.phases[1].commit).toBe("feedcafe");
  });

  it("includes prUrl in report when provided", () => {
    const prUrl = "https://github.com/test/repo/pull/99";
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000, prUrl);
    expect(report.prUrl).toBe(prUrl);
  });

  it("has undefined prUrl when not provided", () => {
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000);
    expect(report.prUrl).toBeUndefined();
  });

  it("maps plan title and phase count correctly", () => {
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000);
    expect(report.plan.title).toBe("Test Plan");
    expect(report.plan.phaseCount).toBe(2);
  });

  it("sets totalDurationMs as a positive number", () => {
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 5000);
    expect(report.totalDurationMs).toBeGreaterThan(0);
  });

  it("maps each phase result including durationMs and error", () => {
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: false, error: "build error", errorCategory: "CLI_CRASH", durationMs: 750 },
    ];
    const report = formatResult(1, "a/b", makePlan(), results, Date.now() - 750);
    expect(report.phases[0].name).toBe("Phase 1");
    expect(report.phases[0].success).toBe(false);
    expect(report.phases[0].error).toBe("build error");
    expect(report.phases[0].errorCategory).toBe("CLI_CRASH");
    expect(report.phases[0].durationMs).toBe(750);
  });
});

describe("printResult", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("logs pipeline result header", () => {
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000);
    printResult(report);
    const allOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(allOutput).toContain("Pipeline Result");
    expect(allOutput).toContain("#42");
    expect(allOutput).toContain("test/repo");
  });

  it("prints SUCCESS for fully passing report", () => {
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000);
    printResult(report);
    const allOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(allOutput).toContain("SUCCESS");
  });

  it("prints FAILED for report with failures", () => {
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: false, error: "broke", errorCategory: "UNKNOWN", durationMs: 100 },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 100);
    printResult(report);
    const allOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(allOutput).toContain("FAILED");
  });

  it("prints PR URL when present", () => {
    const prUrl = "https://github.com/test/repo/pull/7";
    const report = formatResult(42, "test/repo", makePlan(), makeSuccessResults(), Date.now() - 3000, prUrl);
    printResult(report);
    const allOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(allOutput).toContain(prUrl);
  });

  it("prints each phase name and PASS/FAIL status", () => {
    const results: PhaseResult[] = [
      { phaseIndex: 0, phaseName: "Phase 1", success: true, commitHash: "abc12345", durationMs: 1000 },
      { phaseIndex: 1, phaseName: "Phase 2", success: false, error: "err", errorCategory: "UNKNOWN", durationMs: 500 },
    ];
    const report = formatResult(42, "test/repo", makePlan(), results, Date.now() - 1500);
    printResult(report);
    const allOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(allOutput).toContain("Phase 1");
    expect(allOutput).toContain("PASS");
    expect(allOutput).toContain("Phase 2");
    expect(allOutput).toContain("FAIL");
  });
});
