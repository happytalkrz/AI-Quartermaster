import { describe, it, expect, vi } from "vitest";
import { evaluateRule, executeAction } from "../../src/automation/rule-engine.js";
import type {
  AutomationRule,
  RuleContext,
  RuleEngineHandlers,
} from "../../src/types/automation.js";
import type { GitHubIssue } from "../../src/github/issue-fetcher.js";

const baseIssue: GitHubIssue = {
  number: 1,
  title: "Fix login bug",
  body: "Users cannot log in with SSO",
  labels: ["bug"],
};

const baseContext: RuleContext = {
  triggerType: "issue-created",
  issue: baseIssue,
  repo: "org/repo",
};

const noopHandlers: RuleEngineHandlers = {
  addLabel: vi.fn().mockResolvedValue(undefined),
  startJob: vi.fn().mockResolvedValue(undefined),
  pauseProject: vi.fn().mockResolvedValue(undefined),
};

// ─── evaluateRule ─────────────────────────────────────────────────────────────

describe("evaluateRule", () => {
  describe("enabled flag", () => {
    it("returns false when enabled=false", () => {
      const rule: AutomationRule = {
        id: "r1",
        name: "disabled",
        enabled: false,
        trigger: { type: "issue-created" },
        actions: [{ type: "add-label", labels: ["auto"] }],
      };
      expect(evaluateRule(rule, baseContext)).toBe(false);
    });

    it("returns true when enabled is omitted (default=true)", () => {
      const rule: AutomationRule = {
        id: "r2",
        name: "default-enabled",
        trigger: { type: "issue-created" },
        actions: [{ type: "add-label", labels: ["auto"] }],
      };
      expect(evaluateRule(rule, baseContext)).toBe(true);
    });
  });

  describe("trigger matching", () => {
    it("issue-created matches issue-created context", () => {
      const rule: AutomationRule = {
        id: "r3",
        name: "on-create",
        trigger: { type: "issue-created" },
        actions: [],
      };
      expect(evaluateRule(rule, { ...baseContext, triggerType: "issue-created" })).toBe(true);
    });

    it("issue-created does not match issue-labeled context", () => {
      const rule: AutomationRule = {
        id: "r4",
        name: "on-create",
        trigger: { type: "issue-created" },
        actions: [],
      };
      expect(evaluateRule(rule, { ...baseContext, triggerType: "issue-labeled" })).toBe(false);
    });

    it("issue-labeled matches with any label when trigger.label is omitted", () => {
      const rule: AutomationRule = {
        id: "r5",
        name: "on-any-label",
        trigger: { type: "issue-labeled" },
        actions: [],
      };
      expect(
        evaluateRule(rule, { ...baseContext, triggerType: "issue-labeled", triggerLabel: "bug" })
      ).toBe(true);
    });

    it("issue-labeled only matches specified label", () => {
      const rule: AutomationRule = {
        id: "r6",
        name: "on-bug-label",
        trigger: { type: "issue-labeled", label: "bug" },
        actions: [],
      };
      const ctx: RuleContext = { ...baseContext, triggerType: "issue-labeled", triggerLabel: "bug" };
      expect(evaluateRule(rule, ctx)).toBe(true);

      const ctxOther: RuleContext = { ...baseContext, triggerType: "issue-labeled", triggerLabel: "feature" };
      expect(evaluateRule(rule, ctxOther)).toBe(false);
    });

    it("pipeline-failed matches with any repo when trigger.repo is omitted", () => {
      const rule: AutomationRule = {
        id: "r7",
        name: "on-fail",
        trigger: { type: "pipeline-failed" },
        actions: [],
      };
      expect(evaluateRule(rule, { ...baseContext, triggerType: "pipeline-failed" })).toBe(true);
    });

    it("pipeline-failed only matches specified repo", () => {
      const rule: AutomationRule = {
        id: "r8",
        name: "on-fail-specific",
        trigger: { type: "pipeline-failed", repo: "org/repo" },
        actions: [],
      };
      expect(evaluateRule(rule, { ...baseContext, triggerType: "pipeline-failed" })).toBe(true);
      expect(
        evaluateRule(rule, { ...baseContext, triggerType: "pipeline-failed", repo: "org/other" })
      ).toBe(false);
    });
  });

  describe("label-match condition", () => {
    const rule = (operator?: "and" | "or"): AutomationRule => ({
      id: "r9",
      name: "label-check",
      trigger: { type: "issue-created" },
      conditions: [{ type: "label-match", labels: ["bug", "urgent"], operator }],
      actions: [],
    });

    it("or: matches when at least one label is present (default)", () => {
      const ctx: RuleContext = { ...baseContext, issue: { ...baseIssue, labels: ["bug"] } };
      expect(evaluateRule(rule(), ctx)).toBe(true);
    });

    it("or: does not match when no label is present", () => {
      const ctx: RuleContext = { ...baseContext, issue: { ...baseIssue, labels: ["feature"] } };
      expect(evaluateRule(rule("or"), ctx)).toBe(false);
    });

    it("and: requires all labels to be present", () => {
      const ctxBoth: RuleContext = { ...baseContext, issue: { ...baseIssue, labels: ["bug", "urgent"] } };
      expect(evaluateRule(rule("and"), ctxBoth)).toBe(true);

      const ctxOne: RuleContext = { ...baseContext, issue: { ...baseIssue, labels: ["bug"] } };
      expect(evaluateRule(rule("and"), ctxOne)).toBe(false);
    });
  });

  describe("path-match condition", () => {
    const rule: AutomationRule = {
      id: "r10",
      name: "path-check",
      trigger: { type: "pipeline-failed" },
      conditions: [{ type: "path-match", patterns: ["src/**/*.ts"] }],
      actions: [],
    };

    it("matches when an affected path matches the pattern", () => {
      const ctx: RuleContext = {
        ...baseContext,
        triggerType: "pipeline-failed",
        affectedPaths: ["src/utils/helper.ts"],
      };
      expect(evaluateRule(rule, ctx)).toBe(true);
    });

    it("does not match when no affected path matches", () => {
      const ctx: RuleContext = {
        ...baseContext,
        triggerType: "pipeline-failed",
        affectedPaths: ["docs/readme.md"],
      };
      expect(evaluateRule(rule, ctx)).toBe(false);
    });

    it("returns false when affectedPaths is empty", () => {
      const ctx: RuleContext = { ...baseContext, triggerType: "pipeline-failed", affectedPaths: [] };
      expect(evaluateRule(rule, ctx)).toBe(false);
    });
  });

  describe("keyword-match condition", () => {
    const rule = (operator?: "and" | "or", fields?: Array<"title" | "body">): AutomationRule => ({
      id: "r11",
      name: "keyword-check",
      trigger: { type: "issue-created" },
      conditions: [{ type: "keyword-match", keywords: ["login", "sso"], operator, fields }],
      actions: [],
    });

    it("or: matches when any keyword found in title or body", () => {
      expect(evaluateRule(rule(), baseContext)).toBe(true); // "login" in title, "SSO" in body
    });

    it("and: requires all keywords to be present", () => {
      const ctx: RuleContext = {
        ...baseContext,
        issue: { ...baseIssue, title: "login issue", body: "sso broken" },
      };
      expect(evaluateRule(rule("and"), ctx)).toBe(true);

      const ctxMissing: RuleContext = {
        ...baseContext,
        issue: { ...baseIssue, title: "login issue", body: "no relevant info" },
      };
      expect(evaluateRule(rule("and"), ctxMissing)).toBe(false);
    });

    it("only checks title when fields=['title']", () => {
      const ctxTitleOnly: RuleContext = {
        ...baseContext,
        issue: { ...baseIssue, title: "login problem", body: "no keywords here" },
      };
      expect(evaluateRule(rule(undefined, ["title"]), ctxTitleOnly)).toBe(true);

      const ctxBodyOnly: RuleContext = {
        ...baseContext,
        issue: { ...baseIssue, title: "generic issue", body: "login problem" },
      };
      expect(evaluateRule(rule(undefined, ["title"]), ctxBodyOnly)).toBe(false);
    });
  });

  describe("multiple conditions (AND)", () => {
    it("all conditions must pass", () => {
      const rule: AutomationRule = {
        id: "r12",
        name: "multi-cond",
        trigger: { type: "issue-created" },
        conditions: [
          { type: "label-match", labels: ["bug"] },
          { type: "keyword-match", keywords: ["login"] },
        ],
        actions: [],
      };

      const ctxPass: RuleContext = {
        ...baseContext,
        issue: { ...baseIssue, labels: ["bug"], title: "login bug", body: "" },
      };
      expect(evaluateRule(rule, ctxPass)).toBe(true);

      const ctxFail: RuleContext = {
        ...baseContext,
        issue: { ...baseIssue, labels: ["feature"], title: "login issue", body: "" },
      };
      expect(evaluateRule(rule, ctxFail)).toBe(false);
    });
  });
});

// ─── executeAction ────────────────────────────────────────────────────────────

describe("executeAction", () => {
  it("add-label calls handlers.addLabel with correct args", async () => {
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn().mockResolvedValue(undefined),
      startJob: vi.fn(),
      pauseProject: vi.fn(),
    };
    await executeAction({ type: "add-label", labels: ["auto", "triaged"] }, baseContext, handlers);
    expect(handlers.addLabel).toHaveBeenCalledWith("org/repo", 1, ["auto", "triaged"]);
  });

  it("start-job uses action.repo when provided", async () => {
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn(),
      startJob: vi.fn().mockResolvedValue(undefined),
      pauseProject: vi.fn(),
    };
    await executeAction({ type: "start-job", repo: "org/other" }, baseContext, handlers);
    expect(handlers.startJob).toHaveBeenCalledWith("org/other", 1);
  });

  it("start-job falls back to context.repo when action.repo is omitted", async () => {
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn(),
      startJob: vi.fn().mockResolvedValue(undefined),
      pauseProject: vi.fn(),
    };
    await executeAction({ type: "start-job" }, baseContext, handlers);
    expect(handlers.startJob).toHaveBeenCalledWith("org/repo", 1);
  });

  it("pause-project calls handlers.pauseProject with reason", async () => {
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn(),
      startJob: vi.fn(),
      pauseProject: vi.fn().mockResolvedValue(undefined),
    };
    await executeAction({ type: "pause-project", reason: "rate limit" }, baseContext, handlers);
    expect(handlers.pauseProject).toHaveBeenCalledWith("org/repo", "rate limit");
  });

  it("pause-project works without reason", async () => {
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn(),
      startJob: vi.fn(),
      pauseProject: vi.fn().mockResolvedValue(undefined),
    };
    await executeAction({ type: "pause-project" }, baseContext, handlers);
    expect(handlers.pauseProject).toHaveBeenCalledWith("org/repo", undefined);
  });

  it("re-throws handler errors", async () => {
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn().mockRejectedValue(new Error("GitHub API error")),
      startJob: vi.fn(),
      pauseProject: vi.fn(),
    };
    await expect(
      executeAction({ type: "add-label", labels: ["fail"] }, baseContext, handlers)
    ).rejects.toThrow("GitHub API error");
  });

  it("unused handlers are not called", async () => {
    await executeAction({ type: "add-label", labels: ["x"] }, baseContext, noopHandlers);
    expect(noopHandlers.startJob).not.toHaveBeenCalled();
    expect(noopHandlers.pauseProject).not.toHaveBeenCalled();
  });
});
