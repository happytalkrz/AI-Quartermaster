import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/pipeline/plan-generator.js", () => ({
  generatePlan: vi.fn(),
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
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { runCoreLoop, type CoreLoopContext } from "../../src/pipeline/core-loop.js";
import { generatePlan } from "../../src/pipeline/plan-generator.js";
import { executePhase } from "../../src/pipeline/phase-executor.js";
import { retryPhase } from "../../src/pipeline/phase-retry.js";
import { checkPhaseLimit } from "../../src/safety/phase-limit-guard.js";
import { schedulePhases } from "../../src/pipeline/phase-scheduler.js";
import type { Plan, Phase, PhaseResult } from "../../src/types/pipeline.js";

const mockGeneratePlan = vi.mocked(generatePlan);
const mockExecutePhase = vi.mocked(executePhase);
const mockRetryPhase = vi.mocked(retryPhase);
const mockCheckPhaseLimit = vi.mocked(checkPhaseLimit);
const mockSchedulePhases = vi.mocked(schedulePhases);

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

function makeSuccessResult(phaseIndex: number, phaseName: string): PhaseResult {
  return {
    phaseIndex,
    phaseName,
    success: true,
    commitHash: "abc12345",
    durationMs: 1000,
  };
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
    mockCheckPhaseLimit.mockImplementation(() => {});
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

      mockGeneratePlan.mockResolvedValue(plan);
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
      expect(mockSchedulePhases).toHaveBeenCalledWith(phases);
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

      mockGeneratePlan.mockResolvedValue(plan);
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
      expect(mockSchedulePhases).toHaveBeenCalledWith(phases);
      expect(mockExecutePhase).toHaveBeenCalledTimes(4);
    });

    it("should fail when phase scheduling fails", async () => {
      const phases = [
        makePhase(0, "Phase1", [1]), // Circular dependency
        makePhase(1, "Phase2", [0]),
      ];
      const plan = makePlan(phases);

      mockGeneratePlan.mockResolvedValue(plan);
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

      mockGeneratePlan.mockResolvedValue(plan);
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

      mockGeneratePlan.mockResolvedValue(plan);
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

      mockGeneratePlan.mockResolvedValue(plan);
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

      mockGeneratePlan.mockResolvedValue(plan);
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

      mockGeneratePlan.mockResolvedValue(makePlan([makePhase(0, "Test")]));
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

      mockGeneratePlan.mockResolvedValue(plan);

      await runCoreLoop(makeContext());

      expect(mockCheckPhaseLimit).toHaveBeenCalledWith(15, 10);
    });
  });
});