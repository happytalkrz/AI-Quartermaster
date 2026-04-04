import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
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
import type { PipelineState } from "../../src/types/pipeline.js";
import type { PipelineRuntime } from "../../src/pipeline/pipeline-context.js";

// Import helpers from e2e utils
import { makeConfig, setupSuccessMocks, makePlan, makePhaseResult } from "./helpers/e2e-test-utils.js";

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

// Capture state transitions for verification
const capturedStateTransitions: Array<{ from: PipelineState; to: PipelineState }> = [];

function setupStateCapture(): void {
  capturedStateTransitions.length = 0;
  let currentState: PipelineState = "RECEIVED";

  mockTransitionState.mockImplementation((runtime: PipelineRuntime, newState: PipelineState) => {
    capturedStateTransitions.push({ from: currentState, to: newState });
    currentState = newState;
    runtime.state = newState;
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

      // Verify report contains both successful and failed phases
      expect(result.report).toBeDefined();
      expect(result.report!.phases).toBeDefined();
      expect(result.report!.phases.length).toBeGreaterThan(0);

      // Verify we have both success and failure phases
      const successPhases = result.report!.phases.filter(p => p.success);
      const failedPhases = result.report!.phases.filter(p => !p.success);
      expect(successPhases.length).toBe(1); // Phase 1 should succeed
      expect(failedPhases.length).toBe(1); // Phase 2 should fail
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
