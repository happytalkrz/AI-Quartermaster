import { describe, it, expect } from "vitest";
import {
  makePseudoPhaseSuccess,
  makePseudoPhaseFailure,
  isPseudoPhase,
  PSEUDO_PHASE_INDEX,
  nowIso,
  type PseudoPhaseName,
} from "../../../src/pipeline/reporting/phase-result-helper.js";

describe("PSEUDO_PHASE_INDEX", () => {
  it("모든 pseudo-phase 인덱스는 음수이다", () => {
    for (const [, value] of Object.entries(PSEUDO_PHASE_INDEX)) {
      expect(value).toBeLessThan(0);
    }
  });

  it("각 phase의 인덱스 값이 올바르다", () => {
    expect(PSEUDO_PHASE_INDEX["setup:worktree"]).toBe(-7);
    expect(PSEUDO_PHASE_INDEX["setup:dependency"]).toBe(-6);
    expect(PSEUDO_PHASE_INDEX["plan:generate"]).toBe(-5);
    expect(PSEUDO_PHASE_INDEX["review:code"]).toBe(-4);
    expect(PSEUDO_PHASE_INDEX["review:simplify"]).toBe(-3);
    expect(PSEUDO_PHASE_INDEX["validation:check"]).toBe(-2);
    expect(PSEUDO_PHASE_INDEX["publish:pr"]).toBe(-1);
  });

  it("7개의 pseudo-phase가 정의되어 있다", () => {
    const names: PseudoPhaseName[] = [
      "setup:worktree",
      "setup:dependency",
      "plan:generate",
      "review:code",
      "review:simplify",
      "validation:check",
      "publish:pr",
    ];
    expect(Object.keys(PSEUDO_PHASE_INDEX)).toHaveLength(names.length);
    for (const name of names) {
      expect(PSEUDO_PHASE_INDEX[name]).toBeDefined();
    }
  });

  it("인덱스 값이 모두 고유하다", () => {
    const values = Object.values(PSEUDO_PHASE_INDEX);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe("makePseudoPhaseSuccess", () => {
  it("success=true인 PhaseResult를 반환한다", () => {
    const result = makePseudoPhaseSuccess("setup:worktree", 1234);
    expect(result.success).toBe(true);
    expect(result.phaseIndex).toBe(-7);
    expect(result.phaseName).toBe("setup:worktree");
    expect(result.durationMs).toBe(1234);
  });

  it("error 필드가 없다", () => {
    const result = makePseudoPhaseSuccess("plan:generate", 500);
    expect(result.error).toBeUndefined();
    expect(result.errorCategory).toBeUndefined();
  });

  it("opts 없이 호출 시 timestamp 필드는 undefined이다", () => {
    const result = makePseudoPhaseSuccess("publish:pr", 999);
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });

  it("opts.startedAt, completedAt, costUsd를 포함한다", () => {
    const result = makePseudoPhaseSuccess("review:code", 2000, {
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      costUsd: 0.05,
    });
    expect(result.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.completedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(result.costUsd).toBe(0.05);
  });

  it("각 pseudo-phase 이름에 대해 올바른 phaseIndex를 할당한다", () => {
    const cases: PseudoPhaseName[] = [
      "setup:worktree",
      "setup:dependency",
      "plan:generate",
      "review:code",
      "review:simplify",
      "validation:check",
      "publish:pr",
    ];
    for (const name of cases) {
      const result = makePseudoPhaseSuccess(name, 100);
      expect(result.phaseIndex).toBe(PSEUDO_PHASE_INDEX[name]);
      expect(result.phaseName).toBe(name);
    }
  });
});

describe("makePseudoPhaseFailure", () => {
  it("success=false인 PhaseResult를 반환한다", () => {
    const result = makePseudoPhaseFailure("setup:dependency", 300, "install failed");
    expect(result.success).toBe(false);
    expect(result.phaseIndex).toBe(-6);
    expect(result.phaseName).toBe("setup:dependency");
    expect(result.durationMs).toBe(300);
    expect(result.error).toBe("install failed");
  });

  it("opts 없이 호출 시 optional 필드는 undefined이다", () => {
    const result = makePseudoPhaseFailure("validation:check", 100, "timeout");
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.errorCategory).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });

  it("opts.errorCategory, timestamps, costUsd를 포함한다", () => {
    const result = makePseudoPhaseFailure("review:code", 5000, "review failed", {
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      errorCategory: "VERIFICATION_FAILED",
      costUsd: 0.12,
    });
    expect(result.errorCategory).toBe("VERIFICATION_FAILED");
    expect(result.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.completedAt).toBe("2026-01-01T00:00:05.000Z");
    expect(result.costUsd).toBe(0.12);
  });

  it("각 pseudo-phase 이름에 대해 올바른 phaseIndex를 할당한다", () => {
    const cases: PseudoPhaseName[] = [
      "setup:worktree",
      "setup:dependency",
      "review:code",
      "publish:pr",
    ];
    for (const name of cases) {
      const result = makePseudoPhaseFailure(name, 50, "err");
      expect(result.phaseIndex).toBe(PSEUDO_PHASE_INDEX[name]);
    }
  });
});

describe("isPseudoPhase", () => {
  it("phaseIndex < 0이면 true를 반환한다", () => {
    expect(isPseudoPhase({ phaseIndex: -1, phaseName: "publish:pr", success: true, durationMs: 0 })).toBe(true);
    expect(isPseudoPhase({ phaseIndex: -7, phaseName: "setup:worktree", success: true, durationMs: 0 })).toBe(true);
    expect(isPseudoPhase({ phaseIndex: -100, phaseName: "x", success: false, durationMs: 0 })).toBe(true);
  });

  it("phaseIndex >= 0이면 false를 반환한다", () => {
    expect(isPseudoPhase({ phaseIndex: 0, phaseName: "Phase 1", success: true, durationMs: 0 })).toBe(false);
    expect(isPseudoPhase({ phaseIndex: 1, phaseName: "Phase 2", success: true, durationMs: 0 })).toBe(false);
    expect(isPseudoPhase({ phaseIndex: 99, phaseName: "Phase 99", success: false, durationMs: 0 })).toBe(false);
  });

  it("makePseudoPhaseSuccess로 생성된 결과는 항상 isPseudoPhase=true이다", () => {
    const names: PseudoPhaseName[] = [
      "setup:worktree",
      "setup:dependency",
      "plan:generate",
      "review:code",
      "review:simplify",
      "validation:check",
      "publish:pr",
    ];
    for (const name of names) {
      const result = makePseudoPhaseSuccess(name, 0);
      expect(isPseudoPhase(result)).toBe(true);
    }
  });

  it("makePseudoPhaseFailure로 생성된 결과는 항상 isPseudoPhase=true이다", () => {
    const result = makePseudoPhaseFailure("review:code", 0, "err");
    expect(isPseudoPhase(result)).toBe(true);
  });
});

describe("nowIso", () => {
  it("ISO 8601 형식의 문자열을 반환한다", () => {
    const iso = nowIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("반환값이 현재 시각 기준 유효한 Date이다", () => {
    const before = Date.now();
    const iso = nowIso();
    const after = Date.now();
    const parsed = new Date(iso).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});
