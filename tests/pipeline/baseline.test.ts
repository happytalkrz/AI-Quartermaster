import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { printResult } from "../../src/pipeline/reporting/result-reporter.js";
import type { PipelineReport } from "../../src/pipeline/reporting/result-reporter.js";

function makeReport(overrides: Partial<PipelineReport> = {}): PipelineReport {
  return {
    issueNumber: 1,
    repo: "test/repo",
    success: true,
    plan: { title: "Test Plan", phaseCount: 1 },
    phases: [{ name: "Phase 1", success: true, durationMs: 100 }],
    totalDurationMs: 100,
    ...overrides,
  };
}

describe("printResult — verificationIncomplete", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints verification incomplete warning when verificationIncomplete is set", () => {
    const report = makeReport({
      verificationIncomplete: ["baseline: tsc 실행 실패 — tsc not found"],
    });
    printResult(report);
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("검증 불완전");
    expect(output).toContain("baseline: tsc 실행 실패 — tsc not found");
  });

  it("does not print verification warning when verificationIncomplete is undefined", () => {
    const report = makeReport();
    printResult(report);
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).not.toContain("검증 불완전");
  });

  it("does not print verification warning when verificationIncomplete is empty array", () => {
    const report = makeReport({ verificationIncomplete: [] });
    printResult(report);
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).not.toContain("검증 불완전");
  });

  it("prints all entries when multiple verificationIncomplete warnings exist", () => {
    const report = makeReport({
      verificationIncomplete: [
        "baseline: tsc 실행 실패 — err1",
        "baseline: eslint 실행 실패 — err2",
        "baseline: build 실행 실패 — err3",
      ],
    });
    printResult(report);
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("baseline: tsc 실행 실패 — err1");
    expect(output).toContain("baseline: eslint 실행 실패 — err2");
    expect(output).toContain("baseline: build 실행 실패 — err3");
  });

  it("still prints SUCCESS even when verificationIncomplete is set", () => {
    const report = makeReport({
      success: true,
      verificationIncomplete: ["baseline: tsc 실행 실패 — err"],
    });
    printResult(report);
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("SUCCESS");
    expect(output).toContain("검증 불완전");
  });
});
