import { describe, it, expect } from "vitest";
import { checkPhaseLimit } from "../../src/safety/phase-limit-guard.js";

describe("checkPhaseLimit", () => {
  it("should pass when phase count is within limit", () => {
    expect(() => checkPhaseLimit(5, 10)).not.toThrow();
    expect(() => checkPhaseLimit(1, 5)).not.toThrow();
    expect(() => checkPhaseLimit(0, 1)).not.toThrow();
  });

  it("should pass when phase count equals maximum", () => {
    expect(() => checkPhaseLimit(5, 5)).not.toThrow();
    expect(() => checkPhaseLimit(1, 1)).not.toThrow();
  });

  it("should throw SafetyViolationError when phase count exceeds maximum", () => {
    expect(() => checkPhaseLimit(6, 5)).toThrow("PhaseLimitGuard");
    expect(() => checkPhaseLimit(11, 10)).toThrow("PhaseLimitGuard");
  });

  it("should include phase count and max phases in error message", () => {
    try {
      checkPhaseLimit(8, 5);
    } catch (e: any) {
      expect(e.message).toContain("8 phases");
      expect(e.message).toContain("maximum of 5");
      expect(e.details.phaseCount).toBe(8);
      expect(e.details.maxPhases).toBe(5);
    }
  });

  it("should handle edge case with zero maximum", () => {
    expect(() => checkPhaseLimit(0, 0)).not.toThrow();
    expect(() => checkPhaseLimit(1, 0)).toThrow("PhaseLimitGuard");
  });
});