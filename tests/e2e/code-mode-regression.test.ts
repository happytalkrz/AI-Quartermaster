import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Mocks — declared before imports (Vitest hoists vi.mock calls)
// ---------------------------------------------------------------------------

// Keep the real extractJson so plan JSON parsing works correctly
vi.mock("../../src/claude/claude-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/claude/claude-runner.js")>(
    "../../src/claude/claude-runner.js"
  );
  return { ...actual, runClaude: vi.fn() };
});

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
  runShell: vi.fn(),
}));

vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
  getHeadHash: vi.fn(),
}));

vi.mock("../../src/safety/phase-limit-guard.js", () => ({
  checkPhaseLimit: vi.fn(),
}));

vi.mock("../../src/safety/rollback-manager.js", () => ({
  createCheckpoint: vi.fn(),
  ensureCleanState: vi.fn(),
  rollbackToCheckpoint: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { runCoreLoop } from "../../src/pipeline/core/core-loop.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { runCli, runShell } from "../../src/utils/cli-runner.js";
import { autoCommitIfDirty, getHeadHash } from "../../src/git/commit-helper.js";
import { createCheckpoint, ensureCleanState } from "../../src/safety/rollback-manager.js";
import { makeConfig } from "./helpers/e2e-test-utils.js";
import type { Plan } from "../../src/types/pipeline.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ISSUE = {
  number: 99,
  title: "Fix null check in user lookup",
  body: "When user is not found, accessing user.id throws a null reference error. Add a null check.",
  labels: [] as string[],
};

const FIXTURE_PLAN: Plan = {
  issueNumber: 99,
  title: "Fix null check in user lookup",
  problemDefinition: "Null reference when user is not found",
  requirements: ["Add null check before accessing user.id"],
  affectedFiles: [],
  risks: [],
  phases: [
    {
      index: 0,
      name: "Add null check",
      description: "Add null check before accessing user.id in auth module",
      targetFiles: ["src/auth.ts"],
      commitStrategy: "atomic",
      verificationCriteria: ["tests pass"],
    },
  ],
  verificationPoints: ["all tests pass"],
  stopConditions: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestConfig() {
  return makeConfig({
    commands: { test: "", lint: "", typecheck: "", build: "" },
  });
}

function setupRunClaudeStub(): void {
  let callCount = 0;
  vi.mocked(runClaude).mockImplementation(async () => {
    callCount += 1;
    if (callCount === 1) {
      // First call: plan generation — return valid plan JSON
      return {
        success: true,
        output: JSON.stringify(FIXTURE_PLAN),
        durationMs: 100,
      };
    }
    // Subsequent calls: phase execution — return success
    return {
      success: true,
      output: "Implementation complete. Added null check in src/auth.ts.",
      durationMs: 150,
    };
  });
}

function setupCliStubs(): void {
  vi.mocked(runCli).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  vi.mocked(runShell).mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  vi.mocked(autoCommitIfDirty).mockResolvedValue(false);
  vi.mocked(getHeadHash).mockResolvedValue("deadbeef1234");
}

function setupRunClaudeRetryStub(): void {
  let callCount = 0;
  vi.mocked(runClaude).mockImplementation(async () => {
    callCount += 1;
    if (callCount === 1) {
      // First call: plan generation — return valid plan JSON
      return {
        success: true,
        output: JSON.stringify(FIXTURE_PLAN),
        durationMs: 100,
      };
    }
    if (callCount === 2) {
      // Second call: initial phase execution — fail with a retriable error
      return {
        success: false,
        output: "TypeScript compilation error: cannot find module './auth'",
        durationMs: 100,
      };
    }
    // Third+ call: phase retry — succeed
    return {
      success: true,
      output: "Fixed: added null check before accessing user.id.",
      durationMs: 150,
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Code Mode — Golden Path Regression", () => {
  const dataDir = join(tmpdir(), `aqm-test-${Date.now()}`);
  const promptsDir = join(process.cwd(), "prompts");

  beforeEach(() => {
    vi.clearAllMocks();
    setupRunClaudeStub();
    setupCliStubs();
  });

  it("should execute plan→phase flow and return successful CoreLoopResult", async () => {
    const result = await runCoreLoop({
      issue: FIXTURE_ISSUE,
      repo: { owner: "test", name: "repo" },
      branch: { base: "main", work: "aq/99-fix-null-check" },
      repoStructure: "src/\n  auth.ts\n",
      config: makeTestConfig(),
      promptsDir,
      cwd: "/tmp/fake-worktree",
      dataDir,
    });

    // Golden path: pipeline succeeded end-to-end
    expect(result.success).toBe(true);

    // Plan was generated with the correct structure
    expect(result.plan).toBeDefined();
    expect(result.plan.issueNumber).toBe(99);
    expect(result.plan.phases).toHaveLength(1);
    expect(result.plan.phases[0].name).toBe("Add null check");

    // Phase executed through the real ClaudePhaseExecutor path
    // phaseResults includes pseudo-phases (phaseIndex < 0) for setup steps
    const realPhases = result.phaseResults.filter(r => r.phaseIndex >= 0);
    expect(realPhases).toHaveLength(1);
    expect(realPhases[0].success).toBe(true);
    expect(realPhases[0].phaseIndex).toBe(0);
    expect(realPhases[0].phaseName).toBe("Add null check");

    // runClaude was called at least twice (once for plan, once for phase)
    expect(vi.mocked(runClaude).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("E2E: Code Mode — Phase Retry Regression", () => {
  const dataDir = join(tmpdir(), `aqm-retry-test-${Date.now()}`);
  const promptsDir = join(process.cwd(), "prompts");

  beforeEach(() => {
    vi.clearAllMocks();
    setupRunClaudeRetryStub();
    setupCliStubs();
    vi.mocked(createCheckpoint).mockResolvedValue("checkpoint-abc123");
    vi.mocked(ensureCleanState).mockResolvedValue({
      path: "/tmp/fake-worktree",
      branch: "aq/99-fix-null-check",
    });
  });

  it("should retry a failed phase and complete the pipeline successfully", async () => {
    const result = await runCoreLoop({
      issue: FIXTURE_ISSUE,
      repo: { owner: "test", name: "repo" },
      branch: { base: "main", work: "aq/99-fix-null-check" },
      repoStructure: "src/\n  auth.ts\n",
      config: makeTestConfig(),
      promptsDir,
      cwd: "/tmp/fake-worktree",
      dataDir,
    });

    // Pipeline completed successfully despite initial phase failure
    expect(result.success).toBe(true);

    // Plan structure preserved
    expect(result.plan.issueNumber).toBe(99);
    expect(result.plan.phases).toHaveLength(1);

    // Phase result reflects successful retry
    const realPhases = result.phaseResults.filter(r => r.phaseIndex >= 0);
    expect(realPhases).toHaveLength(1);
    expect(realPhases[0].success).toBe(true);
    expect(realPhases[0].phaseIndex).toBe(0);
    expect(realPhases[0].retryCount).toBeGreaterThanOrEqual(1);

    // Retry was triggered: plan + initial fail + retry = at least 3 Claude calls
    expect(vi.mocked(runClaude).mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
