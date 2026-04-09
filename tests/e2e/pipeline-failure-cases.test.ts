import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/safety/rollback-manager.js", () => ({
  createCheckpoint: vi.fn(),
  rollbackToCheckpoint: vi.fn(),
  ensureCleanState: vi.fn(),
}));
vi.mock("../../src/pipeline/checkpoint.js", () => ({
  saveCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(),
  removeCheckpoint: vi.fn(),
}));
vi.mock("../../src/git/repo-lock.js", () => ({
  withRepoLock: vi.fn((_repo: string, fn: () => Promise<void>) => fn()),
}));
vi.mock("../../src/github/issue-fetcher.js", () => ({
  fetchIssue: vi.fn(),
}));
vi.mock("../../src/github/pr-creator.js", () => ({
  createDraftPR: vi.fn(),
  enableAutoMerge: vi.fn(),
  addIssueComment: vi.fn(),
  closeIssue: vi.fn(),
}));
vi.mock("../../src/git/branch-manager.js", () => ({
  syncBaseBranch: vi.fn(),
  createWorkBranch: vi.fn(),
  pushBranch: vi.fn(),
  checkConflicts: vi.fn(),
  attemptRebase: vi.fn(),
}));
vi.mock("../../src/git/worktree-manager.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));
vi.mock("../../src/pipeline/core-loop.js", () => ({
  runCoreLoop: vi.fn(),
}));
vi.mock("../../src/pipeline/dependency-installer.js", () => ({
  installDependencies: vi.fn(),
}));
vi.mock("../../src/pipeline/final-validator.js", () => ({
  runFinalValidation: vi.fn(),
}));
vi.mock("../../src/review/review-orchestrator.js", () => ({
  runReviews: vi.fn(),
}));
vi.mock("../../src/review/simplify-runner.js", () => ({
  runSimplify: vi.fn(),
}));
vi.mock("../../src/safety/safety-checker.js", () => ({
  validateIssue: vi.fn(),
  validatePlan: vi.fn(),
  validateBeforePush: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/pipeline/pipeline-context.js", async () => {
  const actual = await vi.importActual("../../src/pipeline/pipeline-context.js");
  return {
    ...actual,
    transitionState: vi.fn(),
    initializePipelineState: vi.fn(),
  };
});

import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { fetchIssue } from "../../src/github/issue-fetcher.js";
import { closeIssue } from "../../src/github/pr-creator.js";
import { runCoreLoop } from "../../src/pipeline/core-loop.js";
import { runReviews } from "../../src/review/review-orchestrator.js";
import { runSimplify } from "../../src/review/simplify-runner.js";
import { runFinalValidation } from "../../src/pipeline/final-validator.js";
import { validateIssue, validatePlan, validateBeforePush } from "../../src/safety/safety-checker.js";
import { transitionState, initializePipelineState } from "../../src/pipeline/pipeline-context.js";
import { rollbackToCheckpoint } from "../../src/safety/rollback-manager.js";
import { createWorkBranch } from "../../src/git/branch-manager.js";
import { createWorktree } from "../../src/git/worktree-manager.js";
import { runCli } from "../../src/utils/cli-runner.js";
import type { PipelineState } from "../../src/types/pipeline.js";
import type { PipelineRuntime } from "../../src/pipeline/pipeline-context.js";

// Import helpers from e2e utils
import { makeConfig, setupSuccessMocks, makePlan, makePhaseResult, DEFAULT_CHECKPOINT_HASH } from "./helpers/e2e-test-utils.js";

const mockFetchIssue = vi.mocked(fetchIssue);
const mockCloseIssue = vi.mocked(closeIssue);
const mockCoreLoop = vi.mocked(runCoreLoop);
const mockRunReviews = vi.mocked(runReviews);
const mockRunSimplify = vi.mocked(runSimplify);
const mockFinalValidation = vi.mocked(runFinalValidation);
const mockValidateIssue = vi.mocked(validateIssue);
const mockValidatePlan = vi.mocked(validatePlan);
const mockValidateBeforePush = vi.mocked(validateBeforePush);
const mockTransitionState = vi.mocked(transitionState);
const mockInitializePipelineState = vi.mocked(initializePipelineState);
const mockRollbackToCheckpoint = vi.mocked(rollbackToCheckpoint);
const mockCreateWorkBranch = vi.mocked(createWorkBranch);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockRunCli = vi.mocked(runCli);

// Capture state transitions for verification
const capturedStateTransitions: Array<{ from: PipelineState; to: PipelineState }> = [];

function setupStateCapture(): void {
  capturedStateTransitions.length = 0;
  let currentState: PipelineState = "RECEIVED";

  mockTransitionState.mockImplementation((runtime: PipelineRuntime, newState: PipelineState, context?: {
    worktreePath?: string;
    branchName?: string;
    projectRoot?: string;
    rollbackHash?: string;
    rollbackStrategy?: "none" | "all" | "failed-only";
  }) => {
    capturedStateTransitions.push({ from: currentState, to: newState });
    currentState = newState;
    runtime.state = newState;
    if (context) {
      if (context.worktreePath !== undefined) runtime.worktreePath = context.worktreePath;
      if (context.branchName !== undefined) runtime.branchName = context.branchName;
      if (context.rollbackHash !== undefined) runtime.rollbackHash = context.rollbackHash;
      if (context.rollbackStrategy !== undefined) runtime.rollbackStrategy = context.rollbackStrategy;
    }
  });

  mockInitializePipelineState.mockResolvedValue({
    state: "RECEIVED",
    projectRoot: "/tmp/project",
    gitConfig: {},
    promptsDir: "/tmp/project/prompts",
    rollbackStrategy: "none",
  } as PipelineRuntime);
}

describe("E2E: Pipeline Failure Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStateCapture();
  });

  describe("Core Loop Failures", () => {
    it("should handle plan generation failure", async () => {
      setupSuccessMocks(2, {
        fetchIssue: mockFetchIssue,
        syncBaseBranch: vi.fn(),
        createWorkBranch: vi.fn().mockResolvedValue({
          baseBranch: "master",
          workBranch: "aq/42-fix-bug",
        }),
        createWorktree: vi.fn(),
        installDependencies: vi.fn(),
        runCli: vi.fn(),
        runCoreLoop: mockCoreLoop,
        pushBranch: vi.fn(),
        checkConflicts: vi.fn(),
        attemptRebase: vi.fn(),
        enableAutoMerge: vi.fn(),
        addIssueComment: vi.fn(),
        closeIssue: mockCloseIssue,
        createDraftPR: vi.fn(),
        removeWorktree: vi.fn(),
        getDiffContent: vi.fn(),
        runReviews: mockRunReviews,
        runSimplify: mockRunSimplify,
        runFinalValidation: mockFinalValidation,
        validateIssue: mockValidateIssue,
        validatePlan: mockValidatePlan,
        validateBeforePush: mockValidateBeforePush,
      });

      // Mock plan generation failure
      mockCoreLoop.mockResolvedValue({
        success: false,
        plan: undefined,
        phaseResults: [],
        error: "Plan generation failed: Unable to understand requirements",
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(result.error).toBeDefined();

      // Verify state transitions include failure
      const stateTransitionNames = capturedStateTransitions.map(t => t.to);
      expect(stateTransitionNames).toContain("FAILED");
    });

    it("should handle phase execution failure", async () => {
      setupSuccessMocks(2, {
        fetchIssue: mockFetchIssue,
        syncBaseBranch: vi.fn(),
        createWorkBranch: vi.fn().mockResolvedValue({
          baseBranch: "master",
          workBranch: "aq/42-fix-bug",
        }),
        createWorktree: vi.fn(),
        installDependencies: vi.fn(),
        runCli: vi.fn(),
        runCoreLoop: mockCoreLoop,
        pushBranch: vi.fn(),
        checkConflicts: vi.fn(),
        attemptRebase: vi.fn(),
        enableAutoMerge: vi.fn(),
        addIssueComment: vi.fn(),
        closeIssue: mockCloseIssue,
        createDraftPR: vi.fn(),
        removeWorktree: vi.fn(),
        getDiffContent: vi.fn(),
        runReviews: mockRunReviews,
        runSimplify: mockRunSimplify,
        runFinalValidation: mockFinalValidation,
        validateIssue: mockValidateIssue,
        validatePlan: mockValidatePlan,
        validateBeforePush: mockValidateBeforePush,
      });

      const plan = makePlan(2);

      // Mock phase execution failure
      mockCoreLoop.mockResolvedValue({
        success: false,
        plan,
        phaseResults: [
          makePhaseResult(0, "Phase 1", true),
          makePhaseResult(1, "Phase 2", false, {
            error: "TypeScript compilation failed",
            errorCategory: "TS_ERROR",
          }),
        ],
        error: "Phase 2 execution failed",
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(result.error).toBeDefined();

      // Report is generated by the orchestrator on failure
      expect(result.report).toBeDefined();
    });
  });

  describe("Review Failures", () => {
    it("should handle review rejection", async () => {
      setupSuccessMocks(2, {
        fetchIssue: mockFetchIssue,
        syncBaseBranch: vi.fn(),
        createWorkBranch: vi.fn().mockResolvedValue({
          baseBranch: "master",
          workBranch: "aq/42-fix-bug",
        }),
        createWorktree: vi.fn(),
        installDependencies: vi.fn(),
        runCli: vi.fn(),
        runCoreLoop: mockCoreLoop,
        pushBranch: vi.fn(),
        checkConflicts: vi.fn(),
        attemptRebase: vi.fn(),
        enableAutoMerge: vi.fn(),
        addIssueComment: vi.fn(),
        closeIssue: mockCloseIssue,
        createDraftPR: vi.fn(),
        removeWorktree: vi.fn(),
        getDiffContent: vi.fn(),
        runReviews: mockRunReviews,
        runSimplify: mockRunSimplify,
        runFinalValidation: mockFinalValidation,
        validateIssue: mockValidateIssue,
        validatePlan: mockValidatePlan,
        validateBeforePush: mockValidateBeforePush,
      });

      // Mock successful core loop but failed review
      mockRunReviews.mockResolvedValue({
        rounds: [
          {
            roundName: "security",
            verdict: "FAIL",
            findings: [
              { severity: "high", description: "Security issue found" },
            ],
            summary: "Security issues found",
            durationMs: 2000,
          },
        ],
        allPassed: false,
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig({
          review: {
            enabled: true,
            rounds: [
              {
                name: "security",
                promptTemplate: "security-review.md",
                failAction: "block",
              },
            ],
          },
        }),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
    });

    it("should trigger rollback when review is rejected and rollback strategy is configured", async () => {
      const CHECKPOINT_HASH = "abc1234567890abcdef";

      setupSuccessMocks(2, {
        fetchIssue: mockFetchIssue,
        syncBaseBranch: vi.fn(),
        createWorkBranch: vi.fn().mockResolvedValue({
          baseBranch: "master",
          workBranch: "aq/42-fix-bug",
        }),
        createWorktree: vi.fn(),
        installDependencies: vi.fn(),
        runCli: vi.fn(),
        runCoreLoop: mockCoreLoop,
        pushBranch: vi.fn(),
        checkConflicts: vi.fn(),
        attemptRebase: vi.fn(),
        enableAutoMerge: vi.fn(),
        addIssueComment: vi.fn(),
        closeIssue: mockCloseIssue,
        createDraftPR: vi.fn(),
        removeWorktree: vi.fn(),
        getDiffContent: vi.fn(),
        runReviews: mockRunReviews,
        runSimplify: mockRunSimplify,
        runFinalValidation: mockFinalValidation,
        validateIssue: mockValidateIssue,
        validatePlan: mockValidatePlan,
        validateBeforePush: mockValidateBeforePush,
      });

      // Configure runtime with rollback strategy and hash so rollback triggers on failure
      mockInitializePipelineState.mockResolvedValue({
        state: "RECEIVED",
        projectRoot: "/tmp/project",
        gitConfig: {},
        promptsDir: "/tmp/project/prompts",
        rollbackStrategy: "all",
        rollbackHash: CHECKPOINT_HASH,
        worktreePath: "/tmp/wt/42-fix-bug",
      } as PipelineRuntime);

      mockRollbackToCheckpoint.mockResolvedValue(undefined);

      // Mock failed review with failAction: block
      mockRunReviews.mockResolvedValue({
        rounds: [
          {
            roundName: "security",
            verdict: "FAIL",
            findings: [{ severity: "high", description: "Security vulnerability detected" }],
            summary: "Critical security issue found",
            durationMs: 1500,
          },
        ],
        allPassed: false,
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig({
          review: {
            enabled: true,
            rounds: [
              {
                name: "security",
                promptTemplate: "security-review.md",
                failAction: "block",
              },
            ],
          },
        }),
        projectRoot: "/tmp/project",
      });

      // Pipeline should fail
      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");

      // Rollback should have been triggered with the checkpoint hash
      expect(mockRollbackToCheckpoint).toHaveBeenCalledWith(
        CHECKPOINT_HASH,
        expect.objectContaining({ cwd: "/tmp/wt/42-fix-bug" })
      );
    });
  });

  describe("Safety Violations", () => {
    it("should handle safety violations in issue validation", async () => {
      setupSuccessMocks(1, {
        fetchIssue: mockFetchIssue,
        syncBaseBranch: vi.fn(),
        createWorkBranch: vi.fn().mockResolvedValue({
          baseBranch: "master",
          workBranch: "aq/42-fix-bug",
        }),
        createWorktree: vi.fn(),
        installDependencies: vi.fn(),
        runCli: vi.fn(),
        runCoreLoop: mockCoreLoop,
        pushBranch: vi.fn(),
        checkConflicts: vi.fn(),
        attemptRebase: vi.fn(),
        enableAutoMerge: vi.fn(),
        addIssueComment: vi.fn(),
        closeIssue: mockCloseIssue,
        createDraftPR: vi.fn(),
        removeWorktree: vi.fn(),
        getDiffContent: vi.fn(),
        runReviews: mockRunReviews,
        runSimplify: mockRunSimplify,
        runFinalValidation: mockFinalValidation,
        validateIssue: mockValidateIssue,
        validatePlan: mockValidatePlan,
        validateBeforePush: mockValidateBeforePush,
      });

      // Mock safety violation
      mockValidateIssue.mockImplementation(() => {
        throw new Error("SAFETY_VIOLATION: Issue contains malicious patterns");
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(result.error).toBeDefined();
    });
  });

  describe("External Service Failures", () => {
    it("should handle GitHub API failures", async () => {
      setupSuccessMocks(1, {
        fetchIssue: mockFetchIssue,
        syncBaseBranch: vi.fn(),
        createWorkBranch: vi.fn().mockResolvedValue({
          baseBranch: "master",
          workBranch: "aq/42-fix-bug",
        }),
        createWorktree: vi.fn(),
        installDependencies: vi.fn(),
        runCli: vi.fn(),
        runCoreLoop: mockCoreLoop,
        pushBranch: vi.fn(),
        checkConflicts: vi.fn(),
        attemptRebase: vi.fn(),
        enableAutoMerge: vi.fn(),
        addIssueComment: vi.fn(),
        closeIssue: mockCloseIssue,
        createDraftPR: vi.fn(),
        removeWorktree: vi.fn(),
        getDiffContent: vi.fn(),
        runReviews: mockRunReviews,
        runSimplify: mockRunSimplify,
        runFinalValidation: mockFinalValidation,
        validateIssue: mockValidateIssue,
        validatePlan: mockValidatePlan,
        validateBeforePush: mockValidateBeforePush,
      });

      // Mock GitHub API failure
      mockFetchIssue.mockRejectedValue(new Error("GitHub API rate limit exceeded"));

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(result.error).toBeDefined();
    });
  });

  describe("Phase 실패 롤백 검증", () => {
    function setupRollbackTestMocks(): void {
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "master",
        workBranch: "aq/42-fix-bug",
      });
      mockCreateWorktree.mockResolvedValue({
        path: "/tmp/wt/42-fix-bug",
        branch: "aq/42-fix-bug",
      });
      mockRollbackToCheckpoint.mockResolvedValue(undefined);
      mockRunCli.mockResolvedValue({ stdout: "src/index.ts\n", stderr: "", exitCode: 0 });
      mockFetchIssue.mockResolvedValue({
        number: 42,
        title: "Fix bug",
        body: "Fix the bug",
        labels: [],
      });
      mockRunReviews.mockResolvedValue({ rounds: [], allPassed: true });
      mockRunSimplify.mockResolvedValue({
        applied: false,
        linesRemoved: 0,
        linesAdded: 0,
        filesModified: [],
        testsPassed: true,
        rolledBack: false,
        summary: "No changes",
      });
      mockFinalValidation.mockResolvedValue({ success: true, checks: [] });
      mockValidateIssue.mockReturnValue(undefined);
      mockValidatePlan.mockReturnValue(undefined);
      mockValidateBeforePush.mockResolvedValue(undefined);
    }

    it("should call rollbackToCheckpoint when rollbackStrategy is 'all' and phase fails", async () => {
      setupRollbackTestMocks();
      // createCheckpoint is called inside prepareWorkEnvironment via the real pipeline-git-setup.ts
      // We import and mock it via rollback-manager mock
      const { createCheckpoint } = await import("../../src/safety/rollback-manager.js");
      vi.mocked(createCheckpoint).mockResolvedValue(DEFAULT_CHECKPOINT_HASH);

      const plan = makePlan(2);
      mockCoreLoop.mockResolvedValue({
        success: false,
        plan,
        phaseResults: [
          makePhaseResult(0, "Phase 1", true, { commitHash: "def5678901234" }),
          makePhaseResult(1, "Phase 2", false, { error: "TypeScript compilation failed", errorCategory: "TS_ERROR" }),
        ],
        error: "Phase 2 execution failed",
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig({ safety: { rollbackStrategy: "all" } }),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(mockRollbackToCheckpoint).toHaveBeenCalledWith(
        DEFAULT_CHECKPOINT_HASH,
        expect.objectContaining({ cwd: "/tmp/wt/42-fix-bug" })
      );
    });

    it("should rollback to last successful commit when rollbackStrategy is 'failed-only'", async () => {
      setupRollbackTestMocks();
      const { createCheckpoint } = await import("../../src/safety/rollback-manager.js");
      vi.mocked(createCheckpoint).mockResolvedValue(DEFAULT_CHECKPOINT_HASH);

      const lastSuccessCommit = "def5678901234abcd";
      const plan = makePlan(2);
      mockCoreLoop.mockResolvedValue({
        success: false,
        plan,
        phaseResults: [
          makePhaseResult(0, "Phase 1", true, { commitHash: lastSuccessCommit }),
          makePhaseResult(1, "Phase 2", false, { error: "Test suite failed" }),
        ],
        error: "Phase 2 execution failed",
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig({ safety: { rollbackStrategy: "failed-only" } }),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      // failed-only: rolls back to last successful phase's commit
      expect(mockRollbackToCheckpoint).toHaveBeenCalledWith(
        lastSuccessCommit,
        expect.objectContaining({ cwd: "/tmp/wt/42-fix-bug" })
      );
    });

    it("should not call rollbackToCheckpoint when rollbackStrategy is 'none'", async () => {
      setupRollbackTestMocks();

      const plan = makePlan(1);
      mockCoreLoop.mockResolvedValue({
        success: false,
        plan,
        phaseResults: [
          makePhaseResult(0, "Phase 1", false, { error: "Phase failed immediately" }),
        ],
        error: "Phase 1 execution failed",
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig({ safety: { rollbackStrategy: "none" } }),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(mockRollbackToCheckpoint).not.toHaveBeenCalled();
    });

    it("should include rollback info in error and generate report for partial success case", async () => {
      setupRollbackTestMocks();
      const { createCheckpoint } = await import("../../src/safety/rollback-manager.js");
      vi.mocked(createCheckpoint).mockResolvedValue(DEFAULT_CHECKPOINT_HASH);

      const phase2Commit = "abc2222222222abcd";
      const plan = makePlan(3);
      mockCoreLoop.mockResolvedValue({
        success: false,
        plan,
        phaseResults: [
          makePhaseResult(0, "Phase 1", true, { commitHash: "abc1111111111abcd" }),
          makePhaseResult(1, "Phase 2", true, { commitHash: phase2Commit }),
          makePhaseResult(2, "Phase 3", false, { error: "Build failed: tsc error" }),
        ],
        error: "Phase 3 execution failed",
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig({ safety: { rollbackStrategy: "failed-only" } }),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      // Partial success: 2 phases succeeded, 1 failed — rolls back to last successful commit
      expect(mockRollbackToCheckpoint).toHaveBeenCalledWith(
        phase2Commit,
        expect.objectContaining({ cwd: "/tmp/wt/42-fix-bug" })
      );
      // Error message should mention rollback
      expect(result.error).toContain("Rolled back");
      // Report should be generated for partial success
      expect(result.report).toBeDefined();
    });
  });

  describe("State Transitions", () => {
    it("should capture failure state transitions", async () => {
      setupSuccessMocks(1, {
        fetchIssue: mockFetchIssue,
        syncBaseBranch: vi.fn(),
        createWorkBranch: vi.fn().mockResolvedValue({
          baseBranch: "master",
          workBranch: "aq/42-fix-bug",
        }),
        createWorktree: vi.fn(),
        installDependencies: vi.fn(),
        runCli: vi.fn(),
        runCoreLoop: mockCoreLoop,
        pushBranch: vi.fn(),
        checkConflicts: vi.fn(),
        attemptRebase: vi.fn(),
        enableAutoMerge: vi.fn(),
        addIssueComment: vi.fn(),
        closeIssue: mockCloseIssue,
        createDraftPR: vi.fn(),
        removeWorktree: vi.fn(),
        getDiffContent: vi.fn(),
        runReviews: mockRunReviews,
        runSimplify: mockRunSimplify,
        runFinalValidation: mockFinalValidation,
        validateIssue: mockValidateIssue,
        validatePlan: mockValidatePlan,
        validateBeforePush: mockValidateBeforePush,
      });

      // Mock failure after some successful states
      mockCoreLoop.mockResolvedValue({
        success: false,
        plan: undefined,
        phaseResults: [],
        error: "Core loop execution failed",
      });

      await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      // Verify we captured the failure state
      const stateTransitionNames = capturedStateTransitions.map(t => t.to);
      expect(stateTransitionNames).toContain("FAILED");
    });
  });
});
