import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { formatResult } from "../../../src/pipeline/reporting/result-reporter.js";
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
