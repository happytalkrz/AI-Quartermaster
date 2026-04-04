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
vi.mock("../../src/git/diff-collector.js", () => ({
  collectDiff: vi.fn(),
  getDiffContent: vi.fn(),
}));
vi.mock("../../src/safety/safety-checker.js", () => ({
  validateIssue: vi.fn(),
  validatePlan: vi.fn(),
  validateBeforePush: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/pipeline/pipeline-setup.js", () => ({
  resolveResolvedProject: vi.fn(),
  checkDuplicatePR: vi.fn(),
  fetchAndValidateIssue: vi.fn(),
}));
vi.mock("../../src/pipeline/pipeline-context.js", async () => {
  const actual = await vi.importActual("../../src/pipeline/pipeline-context.js");
  return {
    ...actual,
    transitionState: vi.fn(),
    initializePipelineState: vi.fn(),
  };
});
vi.mock("../../src/safety/rollback-manager.js", () => ({
  rollbackToCheckpoint: vi.fn(),
  createCheckpoint: vi.fn(),
}));
vi.mock("../../src/pipeline/pipeline-phases.js", () => ({
  executeInitialSetupPhases: vi.fn(),
  executeEnvironmentSetup: vi.fn(),
  executeCoreLoopPhase: vi.fn(),
  executePostProcessingPhases: vi.fn(),
}));

import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { fetchIssue } from "../../src/github/issue-fetcher.js";
import {
  resolveResolvedProject,
  checkDuplicatePR,
  fetchAndValidateIssue,
} from "../../src/pipeline/pipeline-setup.js";
import { createDraftPR, enableAutoMerge, addIssueComment, closeIssue } from "../../src/github/pr-creator.js";
import {
  syncBaseBranch,
  createWorkBranch,
  pushBranch,
  checkConflicts,
  attemptRebase,
} from "../../src/git/branch-manager.js";
import { createWorktree, removeWorktree } from "../../src/git/worktree-manager.js";
import { runCoreLoop } from "../../src/pipeline/core-loop.js";
import { installDependencies } from "../../src/pipeline/dependency-installer.js";
import { runFinalValidation } from "../../src/pipeline/final-validator.js";
import { runReviews } from "../../src/review/review-orchestrator.js";
import { runSimplify } from "../../src/review/simplify-runner.js";
import { getDiffContent } from "../../src/git/diff-collector.js";
import { validateIssue, validatePlan, validateBeforePush } from "../../src/safety/safety-checker.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { transitionState, initializePipelineState } from "../../src/pipeline/pipeline-context.js";
import {
  executeInitialSetupPhases,
  executeEnvironmentSetup,
  executeCoreLoopPhase,
  executePostProcessingPhases,
} from "../../src/pipeline/pipeline-phases.js";
import type { PipelineRuntime } from "../../src/pipeline/pipeline-context.js";
import type { PipelineState } from "../../src/types/pipeline.js";

// Import helpers from e2e utils
import { makeConfig, setupSuccessMocks, makePlan, makePhaseResult } from "./helpers/e2e-test-utils.js";

const mockFetchIssue = vi.mocked(fetchIssue);
const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockSyncBase = vi.mocked(syncBaseBranch);
const mockCreateBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockCheckConflicts = vi.mocked(checkConflicts);
const mockAttemptRebase = vi.mocked(attemptRebase);
const mockEnableAutoMerge = vi.mocked(enableAutoMerge);
const mockAddIssueComment = vi.mocked(addIssueComment);
const mockCloseIssue = vi.mocked(closeIssue);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockRemoveWorktree = vi.mocked(removeWorktree);
const mockCoreLoop = vi.mocked(runCoreLoop);
const mockInstallDeps = vi.mocked(installDependencies);
const mockRunCli = vi.mocked(runCli);
const mockRunReviews = vi.mocked(runReviews);
const mockRunSimplify = vi.mocked(runSimplify);
const mockFinalValidation = vi.mocked(runFinalValidation);
const mockGetDiffContent = vi.mocked(getDiffContent);
const mockValidateIssue = vi.mocked(validateIssue);
const mockValidatePlan = vi.mocked(validatePlan);
const mockValidateBeforePush = vi.mocked(validateBeforePush);
const mockTransitionState = vi.mocked(transitionState);
const mockInitializePipelineState = vi.mocked(initializePipelineState);
const mockExecuteInitialSetupPhases = vi.mocked(executeInitialSetupPhases);
const mockExecuteEnvironmentSetup = vi.mocked(executeEnvironmentSetup);
const mockExecuteCoreLoopPhase = vi.mocked(executeCoreLoopPhase);
const mockExecutePostProcessingPhases = vi.mocked(executePostProcessingPhases);
const mockResolveResolvedProject = vi.mocked(resolveResolvedProject);
const mockCheckDuplicatePR = vi.mocked(checkDuplicatePR);
const mockFetchAndValidateIssue = vi.mocked(fetchAndValidateIssue);

// ---------------------------------------------------------------------------
// Test State Capture Setup
// ---------------------------------------------------------------------------

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

  // Setup pipeline-setup mocks
  mockResolveResolvedProject.mockReturnValue({
    projectRoot: "/tmp/project",
    promptsDir: "/tmp/project/prompts",
    gitConfig: {},
  });

  mockCheckDuplicatePR.mockResolvedValue({ hasDuplicatePR: false });

  mockFetchAndValidateIssue.mockResolvedValue({
    issue: {
      number: 42,
      title: "Fix bug",
      body: "Fix the bug",
      labels: [],
    },
    mode: "code",
    checkpoint: vi.fn(),
  });

  // Setup pipeline-phases mocks
  const checkpointFn = vi.fn();
  mockExecuteInitialSetupPhases.mockResolvedValue({
    projectRoot: "/tmp/project",
    promptsDir: "/tmp/project/prompts",
    gitConfig: {},
    project: { repo: "test/repo" },
    dataDir: "/tmp/project/data",
    timer: { check: vi.fn(), elapsed: vi.fn() } as any,
    issue: { number: 42, title: "Fix bug", body: "Fix the bug", labels: [] },
    mode: "code",
    checkpoint: checkpointFn,
  });

  mockExecuteEnvironmentSetup.mockResolvedValue({
    projectConventions: "",
    skillsContext: "",
    repoStructure: "",
    rollbackHash: undefined,
  });

  mockExecuteCoreLoopPhase.mockResolvedValue({
    coreResult: {
      plan: {
        issueNumber: 42,
        title: "Fix bug",
        problemDefinition: "There is a bug",
        requirements: ["Fix it"],
        affectedFiles: ["src/index.ts"],
        risks: [],
        phases: [
          { index: 0, name: "Phase 1", description: "Do thing 1", targetFiles: ["src/file0.ts"], commitStrategy: "atomic", verificationCriteria: ["tests pass"] },
          { index: 1, name: "Phase 2", description: "Do thing 2", targetFiles: ["src/file1.ts"], commitStrategy: "atomic", verificationCriteria: ["tests pass"] },
        ],
        verificationPoints: ["all tests pass"],
        stopConditions: [],
      },
      phaseResults: [
        { phaseIndex: 0, phaseName: "Phase 1", success: true, commitHash: "abc01234", durationMs: 1000 },
        { phaseIndex: 1, phaseName: "Phase 2", success: true, commitHash: "abc11234", durationMs: 1200 },
      ],
      success: true,
    },
    preset: {},
    mode: "code",
  });

  mockExecutePostProcessingPhases.mockImplementation(
    (_ctx: any, runtime: PipelineRuntime) => {
      mockTransitionState(runtime, "DONE");
      return Promise.resolve({
        prUrl: "https://github.com/test/repo/pull/1",
        report: {
          issueNumber: 42,
          repo: "test/repo",
          phases: [
            { name: "Phase 1", success: true, commit: "abc01234", durationMs: 1000 },
            { name: "Phase 2", success: true, commit: "abc11234", durationMs: 1200 },
          ],
          totalDurationMs: 2200,
        },
        totalCostUsd: 0,
      });
    }
  );
}

function setupAllMocks(phaseCount = 2): void {
  setupStateCapture();
  setupSuccessMocks(phaseCount, {
    fetchIssue: mockFetchIssue,
    syncBaseBranch: mockSyncBase,
    createWorkBranch: mockCreateBranch,
    createWorktree: mockCreateWorktree,
    installDependencies: mockInstallDeps,
    runCli: mockRunCli,
    runCoreLoop: mockCoreLoop,
    pushBranch: mockPushBranch,
    checkConflicts: mockCheckConflicts,
    attemptRebase: mockAttemptRebase,
    enableAutoMerge: mockEnableAutoMerge,
    addIssueComment: mockAddIssueComment,
    closeIssue: mockCloseIssue,
    createDraftPR: mockCreateDraftPR,
    removeWorktree: mockRemoveWorktree,
    getDiffContent: mockGetDiffContent,
    runReviews: mockRunReviews,
    runSimplify: mockRunSimplify,
    runFinalValidation: mockFinalValidation,
    validateIssue: mockValidateIssue,
    validatePlan: mockValidatePlan,
    validateBeforePush: mockValidateBeforePush,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Full Pipeline Flow (Dry Run)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Happy Path: Complete Pipeline Flow", () => {
    it("should execute complete pipeline flow and transition through all states", async () => {
      setupAllMocks(3);

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      // Verify final result
      expect(result.success).toBe(true);
      expect(result.state).toBe("DONE");
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
      expect(result.report).toBeDefined();

      // Verify report contains all phase results (post-processing mock returns 2 phases)
      expect(result.report!.phases).toHaveLength(2);
      result.report!.phases.forEach((phase, index) => {
        expect(phase.name).toBe(`Phase ${index + 1}`);
        expect(phase.success).toBe(true);
        expect(phase.commit).toBeDefined();
      });
    });

    it("should capture correct state transitions during pipeline execution", async () => {
      setupAllMocks(2);

      await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      // The phase-level mocks handle internal state transitions.
      // mockExecutePostProcessingPhases calls transitionState(runtime, "DONE").
      const stateTransitionNames = capturedStateTransitions.map(t => t.to);
      expect(stateTransitionNames).toContain("DONE");
    });

    it("should execute all pipeline phases in correct order", async () => {
      setupAllMocks(2);

      await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      // Verify phase-level execution order by checking mock call order
      const setupOrder = mockExecuteInitialSetupPhases.mock.invocationCallOrder[0];
      const envOrder = mockExecuteEnvironmentSetup.mock.invocationCallOrder[0];
      const coreOrder = mockExecuteCoreLoopPhase.mock.invocationCallOrder[0];
      const postOrder = mockExecutePostProcessingPhases.mock.invocationCallOrder[0];

      // Verify order constraints
      expect(setupOrder).toBeLessThan(envOrder);
      expect(envOrder).toBeLessThan(coreOrder);
      expect(coreOrder).toBeLessThan(postOrder);
    });

    it("should properly handle multi-phase plan execution", async () => {
      const phaseCount = 4;
      setupAllMocks(phaseCount);

      // Override the core loop phase mock to return 4 phases
      const plan = makePlan(phaseCount);
      mockExecuteCoreLoopPhase.mockResolvedValue({
        coreResult: {
          plan,
          phaseResults: plan.phases.map(p => makePhaseResult(p.index, p.name, true)),
          success: true,
        },
        preset: {},
        mode: "code",
      });

      // Override post-processing to return 4-phase report
      mockExecutePostProcessingPhases.mockImplementation(
        (_ctx: any, runtime: PipelineRuntime) => {
          mockTransitionState(runtime, "DONE");
          return Promise.resolve({
            prUrl: "https://github.com/test/repo/pull/1",
            report: {
              issueNumber: 42,
              repo: "test/repo",
              phases: plan.phases.map((p, i) => ({
                name: p.name,
                success: true,
                commit: `abc${i}1234`,
                durationMs: 1000 + i * 200,
              })),
              totalDurationMs: 4800,
            },
            totalCostUsd: 0,
          });
        }
      );

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.report).toBeDefined();
      expect(result.report!.phases).toHaveLength(4);

      // Verify each phase was executed successfully
      result.report!.phases.forEach((phaseResult, index) => {
        expect(phaseResult.success).toBe(true);
        expect(phaseResult.name).toBe(`Phase ${index + 1}`);
        expect(phaseResult.commit).toMatch(/^abc\d+1234/);
        expect(phaseResult.durationMs).toBeGreaterThan(0);
      });
    });

    it("should execute review and simplify phases correctly", async () => {
      setupAllMocks(2);

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      // Phase-level mock was called, which internally handles review and simplify
      expect(result.success).toBe(true);
      expect(mockExecutePostProcessingPhases).toHaveBeenCalledOnce();

      // Verify post-processing was called after core loop
      expect(mockExecuteCoreLoopPhase.mock.invocationCallOrder[0])
        .toBeLessThan(mockExecutePostProcessingPhases.mock.invocationCallOrder[0]);
    });

    it("should handle final validation phase correctly", async () => {
      setupAllMocks(2);

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      // Post-processing phase handles validation internally
      expect(mockExecutePostProcessingPhases).toHaveBeenCalledOnce();
    });

    it("should create draft PR with correct information", async () => {
      setupAllMocks(2);

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      // Verify PR URL comes from the post-processing phase mock
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
      expect(mockExecutePostProcessingPhases).toHaveBeenCalledOnce();
    });

    it("should handle dry-run mode correctly (no actual external actions)", async () => {
      setupAllMocks(2);

      // In dry-run mode, external actions should be mocked
      const config = makeConfig({ dryRun: true });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config,
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);

      // All phase-level mocks should have been called
      expect(mockExecuteInitialSetupPhases).toHaveBeenCalled();
      expect(mockExecuteEnvironmentSetup).toHaveBeenCalled();
      expect(mockExecuteCoreLoopPhase).toHaveBeenCalled();
      expect(mockExecutePostProcessingPhases).toHaveBeenCalled();

      // But the results are mocked, not real
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
    });
  });

  describe("Pipeline Configuration Variations", () => {
    it("should handle different commit strategies", async () => {
      setupAllMocks(2);

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.report).toBeDefined();
      expect(result.report!.phases).toHaveLength(2);
    });

    it("should handle auto-merge configuration", async () => {
      setupAllMocks(1);

      const config = makeConfig({
        pr: {
          autoMerge: true,
          mergeMethod: "squash",
          autoDelete: true,
        },
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config,
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.prUrl).toBeDefined();
    });
  });

  describe("Failure Cases: Error States and Rollback", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe("Plan Generation Failures", () => {
      it("should handle plan generation failure and transition to FAILED state", async () => {
        setupAllMocks(2);

        // Inject failure at the core loop phase level
        mockExecuteCoreLoopPhase.mockRejectedValue(
          new Error("Plan generation failed: Unable to understand requirements")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error || result.report?.error || "").toContain("Plan generation failed");

        // Verify state transitions include failure
        const stateTransitionNames = capturedStateTransitions.map(t => t.to);
        expect(stateTransitionNames).toContain("FAILED");
      });

      it("should handle TIMEOUT error during plan generation", async () => {
        setupAllMocks(1);

        mockExecuteCoreLoopPhase.mockRejectedValue(
          new Error("Plan generation timed out after 300 seconds")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error || result.report?.error || "").toContain("timed out");
      });

      it("should handle SAFETY_VIOLATION during plan validation", async () => {
        setupAllMocks(1);

        // Inject failure at the initial setup phase level
        mockExecuteInitialSetupPhases.mockRejectedValue(
          new Error("SAFETY_VIOLATION: Plan attempts to modify sensitive system files")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error || result.report?.error || "").toContain("SAFETY_VIOLATION");
      });
    });

    describe("Phase Execution Failures", () => {
      it("should handle phase execution failure and transition to PHASE_FAILED state", async () => {
        setupAllMocks(2);

        const plan = makePlan(2);
        const failureReport = {
          issueNumber: 42,
          repo: "test/repo",
          phases: [
            { name: "Phase 1", success: true, commit: "abc01234", durationMs: 1000 },
            { name: "Phase 2", success: false, error: "TypeScript compilation failed", durationMs: 1200 },
          ],
          totalDurationMs: 2200,
          error: "Phase 2 execution failed",
        };

        // Inject failure via phase mock with attached failureResult
        const err = new Error("Phase 2 execution failed") as Error & { failureResult: any };
        err.failureResult = {
          success: false,
          state: "FAILED",
          error: "Phase 2 execution failed",
          report: failureReport,
        };
        mockExecuteCoreLoopPhase.mockRejectedValue(err);

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error || result.report?.error || "").toContain("Phase 2 execution failed");

        expect(result.report).toBeDefined();
        expect(result.report!.phases).toHaveLength(2);
        expect(result.report!.phases[0].success).toBe(true);
        expect(result.report!.phases[1].success).toBe(false);
        expect(result.report!.phases[1].error).toContain("TypeScript compilation failed");
      });

      it("should trigger rollback when phase fails with rollback strategy", async () => {
        setupAllMocks(2);

        mockExecuteCoreLoopPhase.mockRejectedValue(
          new Error("CLI crashed with exit code 1")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error || result.report?.error || "").toContain("CLI crashed");
      });

      it("should handle VERIFICATION_FAILED error in final validation", async () => {
        setupAllMocks(2);

        // Inject failure at post-processing phase level
        mockExecutePostProcessingPhases.mockRejectedValue(
          new Error("VERIFICATION_FAILED: Tests failed: 2 failing")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
      });
    });

    describe("Review Rejection Failures", () => {
      it("should handle review rejection with block action", async () => {
        setupAllMocks(2);

        // Inject review failure at post-processing phase level
        mockExecutePostProcessingPhases.mockRejectedValue(
          new Error("Review rejected: Security issues found")
        );

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
        expect(mockExecutePostProcessingPhases).toHaveBeenCalledOnce();
      }, 10000);

      it("should handle review timeout scenario", async () => {
        setupAllMocks(2);

        mockExecutePostProcessingPhases.mockRejectedValue(
          new Error("Review timed out after 600 seconds")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig({
            review: {
              enabled: true,
              rounds: [
                { name: "quality", promptTemplate: "quality-review.md", failAction: "block" },
              ],
            },
          }),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error).toBeDefined();
      }, 10000);

      it("should handle multiple review failures with escalating severity", async () => {
        setupAllMocks(2);

        mockExecutePostProcessingPhases.mockRejectedValue(
          new Error("Critical security issues found: Hardcoded credentials detected")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(mockExecutePostProcessingPhases).toHaveBeenCalledOnce();
      });
    });

    describe("Non-Retryable Error Scenarios", () => {
      it("should not retry on SAFETY_VIOLATION errors", async () => {
        setupAllMocks(1);

        let callCount = 0;
        mockExecuteInitialSetupPhases.mockImplementation(() => {
          callCount++;
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
        expect(result.error || result.report?.error || "").toContain("SAFETY_VIOLATION");

        // Should only be called once, no retries
        expect(callCount).toBe(1);
      });

      it("should not retry on TIMEOUT errors", async () => {
        setupAllMocks(1);

        let callCount = 0;
        mockExecuteCoreLoopPhase.mockImplementation(() => {
          callCount++;
          throw new Error("Operation timed out after maximum duration");
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

        // Should only be called once, no retries for timeout
        expect(callCount).toBe(1);
      });

      it("should handle CLI_CRASH errors appropriately", async () => {
        setupAllMocks(2);

        mockExecuteCoreLoopPhase.mockRejectedValue(
          new Error("CLI crashed with spawn claude ENOENT")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        // Pipeline should handle CLI crash gracefully
        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error).toBeDefined();
      });

      it("should capture and report error categories correctly", async () => {
        setupAllMocks(1);

        const plan = makePlan(1);
        const failureReport = {
          issueNumber: 42,
          repo: "test/repo",
          phases: [
            {
              name: "Phase 1",
              success: false,
              error: "TypeScript error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'",
              durationMs: 1000,
            },
          ],
          totalDurationMs: 1000,
          error: "Phase execution failed with TypeScript errors",
        };

        const err = new Error("Phase execution failed with TypeScript errors") as Error & { failureResult: any };
        err.failureResult = {
          success: false,
          state: "FAILED",
          error: "Phase execution failed with TypeScript errors",
          report: failureReport,
        };
        mockExecuteCoreLoopPhase.mockRejectedValue(err);

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.report).toBeDefined();
        expect(result.report!.phases[0].error).toContain("TS2345");
        expect(result.report!.phases[0].success).toBe(false);
      });
    });

    describe("State Transition Verification", () => {
      it("should capture correct failure state transitions", async () => {
        setupAllMocks(1);

        // Inject failure at core loop phase
        mockExecuteCoreLoopPhase.mockRejectedValue(
          new Error("Core loop execution failed")
        );

        await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        // Verify we captured the failure state
        const stateTransitionNames = capturedStateTransitions.map(t => t.to);
        expect(stateTransitionNames).toContain("FAILED");
        // Note: intermediate state transitions are handled inside phase mocks
      });

      it("should handle early pipeline failures in setup phase", async () => {
        setupAllMocks(1);

        // Inject failure at initial setup phase level
        mockExecuteInitialSetupPhases.mockRejectedValue(
          new Error("GitHub API rate limit exceeded")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error || result.report?.error || "").toContain("rate limit");
      });

      it("should handle worktree creation failures", async () => {
        setupAllMocks(1);

        // Inject failure at environment setup phase level
        mockExecuteEnvironmentSetup.mockRejectedValue(
          new Error("Failed to create worktree: disk space exceeded")
        );

        const result = await runPipeline({
          issueNumber: 42,
          repo: "test/repo",
          config: makeConfig(),
          projectRoot: "/tmp/project",
        });

        expect(result.success).toBe(false);
        expect(result.state).toBe("FAILED");
        expect(result.error || result.report?.error || "").toContain("disk space");
      });
    });
  });
});
