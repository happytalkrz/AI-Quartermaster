import { describe, it, expect, vi } from "vitest";
import {
  initializePipelineState,
  transitionState,
  isPastState,
  STATE_ORDER,
  type PipelineRuntime,
  type OrchestratorInput,
} from "../../src/pipeline/pipeline-context.js";
import type { AQConfig } from "../../src/types/config.js";
import type { PipelineState } from "../../src/types/pipeline.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("pipeline-context", () => {
  const mockConfig: AQConfig = {
    git: {
      gitPath: "git",
      userName: "test",
      userEmail: "test@example.com",
    },
  } as AQConfig;

  describe("initializePipelineState", () => {
    it("should initialize state from scratch", async () => {
      const input: OrchestratorInput = {
        issueNumber: 123,
        repo: "owner/repo",
        config: mockConfig,
        projectRoot: "/test/project",
      };

      const runtime = await initializePipelineState(input, mockConfig);

      expect(runtime.state).toBe("RECEIVED");
      expect(runtime.projectRoot).toBe("/test/project");
      expect(runtime.promptsDir).toBe("/test/project/prompts");
      expect(runtime.rollbackStrategy).toBe("none");
      expect(runtime.gitConfig).toBe(mockConfig.git);
    });

    it("should resume from checkpoint", async () => {
      const input: OrchestratorInput = {
        issueNumber: 123,
        repo: "owner/repo",
        config: mockConfig,
        resumeFrom: {
          state: "VALIDATED",
          worktreePath: "/test/worktree",
          branchName: "feature-branch",
          projectRoot: "/test/project",
          plan: undefined,
          phaseResults: undefined,
        },
      };

      const runtime = await initializePipelineState(input, mockConfig);

      expect(runtime.state).toBe("VALIDATED");
      expect(runtime.worktreePath).toBe("/test/worktree");
      expect(runtime.branchName).toBe("feature-branch");
      expect(runtime.projectRoot).toBe("/test/project");
    });
  });

  describe("transitionState", () => {
    let runtime: PipelineRuntime;

    beforeEach(() => {
      runtime = {
        state: "RECEIVED",
        projectRoot: "/test",
        gitConfig: mockConfig.git,
        promptsDir: "/test/prompts",
        rollbackStrategy: "none",
      };
    });

    it("should transition state", () => {
      transitionState(runtime, "VALIDATED");

      expect(runtime.state).toBe("VALIDATED");
    });

    it("should update context during transition", () => {
      transitionState(runtime, "WORKTREE_CREATED", {
        worktreePath: "/new/worktree",
        branchName: "new-branch",
        rollbackHash: "abc123",
        rollbackStrategy: "all",
      });

      expect(runtime.state).toBe("WORKTREE_CREATED");
      expect(runtime.worktreePath).toBe("/new/worktree");
      expect(runtime.branchName).toBe("new-branch");
      expect(runtime.rollbackHash).toBe("abc123");
      expect(runtime.rollbackStrategy).toBe("all");
    });

    it("should update projectRoot and promptsDir", () => {
      transitionState(runtime, "VALIDATED", {
        projectRoot: "/new/project",
      });

      expect(runtime.projectRoot).toBe("/new/project");
      expect(runtime.promptsDir).toBe("/new/project/prompts");
    });
  });

  describe("isPastState", () => {
    it("should return true if checkpoint state is past current", () => {
      expect(isPastState("VALIDATED", "RECEIVED")).toBe(true);
      expect(isPastState("DONE", "REVIEWING")).toBe(true);
    });

    it("should return false if checkpoint state is not past current", () => {
      expect(isPastState("RECEIVED", "VALIDATED")).toBe(false);
      expect(isPastState("REVIEWING", "DONE")).toBe(false);
    });

    it("should return false for unknown states", () => {
      expect(isPastState("FAILED" as PipelineState, "RECEIVED")).toBe(false);
      expect(isPastState("RECEIVED", "UNKNOWN" as PipelineState)).toBe(false);
    });

    it("should return false for same states", () => {
      expect(isPastState("VALIDATED", "VALIDATED")).toBe(false);
    });
  });

  describe("STATE_ORDER", () => {
    it("should have correct order", () => {
      expect(STATE_ORDER).toEqual([
        "RECEIVED",
        "VALIDATED",
        "BASE_SYNCED",
        "BRANCH_CREATED",
        "WORKTREE_CREATED",
        "PLAN_GENERATED",
        "REVIEWING",
        "SIMPLIFYING",
        "FINAL_VALIDATING",
        "DRAFT_PR_CREATED",
        "DONE",
      ]);
    });
  });
});