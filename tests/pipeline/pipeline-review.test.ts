import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../src/claude/model-router.js", () => ({
  configForTask: vi.fn(),
  configForTaskWithMode: vi.fn(),
}));
vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
}));
vi.mock("../../src/git/diff-collector.js", () => ({
  getDiffContent: vi.fn(),
}));
vi.mock("../../src/review/review-orchestrator.js", () => ({
  runReviews: vi.fn(),
}));
vi.mock("../../src/review/analyst-runner.js", () => ({
  runAnalyst: vi.fn(),
}));
vi.mock("../../src/review/simplify-runner.js", () => ({
  runSimplify: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

import {
  runReviewPhase,
  runSimplifyPhase,
  buildReviewVars,
  type ReviewContext,
  type SimplifyContext,
} from "../../src/pipeline/phases/pipeline-review.js";
import type { ExecutionModePreset } from "../../src/types/config.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { configForTask, configForTaskWithMode } from "../../src/claude/model-router.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";
import { getDiffContent } from "../../src/git/diff-collector.js";
import { runReviews } from "../../src/review/review-orchestrator.js";
import { runAnalyst } from "../../src/review/analyst-runner.js";
import { runSimplify } from "../../src/review/simplify-runner.js";
import { existsSync } from "fs";
import type { ReviewPipelineResult, AnalystResult } from "../../src/types/review.js";

const mockRunClaude = vi.mocked(runClaude);
const mockConfigForTask = vi.mocked(configForTask);
const mockConfigForTaskWithMode = vi.mocked(configForTaskWithMode);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockGetDiffContent = vi.mocked(getDiffContent);
const mockRunReviews = vi.mocked(runReviews);
const mockRunAnalyst = vi.mocked(runAnalyst);
const mockRunSimplify = vi.mocked(runSimplify);
const mockExistsSync = vi.mocked(existsSync);

function makeExecutionModePreset(overrides: Partial<ExecutionModePreset> = {}): ExecutionModePreset {
  return {
    reviewRounds: 1,
    enableAdvancedReview: false,
    enableSimplify: true,
    enableFinalValidation: true,
    maxPhases: 5,
    maxRetries: 3,
    ...overrides,
  };
}

function makeReviewContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    issue: { number: 42, title: "Test issue", body: "Test body", labels: [] },
    coreResult: {
      plan: { problemDefinition: "Test problem" },
      phaseResults: [],
    },
    gitConfig: { gitPath: "/usr/bin/git" },
    project: {
      commands: {
        test: "npm test",
        lint: "npm run lint",
        claudeCli: { path: "claude", model: "sonnet" },
      },
      baseBranch: "main",
      review: {
        rounds: [{ name: "basic", promptTemplate: "basic-review.md", adversarial: false, blind: false }],
        maxRetries: 3,
        simplify: { enabled: true, promptTemplate: "simplify.md" },
      },
      safety: { maxRetries: 3 },
    },
    worktreePath: "/tmp/worktree",
    promptsDir: "/tmp/prompts",
    skillsContext: "skills context",
    jl: {
      setStep: vi.fn(),
      setProgress: vi.fn(),
      log: vi.fn(),
    },
    timer: { assertNotExpired: vi.fn() },
    checkpoint: vi.fn(),
    ...overrides,
  };
}

function makeSimplifyContext(overrides: Partial<SimplifyContext> = {}): SimplifyContext {
  return {
    project: {
      commands: {
        test: "npm test",
        claudeCli: { path: "claude", model: "sonnet" },
      },
      review: {
        rounds: [],
        simplify: { enabled: true, promptTemplate: "simplify.md" },
      },
    },
    worktreePath: "/tmp/worktree",
    promptsDir: "/tmp/prompts",
    reviewVariables: {
      issue: { number: "42", title: "Test", body: "body" },
      plan: { summary: "test summary" },
      diff: { full: "diff content" },
      config: { testCommand: "npm test", lintCommand: "npm run lint" },
      skillsContext: "skills",
    },
    gitConfig: { gitPath: "/usr/bin/git" },
    jl: {
      setStep: vi.fn(),
      setProgress: vi.fn(),
      log: vi.fn(),
    },
    timer: { assertNotExpired: vi.fn() },
    checkpoint: vi.fn(),
    ...overrides,
  };
}

const mockIsPastState = vi.fn();

describe("pipeline-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDiffContent.mockResolvedValue("test diff content");
    mockExistsSync.mockReturnValue(true);
    mockConfigForTask.mockReturnValue({ path: "claude", model: "sonnet" });
    mockConfigForTaskWithMode.mockReturnValue({ path: "claude", model: "sonnet" });
    mockIsPastState.mockReturnValue(false);
    mockRunSimplify.mockResolvedValue({
      applied: true,
      linesRemoved: 5,
      linesAdded: 3,
      filesModified: ["src/foo.ts"],
      testsPassed: true,
      rolledBack: false,
      summary: "Simplified 1 file",
    });
  });

  describe("buildReviewVars", () => {
    it("should build review variables correctly", async () => {
      const ctx = makeReviewContext();

      const result = await buildReviewVars(ctx);

      expect(result).toEqual({
        issue: {
          number: "42",
          title: "Test issue",
          body: "Test body",
        },
        plan: { summary: "Test problem" },
        diff: { full: "test diff content" },
        config: {
          testCommand: "npm test",
          lintCommand: "npm run lint",
        },
        skillsContext: "skills context",
      });
      expect(mockGetDiffContent).toHaveBeenCalledWith(
        { gitPath: "/usr/bin/git" },
        "main",
        { cwd: "/tmp/worktree" }
      );
    });

    it("should throw error if test command not configured", async () => {
      const ctx = makeReviewContext({
        project: {
          ...makeReviewContext().project,
          commands: {
            ...makeReviewContext().project.commands!,
            test: undefined,
          },
        },
      });

      await expect(buildReviewVars(ctx)).rejects.toThrow("Project test command not configured");
    });

    it("should throw error if lint command not configured", async () => {
      const ctx = makeReviewContext({
        project: {
          ...makeReviewContext().project,
          commands: {
            ...makeReviewContext().project.commands!,
            lint: undefined,
          },
        },
      });

      await expect(buildReviewVars(ctx)).rejects.toThrow("Project lint command not configured");
    });

    it("should throw error if base branch not configured", async () => {
      const ctx = makeReviewContext({
        project: {
          ...makeReviewContext().project,
          baseBranch: undefined,
        },
      });

      await expect(buildReviewVars(ctx)).rejects.toThrow("Project base branch not configured");
    });
  });

  describe("runReviewPhase", () => {
    it("should skip review when reviewRounds is 0", async () => {
      const ctx = makeReviewContext();
      const result = await runReviewPhase(ctx, makeExecutionModePreset({ reviewRounds: 0 }), "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunReviews).not.toHaveBeenCalled();
    });

    it("should skip review when past state", async () => {
      const ctx = makeReviewContext();
      mockIsPastState.mockReturnValue(true);

      const result = await runReviewPhase(ctx, makeExecutionModePreset({ reviewRounds: 1 }), "REVIEWING", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunReviews).not.toHaveBeenCalled();
    });

    it("should run successful review without analyst", async () => {
      const ctx = makeReviewContext();
      mockExistsSync.mockReturnValue(false); // No analyst template

      const mockReviewResult: ReviewPipelineResult = {
        rounds: [
          {
            roundName: "basic",
            verdict: "PASS",
            findings: [],
            summary: "All good",
            durationMs: 1000,
          },
        ],
        allPassed: true,
      };
      mockRunReviews.mockResolvedValue(mockReviewResult);

      const result = await runReviewPhase(ctx, makeExecutionModePreset({ reviewRounds: 1 }), "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(true);
      expect(result.reviewResult).toEqual(mockReviewResult);
      expect(result.reviewVariables).toEqual({
        issue: { number: "42", title: "Test issue", body: "Test body" },
        plan: { summary: "Test problem" },
        diff: { full: "test diff content" },
        config: { testCommand: "npm test", lintCommand: "npm run lint" },
        skillsContext: "skills context",
      });
      expect(mockRunReviews).toHaveBeenCalledWith({
        reviewConfig: ctx.project.review,
        claudeConfig: { path: "claude", model: "sonnet" },
        promptsDir: "/tmp/prompts",
        cwd: "/tmp/worktree",
        variables: expect.objectContaining({ issue: expect.objectContaining({ number: "42" }) }),
        maxRounds: 1,
        executionMode: "standard",
      });
      expect(mockRunAnalyst).not.toHaveBeenCalled();
      expect(ctx.checkpoint).toHaveBeenCalledWith({
        plan: ctx.coreResult.plan,
        phaseResults: ctx.coreResult.phaseResults,
      });
    });

    it("should run successful review with analyst", async () => {
      const ctx = makeReviewContext();

      const mockAnalystResult: AnalystResult = {
        verdict: "COMPLETE",
        findings: [],
        summary: "Requirements met",
        coverage: { implemented: ["feature"], missing: [], excess: [] },
        durationMs: 800,
      };
      mockRunAnalyst.mockResolvedValue(mockAnalystResult);

      const mockReviewResult: ReviewPipelineResult = {
        rounds: [
          {
            roundName: "basic",
            verdict: "PASS",
            findings: [],
            summary: "All good",
            durationMs: 1000,
          },
        ],
        allPassed: true,
      };
      mockRunReviews.mockResolvedValue(mockReviewResult);

      const result = await runReviewPhase(ctx, makeExecutionModePreset({ reviewRounds: 1 }), "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(true);
      expect(result.reviewResult?.analyst).toEqual(mockAnalystResult);
      expect(mockRunAnalyst).toHaveBeenCalledWith({
        promptsDir: "/tmp/prompts",
        claudeConfig: { path: "claude", model: "sonnet" },
        cwd: "/tmp/worktree",
        variables: expect.objectContaining({ issue: expect.objectContaining({ number: "42" }) }),
      });
      expect(mockRunReviews).toHaveBeenCalledWith({
        reviewConfig: ctx.project.review,
        claudeConfig: { path: "claude", model: "sonnet" },
        promptsDir: "/tmp/prompts",
        cwd: "/tmp/worktree",
        variables: expect.objectContaining({ issue: expect.objectContaining({ number: "42" }) }),
        maxRounds: 1,
        executionMode: "standard",
      });
    });

    it("should retry and succeed on review failure", async () => {
      const ctx = makeReviewContext();
      mockExistsSync.mockReturnValue(false); // No analyst template

      // First review fails
      mockRunReviews
        .mockResolvedValueOnce({
          rounds: [
            {
              roundName: "basic",
              verdict: "FAIL",
              findings: [{ severity: "error", message: "Logic error", file: "src/test.ts", line: 10 }],
              summary: "Has errors",
              durationMs: 1000,
            },
          ],
          allPassed: false,
        })
        // Second review (after fix) passes
        .mockResolvedValueOnce({
          rounds: [
            {
              roundName: "basic",
              verdict: "PASS",
              findings: [],
              summary: "Fixed",
              durationMs: 800,
            },
          ],
          allPassed: true,
        });

      const result = await runReviewPhase(ctx, makeExecutionModePreset({ reviewRounds: 1 }), "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(true);
      expect(result.reviewResult?.rounds[0].verdict).toBe("PASS");
      expect(result.reviewResult?.allPassed).toBe(true);
      expect(mockRunClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Logic error"),
        })
      );
      expect(mockAutoCommitIfDirty).toHaveBeenCalledWith(
        "/usr/bin/git",
        "/tmp/worktree",
        "fix: review 오류 수정 (retry 1)"
      );
      expect(mockRunReviews).toHaveBeenCalledTimes(2);
      expect(mockRunReviews).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ cwd: "/tmp/worktree", promptsDir: "/tmp/prompts" })
      );
      expect(mockRunReviews).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ cwd: "/tmp/worktree", promptsDir: "/tmp/prompts" })
      );
    });

    it("should fail after max retries exhausted", async () => {
      const ctx = makeReviewContext({
        project: {
          ...makeReviewContext().project,
          safety: { maxRetries: 2 },
        },
      });
      mockExistsSync.mockReturnValue(false); // No analyst template

      // All reviews fail
      mockRunReviews.mockResolvedValue({
        rounds: [
          {
            roundName: "basic",
            verdict: "FAIL",
            findings: [{ severity: "error", message: "Persistent error", file: "src/bad.ts", line: 1 }],
            summary: "Always failing",
            durationMs: 1000,
          },
        ],
        allPassed: false,
      });

      const result = await runReviewPhase(ctx, makeExecutionModePreset({ reviewRounds: 1 }), "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Review failed after 2 retries");
      expect(result.error).toContain("Persistent error");
      expect(result.reviewResult?.allPassed).toBe(false);
      expect(mockRunReviews).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockAutoCommitIfDirty).toHaveBeenCalledTimes(2);
      expect(mockAutoCommitIfDirty).toHaveBeenNthCalledWith(1, "/usr/bin/git", "/tmp/worktree", "fix: review 오류 수정 (retry 1)");
      expect(mockAutoCommitIfDirty).toHaveBeenNthCalledWith(2, "/usr/bin/git", "/tmp/worktree", "fix: review 오류 수정 (retry 2)");
    });

    it("should handle critical analyst issues in retry", async () => {
      const ctx = makeReviewContext();

      const criticalAnalystResult: AnalystResult = {
        verdict: "INCOMPLETE",
        findings: [
          {
            type: "missing",
            requirement: "Error handling",
            severity: "error",
            message: "Missing error handling",
            suggestion: "Add try-catch",
          },
        ],
        summary: "Missing requirements",
        coverage: { implemented: [], missing: ["Error handling"], excess: [] },
        durationMs: 800,
      };
      mockRunAnalyst.mockResolvedValue(criticalAnalystResult);

      mockRunReviews.mockResolvedValue({
        rounds: [
          {
            roundName: "basic",
            verdict: "FAIL",
            findings: [{ severity: "error", message: "Type error", file: "src/types.ts", line: 20 }],
            summary: "Type issues",
            durationMs: 1000,
          },
        ],
        allPassed: false,
      });

      const result = await runReviewPhase(ctx, makeExecutionModePreset({ reviewRounds: 1 }), "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(false);
      expect(mockRunClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Missing error handling"),
        })
      );
    });
  });

  describe("runSimplifyPhase", () => {
    it("should skip simplify when skipSimplify is true", async () => {
      const ctx = makeSimplifyContext();
      const result = await runSimplifyPhase(ctx, makeExecutionModePreset({ enableSimplify: false }), "REVIEWING", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunSimplify).not.toHaveBeenCalled();
    });

    it("should skip simplify when simplify not enabled", async () => {
      const ctx = makeSimplifyContext({
        project: {
          ...makeSimplifyContext().project,
          review: {
            ...makeSimplifyContext().project.review!,
            simplify: { enabled: false, promptTemplate: "simplify.md" },
          },
        },
      });

      const result = await runSimplifyPhase(ctx, makeExecutionModePreset({ enableSimplify: true }), "REVIEWING", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunSimplify).not.toHaveBeenCalled();
    });

    it("should skip simplify when past state", async () => {
      const ctx = makeSimplifyContext();
      mockIsPastState.mockReturnValue(true);

      const result = await runSimplifyPhase(ctx, makeExecutionModePreset({ enableSimplify: true }), "SIMPLIFYING", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunSimplify).not.toHaveBeenCalled();
    });

    it("should run successful simplify", async () => {
      const ctx = makeSimplifyContext();

      const result = await runSimplifyPhase(ctx, makeExecutionModePreset({ enableSimplify: true }), "REVIEWING", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunSimplify).toHaveBeenCalledWith({
        promptTemplate: "simplify.md",
        promptsDir: "/tmp/prompts",
        claudeConfig: { path: "claude", model: "sonnet" },
        cwd: "/tmp/worktree",
        testCommand: "npm test",
        variables: ctx.reviewVariables,
        gitPath: "/usr/bin/git",
      });
      expect(mockRunSimplify).toHaveBeenCalledTimes(1);
      expect(ctx.checkpoint).toHaveBeenCalledTimes(1);
      expect(ctx.checkpoint).toHaveBeenCalledWith();
    });

    it("should throw error if simplify prompt template not configured", async () => {
      const ctx = makeSimplifyContext({
        project: {
          ...makeSimplifyContext().project,
          review: {
            ...makeSimplifyContext().project.review!,
            simplify: { enabled: true, promptTemplate: undefined as string },
          },
        },
      });

      await expect(
        runSimplifyPhase(ctx, makeExecutionModePreset({ enableSimplify: true }), "REVIEWING", mockIsPastState)
      ).rejects.toThrow("Simplify prompt template not configured");
    });

    it("should throw error if claude CLI not configured", async () => {
      const ctx = makeSimplifyContext({
        project: {
          ...makeSimplifyContext().project,
          commands: {
            ...makeSimplifyContext().project.commands!,
            claudeCli: undefined,
          },
        },
      });

      await expect(
        runSimplifyPhase(ctx, makeExecutionModePreset({ enableSimplify: true }), "REVIEWING", mockIsPastState)
      ).rejects.toThrow("Claude CLI configuration not found");
    });

    it("should throw error if test command not configured", async () => {
      const ctx = makeSimplifyContext({
        project: {
          ...makeSimplifyContext().project,
          commands: {
            ...makeSimplifyContext().project.commands!,
            test: undefined,
          },
        },
      });

      await expect(
        runSimplifyPhase(ctx, makeExecutionModePreset({ enableSimplify: true }), "REVIEWING", mockIsPastState)
      ).rejects.toThrow("Test command not configured");
    });
  });

  describe("execution mode integration", () => {
    it("should skip review in economy mode (reviewRounds: 0)", async () => {
      const ctx = makeReviewContext();
      const economyPreset = makeExecutionModePreset({
        reviewRounds: 0,
        enableAdvancedReview: false,
        enableSimplify: false
      });

      const result = await runReviewPhase(ctx, economyPreset, "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunReviews).not.toHaveBeenCalled();
      expect(mockRunAnalyst).not.toHaveBeenCalled();
    });

    it("should run standard review in standard mode (reviewRounds: 1)", async () => {
      const ctx = makeReviewContext();
      mockExistsSync.mockReturnValue(false); // No analyst template

      const standardPreset = makeExecutionModePreset({
        reviewRounds: 1,
        enableAdvancedReview: true,
        enableSimplify: true
      });

      const mockReviewResult = {
        rounds: [{ roundName: "basic", verdict: "PASS", findings: [], summary: "Good", durationMs: 1000 }],
        allPassed: true,
      };
      mockRunReviews.mockResolvedValue(mockReviewResult);

      const result = await runReviewPhase(ctx, standardPreset, "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunReviews).toHaveBeenCalledWith(expect.objectContaining({
        maxRounds: 1
      }));
    });

    it("should run thorough review in thorough mode (reviewRounds: 3)", async () => {
      const ctx = makeReviewContext();
      mockExistsSync.mockReturnValue(false); // No analyst template

      const thoroughPreset = makeExecutionModePreset({
        reviewRounds: 3,
        enableAdvancedReview: true,
        enableSimplify: true,
        maxRetries: 3
      });

      const mockReviewResult = {
        rounds: [
          { roundName: "basic", verdict: "PASS", findings: [], summary: "Good", durationMs: 1000 },
          { roundName: "security", verdict: "PASS", findings: [], summary: "Secure", durationMs: 1200 },
          { roundName: "performance", verdict: "PASS", findings: [], summary: "Fast", durationMs: 800 }
        ],
        allPassed: true,
      };
      mockRunReviews.mockResolvedValue(mockReviewResult);

      const result = await runReviewPhase(ctx, thoroughPreset, "PLAN_GENERATED", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunReviews).toHaveBeenCalledWith(expect.objectContaining({
        maxRounds: 3
      }));
    });

    it("should skip simplify in economy mode (enableSimplify: false)", async () => {
      const ctx = makeSimplifyContext();
      const economyPreset = makeExecutionModePreset({
        enableSimplify: false
      });

      const result = await runSimplifyPhase(ctx, economyPreset, "REVIEWING", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunSimplify).not.toHaveBeenCalled();
    });

    it("should run simplify in thorough mode (enableSimplify: true)", async () => {
      const ctx = makeSimplifyContext();
      const thoroughPreset = makeExecutionModePreset({
        enableSimplify: true
      });

      const result = await runSimplifyPhase(ctx, thoroughPreset, "REVIEWING", mockIsPastState);

      expect(result.success).toBe(true);
      expect(mockRunSimplify).toHaveBeenCalledWith(expect.objectContaining({
        promptTemplate: "simplify.md",
        cwd: "/tmp/worktree"
      }));
    });
  });
});