import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCoreLoopFailure } from "../../src/pipeline/pipeline-error-handler.js";
import type { CoreLoopFailureContext } from "../../src/pipeline/pipeline-error-handler.js";

// Mock dependencies
vi.mock("../../src/pipeline/result-reporter.js", () => ({
  formatResult: vi.fn().mockReturnValue({ summary: "test report" }),
  printResult: vi.fn(),
}));

vi.mock("../../src/safety/rollback-manager.js", () => ({
  rollbackToCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/pipeline/pipeline-context.js", () => ({
  saveResult: vi.fn(),
}));

vi.mock("../../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("pipeline-error-handler", () => {
  let mockContext: CoreLoopFailureContext;
  let mockPatternStore: { add: any };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPatternStore = {
      add: vi.fn(),
    };

    mockContext = {
      issueNumber: 123,
      repo: "test/repo",
      coreResult: {
        success: false,
        plan: { phases: [] },
        phaseResults: [
          {
            phaseIndex: 0,
            phaseName: "test-phase",
            success: false,
            error: "Test error",
            errorCategory: "COMPILATION",
            durationMs: 1000,
          },
        ],
      },
      worktreePath: "/test/worktree",
      rollbackHash: "abc123",
      rollbackStrategy: "all",
      gitConfig: { gitPath: "git" },
      startTime: Date.now() - 5000,
      config: {} as any,
      aqRoot: "/test/aq",
      projectRoot: "/test/project",
      dataDir: "/test/data",
      patternStore: mockPatternStore as any,
      jl: {
        log: vi.fn(),
        setStep: vi.fn(),
      },
      checkpoint: vi.fn(),
    };
  });

  describe("handleCoreLoopFailure", () => {
    it("should handle core-loop failure with rollback", async () => {
      const result = await handleCoreLoopFailure(mockContext);

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(result.error).toBe("Phase execution failed. Rolled back to abc123 (strategy: all)");
      expect(result.report).toEqual({ summary: "test report" });
    });

    it("should record failure pattern", async () => {
      await handleCoreLoopFailure(mockContext);

      expect(mockContext.patternStore.add).toHaveBeenCalledWith({
        issueNumber: 123,
        repo: "test/repo",
        type: "failure",
        errorCategory: "COMPILATION",
        errorMessage: "Test error",
        phaseName: "test-phase",
        tags: [],
      });
    });

    it("should save checkpoint with plan and phase results", async () => {
      await handleCoreLoopFailure(mockContext);

      expect(mockContext.checkpoint).toHaveBeenCalledWith({
        state: "PLAN_GENERATED",
        plan: mockContext.coreResult.plan,
        phaseResults: mockContext.coreResult.phaseResults,
      });
    });

    it("should handle rollback strategy 'all'", async () => {
      const { rollbackToCheckpoint } = await import("../../src/safety/rollback-manager.js");

      await handleCoreLoopFailure(mockContext);

      expect(rollbackToCheckpoint).toHaveBeenCalledWith("abc123", {
        cwd: "/test/worktree",
        gitPath: "git",
      });
    });

    it("should handle rollback strategy 'failed-only'", async () => {
      const { rollbackToCheckpoint } = await import("../../src/safety/rollback-manager.js");

      mockContext.rollbackStrategy = "failed-only";
      mockContext.coreResult.phaseResults = [
        {
          phaseIndex: 0,
          phaseName: "success-phase",
          success: true,
          commitHash: "success123",
          durationMs: 1000,
        },
        {
          phaseIndex: 1,
          phaseName: "failed-phase",
          success: false,
          error: "Test error",
          durationMs: 1000,
        },
      ];

      await handleCoreLoopFailure(mockContext);

      expect(rollbackToCheckpoint).toHaveBeenCalledWith("success123", {
        cwd: "/test/worktree",
        gitPath: "git",
      });
    });

    it("should handle rollback strategy 'none'", async () => {
      const { rollbackToCheckpoint } = await import("../../src/safety/rollback-manager.js");

      mockContext.rollbackStrategy = "none";

      await handleCoreLoopFailure(mockContext);

      expect(rollbackToCheckpoint).not.toHaveBeenCalled();
    });

    it("should handle rollback failure gracefully", async () => {
      const { rollbackToCheckpoint } = await import("../../src/safety/rollback-manager.js");
      (rollbackToCheckpoint as any).mockRejectedValueOnce(new Error("Rollback failed"));

      // Create a local context copy to avoid affecting other tests
      const localContext = { ...mockContext, rollbackStrategy: "none" as const };

      const result = await handleCoreLoopFailure(localContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Phase execution failed");
    });

    it("should handle pattern store failure gracefully", async () => {
      mockContext.patternStore.add = vi.fn().mockImplementationOnce(() => {
        throw new Error("Pattern store error");
      });

      const result = await handleCoreLoopFailure(mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Phase execution failed");
    });
  });
});