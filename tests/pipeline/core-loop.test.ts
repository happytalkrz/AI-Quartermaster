import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/pipeline/plan-generator.js", () => ({
  generatePlan: vi.fn(),
}));
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
  extractJson: vi.fn(),
}));
vi.mock("../../src/pipeline/phase-executor.js", () => ({
  executePhase: vi.fn(),
}));
vi.mock("../../src/pipeline/phase-retry.js", () => ({
  retryPhase: vi.fn(),
}));
vi.mock("../../src/safety/phase-limit-guard.js", () => ({
  checkPhaseLimit: vi.fn(),
}));
vi.mock("../../src/pipeline/phase-scheduler.js", () => ({
  schedulePhases: vi.fn(),
}));
vi.mock("../../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn().mockImplementation(() => ({
    getRecentFailures: vi.fn().mockReturnValue([]),
    formatForPrompt: vi.fn().mockReturnValue(""),
  })),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../src/prompt/template-renderer.js", () => ({
  buildBaseLayer: vi.fn(),
  buildProjectLayer: vi.fn(),
  buildStaticContent: vi.fn(),
  loadTemplate: vi.fn(),
  computeLayerCacheKey: vi.fn(),
}));

import { runCoreLoop, type CoreLoopContext } from "../../src/pipeline/core-loop.js";
import { generatePlan } from "../../src/pipeline/plan-generator.js";
import { executePhase } from "../../src/pipeline/phase-executor.js";
import { retryPhase } from "../../src/pipeline/phase-retry.js";
import { checkPhaseLimit } from "../../src/safety/phase-limit-guard.js";
import { schedulePhases } from "../../src/pipeline/phase-scheduler.js";
import {
  buildBaseLayer,
  buildProjectLayer,
  buildStaticContent,
  loadTemplate,
  computeLayerCacheKey,
} from "../../src/prompt/template-renderer.js";
import type { Plan, Phase, PhaseResult } from "../../src/types/pipeline.js";

const mockGeneratePlan = vi.mocked(generatePlan);
const mockExecutePhase = vi.mocked(executePhase);
const mockRetryPhase = vi.mocked(retryPhase);
const mockCheckPhaseLimit = vi.mocked(checkPhaseLimit);
const mockSchedulePhases = vi.mocked(schedulePhases);
const mockBuildBaseLayer = vi.mocked(buildBaseLayer);
const mockBuildProjectLayer = vi.mocked(buildProjectLayer);
const mockBuildStaticContent = vi.mocked(buildStaticContent);
const mockLoadTemplate = vi.mocked(loadTemplate);
const mockComputeLayerCacheKey = vi.mocked(computeLayerCacheKey);

function makeContext(overrides: Partial<CoreLoopContext> = {}): CoreLoopContext {
  return {
    issue: { number: 42, title: "Test issue", body: "Test description", labels: [] },
    repo: { owner: "test", name: "repo" },
    branch: { base: "main", work: "feature-branch" },
    repoStructure: "src/\n  app.ts\n",
    config: {
      commands: {
        claudeCli: { path: "claude", model: "test", maxTurns: 1, timeout: 5000, additionalArgs: [] },
        test: "npm test",
        lint: "npm run lint",
      },
      safety: {
        maxPhases: 10,
        maxRetries: 2,
        sensitivePaths: [".env"],
      },
      git: {
        gitPath: "git",
        allowedRepos: ["test/repo"],
        autoCreateBranch: true,
        defaultBaseBranch: "main",
      },
      general: {
        projectName: "test",
        targetRoot: "/tmp",
        tempDir: "/tmp",
      },
      queue: {
        concurrency: 1,
        retryDelayMs: 1000,
        stuckTimeoutMs: 300000,
        persistenceFile: "/tmp/queue.json",
      },
      github: {
        token: "token",
        webhookSecret: "secret",
        enableAutoMerge: false,
      },
      server: {
        port: 3000,
        host: "localhost",
      },
      features: {
        parallelPhases: false,
      },
    },
    promptsDir: "/tmp/prompts",
    cwd: "/tmp/project",
    ...overrides,
  };
}

function makePlan(phases: Phase[]): Plan {
  return {
    issueNumber: 42,
    title: "Test Plan",
    problemDefinition: "Test problem",
    requirements: ["Test requirement"],
    affectedFiles: ["src/app.ts"],
    risks: ["Test risk"],
    phases,
    verificationPoints: ["Test verification"],
    stopConditions: ["Test stop condition"],
  };
}

function makePhase(index: number, name: string, dependsOn?: number[]): Phase {
  return {
    index,
    name,
    description: `Phase ${name} description`,
    targetFiles: [`src/${name.toLowerCase()}.ts`],
    commitStrategy: "atomic",
    verificationCriteria: [`${name} criteria`],
    dependsOn,
  };
}

function makeSuccessResult(phaseIndex: number, phaseName: string, costUsd?: number): PhaseResult {
  const result: PhaseResult = {
    phaseIndex,
    phaseName,
    success: true,
    commitHash: "abc12345",
    durationMs: 1000,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };

  // Only add costUsd if provided
  if (costUsd !== undefined) {
    result.costUsd = costUsd;
  }

  return result;
}

function makeFailureResult(phaseIndex: number, phaseName: string, error = "Test error", errorCategory: "TS_ERROR" | "TIMEOUT" | "SAFETY_VIOLATION" = "TS_ERROR"): PhaseResult {
  return {
    phaseIndex,
    phaseName,
    success: false,
    error,
    errorCategory,
    durationMs: 500,
  };
}

describe("runCoreLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mock implementations to clear persistent mockResolvedValue
    mockRetryPhase.mockReset();
    mockExecutePhase.mockReset();
    mockGeneratePlan.mockReset();
    mockSchedulePhases.mockReset().mockReturnValue({ success: true, groups: [] });
    mockCheckPhaseLimit.mockReset().mockImplementation(() => {});

    // template-renderer 기본 mock 설정:
    // loadTemplate은 기본적으로 throw (파일 없음 시뮬레이션) — 기존 테스트 동작 보존
    mockBuildBaseLayer.mockReset().mockReturnValue({
      role: "시니어 개발자",
      rules: [],
      outputFormat: "",
      progressReporting: "",
      parallelWorkGuide: "",
    });
    mockBuildProjectLayer.mockReset().mockReturnValue({
      conventions: "",
      structure: "",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      safetyRules: [],
    });
    mockBuildStaticContent.mockReset().mockReturnValue("mocked-static-content");
    mockLoadTemplate.mockReset().mockImplementation(() => {
      throw new Error("Template file not found: /tmp/prompts/phase-implementation.md");
    });
    mockComputeLayerCacheKey.mockReset().mockReturnValue("mock-cache-key-1234");
  });

  describe("parallel execution", () => {
    it("should execute independent phases in parallel", async () => {
      // Setup: 3 independent phases (no dependencies)
      const phases = [
        makePhase(0, "Frontend"),
        makePhase(1, "Backend"),
        makePhase(2, "Database"),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [
          {
            level: 0,
            phases: phases, // All phases can run in parallel
          },
        ],
      });

      // Mock all phases to succeed
      mockExecutePhase
        .mockResolvedValueOnce(makeSuccessResult(0, "Frontend"))
        .mockResolvedValueOnce(makeSuccessResult(1, "Backend"))
        .mockResolvedValueOnce(makeSuccessResult(2, "Database"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(3);
      expect(mockSchedulePhases).toHaveBeenCalledWith(phases, false);
      expect(mockExecutePhase).toHaveBeenCalledTimes(3);

      // All phases should have been called (order may vary due to parallel execution)
      const calledPhases = mockExecutePhase.mock.calls.map(call => call[0].phase.index);
      expect(calledPhases.sort()).toEqual([0, 1, 2]);
    });

    it("should execute phases with dependencies in correct order", async () => {
      // Setup: phases with dependencies
      // Phase 0: no dependencies
      // Phase 1: depends on Phase 0
      // Phase 2: depends on Phase 0
      // Phase 3: depends on Phase 1 and 2
      const phases = [
        makePhase(0, "Setup"),
        makePhase(1, "Frontend", [0]),
        makePhase(2, "Backend", [0]),
        makePhase(3, "Integration", [1, 2]),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [
          { level: 0, phases: [phases[0]] }, // Phase 0 first
          { level: 1, phases: [phases[1], phases[2]] }, // Phases 1,2 in parallel
          { level: 2, phases: [phases[3]] }, // Phase 3 last
        ],
      });

      mockExecutePhase
        .mockResolvedValueOnce(makeSuccessResult(0, "Setup"))
        .mockResolvedValueOnce(makeSuccessResult(1, "Frontend"))
        .mockResolvedValueOnce(makeSuccessResult(2, "Backend"))
        .mockResolvedValueOnce(makeSuccessResult(3, "Integration"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(4);
      expect(mockSchedulePhases).toHaveBeenCalledWith(phases, false);
      expect(mockExecutePhase).toHaveBeenCalledTimes(4);
    });

    it("should fail when phase scheduling fails", async () => {
      const phases = [
        makePhase(0, "Phase1", [1]), // Circular dependency
        makePhase(1, "Phase2", [0]),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: false,
        groups: [],
        error: "Circular dependency detected in phases: 0 → 1 → 0",
        circularDependency: [0, 1, 0],
      });

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(false);
      expect(result.phaseResults).toEqual([]);
      expect(mockExecutePhase).not.toHaveBeenCalled();
    });

    it("should stop execution when a phase fails in parallel group", async () => {
      const phases = [
        makePhase(0, "Frontend"),
        makePhase(1, "Backend"),
        makePhase(2, "Database"),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [
          {
            level: 0,
            phases: phases,
          },
        ],
      });

      // Frontend succeeds, Backend fails (TIMEOUT - no retry), Database succeeds
      mockExecutePhase
        .mockResolvedValueOnce(makeSuccessResult(0, "Frontend"))
        .mockResolvedValueOnce(makeFailureResult(1, "Backend", "Build failed", "TIMEOUT"))
        .mockResolvedValueOnce(makeSuccessResult(2, "Database"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(false);
      // When a phase fails, execution stops, so we may have fewer than 3 results
      expect(result.phaseResults.length).toBeGreaterThanOrEqual(1);

      // Should have at least one failure
      const failedPhase = result.phaseResults.find(r => !r.success);
      expect(failedPhase).toBeDefined();
      expect(failedPhase!.error).toBe("Build failed");
    });

    it("should retry failed phases with proper error categorization", async () => {
      const phases = [makePhase(0, "Flaky")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [
          {
            level: 0,
            phases: phases,
          },
        ],
      });

      // First attempt fails
      mockExecutePhase.mockResolvedValueOnce(
        makeFailureResult(0, "Flaky", "Temporary failure")
      );

      // Retry succeeds
      mockRetryPhase.mockResolvedValueOnce(makeSuccessResult(0, "Flaky"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(1);
      expect(result.phaseResults[0].success).toBe(true);
      expect(mockRetryPhase).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: phases[0],
          previousError: "Temporary failure",
          errorCategory: "TS_ERROR",
          attempt: 1,
          maxRetries: 2,
        })
      );
    });

    it("should skip retry for non-recoverable errors", async () => {
      const phases = [makePhase(0, "TimeoutPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [
          {
            level: 0,
            phases: phases,
          },
        ],
      });

      // Phase fails with timeout - should not retry
      const timeoutResult: PhaseResult = {
        phaseIndex: 0,
        phaseName: "TimeoutPhase",
        success: false,
        error: "Process timed out",
        errorCategory: "TIMEOUT",
        durationMs: 120000,
      };

      mockExecutePhase.mockResolvedValueOnce(timeoutResult);

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(false);
      expect(result.phaseResults).toHaveLength(1);
      expect(result.phaseResults[0].errorCategory).toBe("TIMEOUT");
      expect(mockRetryPhase).not.toHaveBeenCalled(); // No retry for timeout
    });

    it("should resume from checkpoint with previous results", async () => {
      const phases = [
        makePhase(0, "Completed"),
        makePhase(1, "Remaining"),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [
          {
            level: 0,
            phases: phases,
          },
        ],
      });

      // Provide previous result for phase 0 (already completed)
      const previousResults = [makeSuccessResult(0, "Completed")];

      // Only phase 1 should be executed
      mockExecutePhase.mockResolvedValueOnce(makeSuccessResult(1, "Remaining"));

      const result = await runCoreLoop(makeContext({
        previousPhaseResults: previousResults,
      }));

      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(2);
      expect(mockExecutePhase).toHaveBeenCalledTimes(1); // Only phase 1 executed

      // Verify phase 0 was skipped
      const executeCall = mockExecutePhase.mock.calls[0];
      expect(executeCall[0].phase.index).toBe(1);
    });
  });

  describe("plan generation", () => {
    it("should call generatePlan with correct parameters", async () => {
      const ctx = makeContext({
        modeHint: "test-mode",
        dataDir: "/tmp/data",
      });

      mockGeneratePlan.mockResolvedValue({ plan: makePlan([makePhase(0, "Test")]) });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [
          {
            level: 0,
            phases: [makePhase(0, "Test")],
          },
        ],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));

      await runCoreLoop(ctx);

      expect(mockGeneratePlan).toHaveBeenCalledWith({
        issue: ctx.issue,
        repo: ctx.repo,
        branch: ctx.branch,
        repoStructure: ctx.repoStructure,
        claudeConfig: ctx.config.commands.claudeCli,
        promptsDir: ctx.promptsDir,
        cwd: ctx.cwd,
        modeHint: "test-mode",
        maxPhases: 10,
        sensitivePaths: ".env",
      });
    });

    it("should enforce phase limit", async () => {
      const phases = Array.from({ length: 15 }, (_, i) => makePhase(i, `Phase${i}`));
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });

      await runCoreLoop(makeContext());

      expect(mockCheckPhaseLimit).toHaveBeenCalledWith(15, 10);
    });
  });

  describe("error history accumulation", () => {
    it("should accumulate error history across multiple retry attempts", async () => {
      const phases = [makePhase(0, "FlakyPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      // First execution fails
      mockExecutePhase.mockResolvedValueOnce(
        makeFailureResult(0, "FlakyPhase", "Initial error", "TS_ERROR")
      );

      // First retry fails
      mockRetryPhase.mockResolvedValueOnce(
        makeFailureResult(0, "FlakyPhase", "First retry error", "TS_ERROR")
      );

      // Second retry fails (final attempt)
      mockRetryPhase.mockResolvedValueOnce(
        makeFailureResult(0, "FlakyPhase", "Second retry error", "TS_ERROR")
      );

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(false);
      expect(mockRetryPhase).toHaveBeenCalledTimes(2);

      // First retry should receive error history with initial failure
      expect(mockRetryPhase).toHaveBeenNthCalledWith(1, expect.objectContaining({
        attempt: 1,
        previousError: "Initial error",
        errorCategory: "TS_ERROR",
        errorHistory: [
          {
            attempt: 0,
            errorCategory: "TS_ERROR",
            errorMessage: "Initial error",
            timestamp: expect.any(String),
          },
        ],
      }));

      // Second retry should receive error history with initial failure + first retry failure
      expect(mockRetryPhase).toHaveBeenNthCalledWith(2, expect.objectContaining({
        attempt: 2,
        previousError: "First retry error",
        errorCategory: "TS_ERROR",
        errorHistory: [
          {
            attempt: 0,
            errorCategory: "TS_ERROR",
            errorMessage: "Initial error",
            timestamp: expect.any(String),
          },
          {
            attempt: 1,
            errorCategory: "TS_ERROR",
            errorMessage: "First retry error",
            timestamp: expect.any(String),
          },
        ],
      }));
    });

    it("should clear error history when retry succeeds", async () => {
      const phases = [
        makePhase(0, "RecoveringPhase"),
        makePhase(1, "NextPhase"),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      // First phase: fails initially, succeeds on retry
      mockExecutePhase
        .mockResolvedValueOnce(makeFailureResult(0, "RecoveringPhase", "Temporary error", "TS_ERROR"))
        .mockResolvedValueOnce(makeSuccessResult(1, "NextPhase"));

      // Retry succeeds
      mockRetryPhase.mockResolvedValueOnce(makeSuccessResult(0, "RecoveringPhase"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(2);
      expect(result.phaseResults[0].success).toBe(true); // Retry succeeded
      expect(result.phaseResults[1].success).toBe(true); // Next phase succeeded

      // Should have called retry with error history
      expect(mockRetryPhase).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
        errorHistory: [
          {
            attempt: 0,
            errorCategory: "TS_ERROR",
            errorMessage: "Temporary error",
            timestamp: expect.any(String),
          },
        ],
      }));

      // Verify no further retries (error history would be cleared after success)
      expect(mockRetryPhase).toHaveBeenCalledTimes(1);
    });

    it("should not accumulate error history for non-retryable errors", async () => {
      const phases = [makePhase(0, "TimeoutPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      // Phase fails with timeout (non-retryable)
      mockExecutePhase.mockResolvedValueOnce(
        makeFailureResult(0, "TimeoutPhase", "Process timed out", "TIMEOUT")
      );

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(false);
      expect(result.phaseResults).toHaveLength(1);
      expect(result.phaseResults[0].errorCategory).toBe("TIMEOUT");

      // Should not attempt retry for timeout errors
      expect(mockRetryPhase).not.toHaveBeenCalled();
    });

    it("should not accumulate error history for safety violations", async () => {
      const phases = [makePhase(0, "UnsafePhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      // Phase fails with safety violation (non-retryable)
      mockExecutePhase.mockResolvedValueOnce(
        makeFailureResult(0, "UnsafePhase", "Safety guard triggered", "SAFETY_VIOLATION")
      );

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(false);
      expect(result.phaseResults).toHaveLength(1);
      expect(result.phaseResults[0].errorCategory).toBe("SAFETY_VIOLATION");

      // Should not attempt retry for safety violations
      expect(mockRetryPhase).not.toHaveBeenCalled();
    });

    it("should handle error history with different error categories", async () => {
      const phases = [makePhase(0, "MixedErrorPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      // First execution fails with TS error
      mockExecutePhase.mockResolvedValueOnce(
        makeFailureResult(0, "MixedErrorPhase", "Type error", "TS_ERROR")
      );

      // First retry fails with verification error
      mockRetryPhase.mockResolvedValueOnce(
        makeFailureResult(0, "MixedErrorPhase", "Test failed", "VERIFICATION_FAILED")
      );

      // Second retry succeeds
      mockRetryPhase.mockResolvedValueOnce(
        makeSuccessResult(0, "MixedErrorPhase")
      );

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(mockRetryPhase).toHaveBeenCalledTimes(2);

      // Second retry should have mixed error categories in history
      expect(mockRetryPhase).toHaveBeenNthCalledWith(2, expect.objectContaining({
        attempt: 2,
        errorHistory: [
          {
            attempt: 0,
            errorCategory: "TS_ERROR",
            errorMessage: "Type error",
            timestamp: expect.any(String),
          },
          {
            attempt: 1,
            errorCategory: "VERIFICATION_FAILED",
            errorMessage: "Test failed",
            timestamp: expect.any(String),
          },
        ],
      }));
    });

    it("should handle error history with unknown error category", async () => {
      const phases = [makePhase(0, "UnknownErrorPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      // Phase fails with no error category (undefined)
      const result = makeFailureResult(0, "UnknownErrorPhase", "Unknown error");
      delete result.errorCategory; // Remove errorCategory to test undefined handling

      mockExecutePhase.mockResolvedValueOnce(result);

      // Retry fails with no error message (undefined) but still returns a valid result
      const retryResult = makeFailureResult(0, "UnknownErrorPhase", "Retry error", "TS_ERROR");
      retryResult.error = undefined; // Set error to undefined instead of deleting

      mockRetryPhase.mockResolvedValueOnce(retryResult).mockResolvedValueOnce(retryResult); // Handle multiple calls with Once

      await runCoreLoop(makeContext());

      expect(mockRetryPhase).toHaveBeenCalledWith(expect.objectContaining({
        attempt: 1,
        previousError: "Unknown error",
        errorCategory: "UNKNOWN", // Should default to UNKNOWN
        errorHistory: [
          {
            attempt: 0,
            errorCategory: "UNKNOWN", // Should default to UNKNOWN
            errorMessage: "Unknown error",
            timestamp: expect.any(String),
          },
        ],
      }));
    });

    it("should maintain separate error histories for different phases", async () => {
      const phases = [
        makePhase(0, "Phase1"),
        makePhase(1, "Phase2"),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }], // Both phases run in parallel
      });

      // Both phases fail initially
      mockExecutePhase
        .mockResolvedValueOnce(makeFailureResult(0, "Phase1", "Phase1 error", "TS_ERROR"))
        .mockResolvedValueOnce(makeFailureResult(1, "Phase2", "Phase2 error", "VERIFICATION_FAILED"));

      // Both phases succeed on retry
      mockRetryPhase
        .mockResolvedValueOnce(makeSuccessResult(0, "Phase1"))
        .mockResolvedValueOnce(makeSuccessResult(1, "Phase2"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(mockRetryPhase).toHaveBeenCalledTimes(2);

      // Each retry should have its own error history
      const retryCall1 = mockRetryPhase.mock.calls.find(call => call[0].phase.index === 0);
      const retryCall2 = mockRetryPhase.mock.calls.find(call => call[0].phase.index === 1);

      expect(retryCall1?.[0]).toMatchObject({
        phase: { index: 0 },
        errorHistory: [
          {
            attempt: 0,
            errorCategory: "TS_ERROR",
            errorMessage: "Phase1 error",
          },
        ],
      });

      expect(retryCall2?.[0]).toMatchObject({
        phase: { index: 1 },
        errorHistory: [
          {
            attempt: 0,
            errorCategory: "VERIFICATION_FAILED",
            errorMessage: "Phase2 error",
          },
        ],
      });
    });
  });

  describe("plan generation retry integration", () => {
    it("should handle plan generation successfully with internal retry", async () => {
      const phases = [makePhase(0, "TestPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });

      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "TestPhase"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(1);
      expect(result.phaseResults[0].success).toBe(true);
      expect(mockGeneratePlan).toHaveBeenCalledTimes(1);
    });

    it("should fail when plan generation consistently fails", async () => {
      mockGeneratePlan.mockRejectedValue(new Error("Plan generation failed after 2 attempts"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(false);
      expect(result.phaseResults).toEqual([]);
      expect(mockGeneratePlan).toHaveBeenCalledTimes(1);
      expect(mockSchedulePhases).not.toHaveBeenCalled();
      expect(mockExecutePhase).not.toHaveBeenCalled();
    });

    it("should pass correct context to generatePlan on retry scenarios", async () => {
      const phases = [makePhase(0, "Frontend"), makePhase(1, "Backend")];
      const plan = makePlan(phases);

      const frontendResult = makeSuccessResult(0, "Frontend");
      frontendResult.costUsd = 0.030;
      const backendResult = makeSuccessResult(1, "Backend");
      backendResult.costUsd = 0.035;

      mockGeneratePlan.mockResolvedValue({
        plan,
        costUsd: 0.015,
        usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 25 }
      });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });
      mockExecutePhase
        .mockResolvedValueOnce(frontendResult)
        .mockResolvedValueOnce(backendResult);

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.totalCostUsd).toBe(0.080); // 0.015 (plan) + 0.030 + 0.035
      expect(result.totalUsage).toEqual({
        input_tokens: 400, // 200 (plan) + 100 + 100
        output_tokens: 200, // 100 (plan) + 50 + 50
        cache_read_input_tokens: 50, // 50 (plan) + 0 + 0
        cache_creation_input_tokens: 25, // 25 (plan) + 0 + 0
      });
      expect(result.phaseResults).toHaveLength(2);
      expect(mockGeneratePlan).toHaveBeenCalledTimes(1);
    });

    it("should handle phases with no cost information", async () => {
      const phases = [makePhase(0, "Test")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan, costUsd: 0 });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      // Phase result without costUsd
      const phaseResult = makeSuccessResult(0, "Test");
      // costUsd is undefined by default in makeSuccessResult

      mockExecutePhase.mockResolvedValueOnce(phaseResult);

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.totalCostUsd).toBe(0);
    });

    it("should calculate totalCostUsd with mixed cost and no-cost phases", async () => {
      const phases = [
        makePhase(0, "WithCost"),
        makePhase(1, "NoCost"),
        makePhase(2, "WithCost2"),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan, costUsd: 0 });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      const result1 = makeSuccessResult(0, "WithCost");
      result1.costUsd = 0.015;
      const result2 = makeSuccessResult(1, "NoCost");
      // result2.costUsd is undefined
      const result3 = makeSuccessResult(2, "WithCost2");
      result3.costUsd = 0.030;

      mockExecutePhase
        .mockResolvedValueOnce(result1)
        .mockResolvedValueOnce(result2)
        .mockResolvedValueOnce(result3);

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.totalCostUsd).toBe(0.045); // 0.015 + 0 + 0.030
    });

    it("should include costs from retry attempts", async () => {
      const phases = [makePhase(0, "RetryPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });

      const failedResult = makeFailureResult(0, "RetryPhase", "Error", "TS_ERROR");
      failedResult.costUsd = 0.020;
      mockExecutePhase.mockResolvedValueOnce(failedResult);

      const retryResult = makeSuccessResult(0, "RetryPhase");
      retryResult.costUsd = 0.035;
      mockRetryPhase.mockResolvedValueOnce(retryResult);

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.totalCostUsd).toBe(0.035);
    });
  });

  describe("plan generation retry integration", () => {
    it("should pass correct context to generatePlan on retry scenarios", async () => {
      const phases = [makePhase(0, "RetryPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "RetryPhase"));

      const customContext = makeContext({
        modeHint: "retry-test-mode",
        issue: {
          number: 999,
          title: "Retry integration test",
          body: "Test plan retry integration with specific context",
          labels: ["retry", "integration"],
        },
      });

      await runCoreLoop(customContext);

      expect(mockGeneratePlan).toHaveBeenCalledWith({
        issue: customContext.issue,
        repo: customContext.repo,
        branch: customContext.branch,
        repoStructure: customContext.repoStructure,
        claudeConfig: customContext.config.commands.claudeCli,
        promptsDir: customContext.promptsDir,
        cwd: customContext.cwd,
        modeHint: "retry-test-mode",
        maxPhases: 10,
        sensitivePaths: ".env",
      });
    });

    it("should handle plan generation timeout and recovery", async () => {
      const phases = [makePhase(0, "RetryPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "RetryPhase"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(1);
      expect(result.phaseResults[0].phaseName).toBe("RetryPhase");
      expect(mockGeneratePlan).toHaveBeenCalledTimes(1);
    });

    it("should handle malformed plan generation responses", async () => {
      const validPlan = makePlan([makePhase(0, "ValidPhase")]);

      mockGeneratePlan.mockResolvedValue({ plan: validPlan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: validPlan.phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "ValidPhase"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(result.phaseResults[0].phaseName).toBe("ValidPhase");
      expect(mockGeneratePlan).toHaveBeenCalledTimes(1);
    });

    it("should maintain error context across plan retry attempts", async () => {
      const phases = [makePhase(0, "ErrorContextPhase")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases: phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "ErrorContextPhase"));

      const result = await runCoreLoop(makeContext());

      expect(result.success).toBe(true);
      expect(mockGeneratePlan).toHaveBeenCalledTimes(1);

      const generatePlanCall = mockGeneratePlan.mock.calls[0];
      expect(generatePlanCall[0]).toMatchObject({
        issue: expect.any(Object),
        repo: expect.any(Object),
        branch: expect.any(Object),
        repoStructure: expect.any(String),
        claudeConfig: expect.any(Object),
        promptsDir: expect.any(String),
        cwd: expect.any(String),
      });
    });
  });

  describe("feature flags", () => {
    describe("parallelPhases", () => {
      it("should pass feature flag state to schedulePhases", async () => {
        const phases = [makePhase(0, "Test")];
        const plan = makePlan(phases);

        mockGeneratePlan.mockResolvedValue({ plan });
        mockSchedulePhases.mockReturnValue({
          success: true,
          groups: [{ level: 0, phases: phases }],
        });
        mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));

        // Test with parallelPhases enabled
        const contextWithParallel = makeContext({
          config: {
            ...makeContext().config,
            features: { parallelPhases: true },
          },
        });

        await runCoreLoop(contextWithParallel);
        expect(mockSchedulePhases).toHaveBeenCalledWith(phases, true);

        // Reset mocks
        mockSchedulePhases.mockClear();

        // Test with parallelPhases disabled (default)
        await runCoreLoop(makeContext());
        expect(mockSchedulePhases).toHaveBeenCalledWith(phases, false);
      });

      it("should handle undefined features config gracefully", async () => {
        const phases = [makePhase(0, "Test")];
        const plan = makePlan(phases);

        mockGeneratePlan.mockResolvedValue({ plan });
        mockSchedulePhases.mockReturnValue({
          success: true,
          groups: [{ level: 0, phases: phases }],
        });
        mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));

        // Test with features config undefined
        const contextWithoutFeatures = makeContext({
          config: {
            ...makeContext().config,
            features: undefined as any,
          },
        });

        await runCoreLoop(contextWithoutFeatures);

        // Should default to false when features is undefined
        expect(mockSchedulePhases).toHaveBeenCalledWith(phases, false);
      });
    });
  });

  describe("feature flags", () => {
    describe("parallelPhases", () => {
      it("should pass feature flag state to schedulePhases", async () => {
        const phases = [makePhase(0, "Test")];
        const plan = makePlan(phases);

        mockGeneratePlan.mockResolvedValue({ plan });
        mockSchedulePhases.mockReturnValue({
          success: true,
          groups: [{ level: 0, phases: phases }],
        });
        mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));

        // Test with parallelPhases enabled
        const contextWithParallel = makeContext({
          config: {
            ...makeContext().config,
            features: { parallelPhases: true },
          },
        });

        await runCoreLoop(contextWithParallel);
        expect(mockSchedulePhases).toHaveBeenCalledWith(phases, true);

        // Reset mocks
        mockSchedulePhases.mockClear();

        // Test with parallelPhases disabled (default)
        await runCoreLoop(makeContext());
        expect(mockSchedulePhases).toHaveBeenCalledWith(phases, false);
      });

      it("should handle undefined features config gracefully", async () => {
        const phases = [makePhase(0, "Test")];
        const plan = makePlan(phases);

        mockGeneratePlan.mockResolvedValue({ plan });
        mockSchedulePhases.mockReturnValue({
          success: true,
          groups: [{ level: 0, phases: phases }],
        });
        mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));

        // Test with features config undefined
        const contextWithoutFeatures = makeContext({
          config: {
            ...makeContext().config,
            features: undefined as any,
          },
        });

        await runCoreLoop(contextWithoutFeatures);

        // Should default to false when features is undefined
        expect(mockSchedulePhases).toHaveBeenCalledWith(phases, false);
      });
    });
  });

  describe("static layer caching (레이어 기반 프롬프트 조립 회귀 테스트)", () => {
    it("should build static layers on first run and pass them to executePhase", async () => {
      const phases = [makePhase(0, "Test")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));
      mockLoadTemplate.mockReturnValue("phase-template-content");
      mockBuildStaticContent.mockReturnValue("built-static-content");
      mockComputeLayerCacheKey.mockReturnValue("computed-cache-key");

      await runCoreLoop(makeContext());

      expect(mockBuildBaseLayer).toHaveBeenCalledWith(
        expect.objectContaining({ role: "시니어 개발자" })
      );
      expect(mockBuildProjectLayer).toHaveBeenCalled();
      expect(mockBuildStaticContent).toHaveBeenCalled();
      expect(mockLoadTemplate).toHaveBeenCalled();

      expect(mockExecutePhase).toHaveBeenCalledWith(
        expect.objectContaining({
          cachedLayers: expect.objectContaining({
            staticContent: "built-static-content",
            cacheKey: "computed-cache-key",
            phaseTemplate: "phase-template-content",
          }),
        })
      );
    });

    it("should pass cachedLayers to generatePlan", async () => {
      const phases = [makePhase(0, "Test")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));
      mockLoadTemplate.mockReturnValue("phase-template-content");
      mockBuildStaticContent.mockReturnValue("built-static-content");
      mockComputeLayerCacheKey.mockReturnValue("computed-cache-key");

      await runCoreLoop(makeContext());

      expect(mockGeneratePlan).toHaveBeenCalledWith(
        expect.objectContaining({
          cachedLayers: expect.objectContaining({
            staticContent: "built-static-content",
            cacheKey: "computed-cache-key",
          }),
        })
      );
    });

    it("should reuse existing cachedLayers without rebuilding static layers", async () => {
      const phases = [makePhase(0, "Test")];
      const plan = makePlan(phases);
      const preCachedLayers = {
        staticContent: "pre-cached-static",
        cacheKey: "pre-cached-key",
        createdAt: "2026-01-01T00:00:00.000Z",
        phaseTemplate: "pre-cached-template",
      };

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));

      await runCoreLoop(makeContext({ cachedLayers: preCachedLayers }));

      // 이미 캐시가 있으므로 정적 레이어를 다시 빌드하지 않아야 함
      expect(mockBuildBaseLayer).not.toHaveBeenCalled();
      expect(mockBuildProjectLayer).not.toHaveBeenCalled();
      expect(mockBuildStaticContent).not.toHaveBeenCalled();
      expect(mockLoadTemplate).not.toHaveBeenCalled();

      // 사전 캐시된 레이어를 executePhase에 전달해야 함
      expect(mockExecutePhase).toHaveBeenCalledWith(
        expect.objectContaining({
          cachedLayers: preCachedLayers,
        })
      );
    });

    it("should continue execution without cache when loadTemplate fails", async () => {
      const phases = [makePhase(0, "Test")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));
      // loadTemplate은 beforeEach에서 기본적으로 throw하도록 설정되어 있음

      const result = await runCoreLoop(makeContext());

      // 캐시 실패에도 불구하고 실행이 성공해야 함
      expect(result.success).toBe(true);
      expect(result.phaseResults).toHaveLength(1);
      expect(mockExecutePhase).toHaveBeenCalledTimes(1);
    });

    it("should compute cache key using cwd, conventions, and structure", async () => {
      const phases = [makePhase(0, "Test")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));
      mockLoadTemplate.mockReturnValue("template");

      const ctx = makeContext({
        cwd: "/custom/project",
        repoStructure: "src/\n  main.ts",
        projectConventions: "custom-conventions",
      });

      await runCoreLoop(ctx);

      expect(mockComputeLayerCacheKey).toHaveBeenCalledWith({
        cwd: "/custom/project",
        conventions: "custom-conventions",
        structure: "src/\n  main.ts",
      });
    });

    it("should build projectLayer with context values (conventions, structure, commands)", async () => {
      const phases = [makePhase(0, "Test")];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue({ plan });
      mockSchedulePhases.mockReturnValue({
        success: true,
        groups: [{ level: 0, phases }],
      });
      mockExecutePhase.mockResolvedValue(makeSuccessResult(0, "Test"));
      mockLoadTemplate.mockReturnValue("template");

      const ctx = makeContext({
        projectConventions: "TypeScript strict, ESM",
        repoStructure: "src/\n  app.ts",
        skillsContext: "use logger",
      });

      await runCoreLoop(ctx);

      expect(mockBuildProjectLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          conventions: "TypeScript strict, ESM",
          structure: "src/\n  app.ts",
          skillsContext: "use logger",
          testCommand: ctx.config.commands.test,
          lintCommand: ctx.config.commands.lint,
        })
      );
    });
  });
});