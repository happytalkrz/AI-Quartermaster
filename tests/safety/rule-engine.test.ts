import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuleEngine } from "../../src/safety/rule-engine.js";
import { SafetyViolationError } from "../../src/types/errors.js";
import type { IssueRule, PlanRule, PushRule } from "../../src/types/safety.js";

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { getLogger } from "../../src/utils/logger.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
};

const baseIssueCtx = {
  checkpoint: "issue" as const,
  issue: {
    number: 1,
    title: "Test issue",
    body: "body",
    labels: ["bug"],
    assignee: null,
    state: "open" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  safetyConfig: {
    allowedLabels: ["bug"],
    sensitivePaths: [],
    maxPhases: 5,
    maxFileChanges: 100,
    maxInsertions: 1000,
    maxDeletions: 500,
    stopConditions: [],
    timeoutMs: 300000,
  },
};

const basePlanCtx = {
  checkpoint: "plan" as const,
  plan: {
    title: "Test plan",
    description: "desc",
    phases: [{ description: "p1", commands: [] }],
  },
  safetyConfig: baseIssueCtx.safetyConfig,
};

describe("RuleEngine", () => {
  let engine: RuleEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLogger).mockReturnValue(mockLogger as ReturnType<typeof getLogger>);
    engine = new RuleEngine();
  });

  describe("register", () => {
    it("returns this for method chaining", () => {
      const rule: IssueRule = {
        id: "test-rule",
        checkpoint: "issue",
        check: () => ({ passed: true }),
      };
      const result = engine.register(rule);
      expect(result).toBe(engine);
    });

    it("supports chaining multiple registers", () => {
      const ruleA: IssueRule = { id: "a", checkpoint: "issue", check: () => ({ passed: true }) };
      const ruleB: IssueRule = { id: "b", checkpoint: "issue", check: () => ({ passed: true }) };
      expect(() => engine.register(ruleA).register(ruleB)).not.toThrow();
    });
  });

  describe("run — checkpoint filtering", () => {
    it("only runs rules matching the given checkpoint", async () => {
      const issueCheck = vi.fn(() => ({ passed: true as const }));
      const planCheck = vi.fn(() => ({ passed: true as const }));

      const issueRule: IssueRule = { id: "issue-rule", checkpoint: "issue", check: issueCheck };
      const planRule: PlanRule = { id: "plan-rule", checkpoint: "plan", check: planCheck };

      engine.register(issueRule).register(planRule);

      await engine.run("issue", baseIssueCtx);

      expect(issueCheck).toHaveBeenCalledOnce();
      expect(planCheck).not.toHaveBeenCalled();
    });

    it("runs no rules when none match checkpoint", async () => {
      const planCheck = vi.fn(() => ({ passed: true as const }));
      const planRule: PlanRule = { id: "plan-rule", checkpoint: "plan", check: planCheck };

      engine.register(planRule);

      await engine.run("issue", baseIssueCtx);

      expect(planCheck).not.toHaveBeenCalled();
    });
  });

  describe("run — blocking rule", () => {
    it("does not throw when blocking rule passes", async () => {
      const rule: IssueRule = {
        id: "pass-rule",
        checkpoint: "issue",
        check: () => ({ passed: true }),
      };
      engine.register(rule);

      await expect(engine.run("issue", baseIssueCtx)).resolves.toBeUndefined();
    });

    it("throws SafetyViolationError when blocking rule fails", async () => {
      const rule: IssueRule = {
        id: "fail-rule",
        checkpoint: "issue",
        check: () => ({ passed: false, message: "rule failed" }),
      };
      engine.register(rule);

      await expect(engine.run("issue", baseIssueCtx)).rejects.toThrow(SafetyViolationError);
    });

    it("sets correct guard id and message on thrown error", async () => {
      const rule: IssueRule = {
        id: "my-rule",
        checkpoint: "issue",
        check: () => ({ passed: false, message: "something went wrong" }),
      };
      engine.register(rule);

      const err = await engine.run("issue", baseIssueCtx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SafetyViolationError);
      const violation = err as SafetyViolationError;
      expect(violation.guard).toBe("my-rule");
      expect(violation.message).toContain("something went wrong");
    });

    it("includes details in thrown error when provided", async () => {
      const rule: IssueRule = {
        id: "detail-rule",
        checkpoint: "issue",
        check: () => ({ passed: false, message: "err", details: { count: 3 } }),
      };
      engine.register(rule);

      const err = await engine.run("issue", baseIssueCtx).catch((e: unknown) => e);
      const violation = err as SafetyViolationError;
      expect(violation.details).toEqual({ count: 3 });
    });

    it("stops executing after first blocking failure", async () => {
      const secondCheck = vi.fn(() => ({ passed: true as const }));
      const firstRule: IssueRule = {
        id: "first",
        checkpoint: "issue",
        check: () => ({ passed: false, message: "first fails" }),
      };
      const secondRule: IssueRule = { id: "second", checkpoint: "issue", check: secondCheck };

      engine.register(firstRule).register(secondRule);

      await expect(engine.run("issue", baseIssueCtx)).rejects.toThrow(SafetyViolationError);
      expect(secondCheck).not.toHaveBeenCalled();
    });
  });

  describe("run — warn-only rule", () => {
    it("does not throw when warn-only rule fails", async () => {
      const rule: IssueRule = {
        id: "warn-rule",
        checkpoint: "issue",
        check: () => ({ passed: false, message: "just a warning" }),
      };
      engine.register(rule, { warnOnly: true });

      await expect(engine.run("issue", baseIssueCtx)).resolves.toBeUndefined();
    });

    it("logs warning when warn-only rule fails", async () => {
      const rule: IssueRule = {
        id: "warn-rule",
        checkpoint: "issue",
        check: () => ({ passed: false, message: "just a warning" }),
      };
      engine.register(rule, { warnOnly: true });

      await engine.run("issue", baseIssueCtx);

      expect(mockLogger.warn).toHaveBeenCalledOnce();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("warn-rule")
      );
    });

    it("continues running subsequent rules after warn-only failure", async () => {
      const thirdCheck = vi.fn(() => ({ passed: true as const }));
      const warnRule: IssueRule = {
        id: "warn-rule",
        checkpoint: "issue",
        check: () => ({ passed: false, message: "warn" }),
      };
      const thirdRule: IssueRule = { id: "third", checkpoint: "issue", check: thirdCheck };

      engine.register(warnRule, { warnOnly: true }).register(thirdRule);

      await engine.run("issue", baseIssueCtx);

      expect(thirdCheck).toHaveBeenCalledOnce();
    });

    it("does not log warning when warn-only rule passes", async () => {
      const rule: IssueRule = {
        id: "warn-pass",
        checkpoint: "issue",
        check: () => ({ passed: true }),
      };
      engine.register(rule, { warnOnly: true });

      await engine.run("issue", baseIssueCtx);

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("run — async rules", () => {
    it("supports async check returning passed", async () => {
      const rule: IssueRule = {
        id: "async-pass",
        checkpoint: "issue",
        check: async () => ({ passed: true }),
      };
      engine.register(rule);

      await expect(engine.run("issue", baseIssueCtx)).resolves.toBeUndefined();
    });

    it("supports async check returning failed", async () => {
      const rule: IssueRule = {
        id: "async-fail",
        checkpoint: "issue",
        check: async () => ({ passed: false, message: "async fail" }),
      };
      engine.register(rule);

      await expect(engine.run("issue", baseIssueCtx)).rejects.toThrow(SafetyViolationError);
    });
  });

  describe("run — unexpected errors", () => {
    it("propagates non-SafetyViolationError thrown from check", async () => {
      const rule: IssueRule = {
        id: "error-rule",
        checkpoint: "issue",
        check: () => { throw new Error("unexpected"); },
      };
      engine.register(rule);

      await expect(engine.run("issue", baseIssueCtx)).rejects.toThrow("unexpected");
    });

    it("propagates rejected promise from async check", async () => {
      const rule: IssueRule = {
        id: "async-error",
        checkpoint: "issue",
        check: async () => { throw new Error("async unexpected"); },
      };
      engine.register(rule);

      await expect(engine.run("issue", baseIssueCtx)).rejects.toThrow("async unexpected");
    });
  });

  describe("run — plan checkpoint", () => {
    it("passes plan context to check", async () => {
      const planCheck = vi.fn(() => ({ passed: true as const }));
      const rule: PlanRule = { id: "plan-check", checkpoint: "plan", check: planCheck };

      engine.register(rule);
      await engine.run("plan", basePlanCtx);

      expect(planCheck).toHaveBeenCalledWith(basePlanCtx);
    });
  });
});
