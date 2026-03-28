import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/github/issue-fetcher.js", () => ({
  fetchIssue: vi.fn(),
}));
vi.mock("../../src/github/pr-creator.js", () => ({
  createDraftPR: vi.fn(),
  enableAutoMerge: vi.fn(),
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

import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { fetchIssue } from "../../src/github/issue-fetcher.js";
import { createDraftPR, enableAutoMerge } from "../../src/github/pr-creator.js";
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
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

const mockFetchIssue = vi.mocked(fetchIssue);
const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockSyncBase = vi.mocked(syncBaseBranch);
const mockCreateBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockCheckConflicts = vi.mocked(checkConflicts);
const mockAttemptRebase = vi.mocked(attemptRebase);
const mockEnableAutoMerge = vi.mocked(enableAutoMerge);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Record<string, unknown> = {}) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.projectName = "test";
  config.general.targetRoot = "/tmp/project";
  config.git.allowedRepos = ["test/repo"];
  return Object.assign(config, overrides);
}

function makePlan(phaseCount: number) {
  return {
    issueNumber: 42,
    title: "Fix bug",
    problemDefinition: "There is a bug",
    requirements: ["Fix it"],
    affectedFiles: ["src/index.ts"],
    risks: [],
    phases: Array.from({ length: phaseCount }, (_, i) => ({
      index: i,
      name: `Phase ${i + 1}`,
      description: `Do thing ${i + 1}`,
      targetFiles: [`src/file${i}.ts`],
      commitStrategy: "atomic",
      verificationCriteria: ["tests pass"],
    })),
    verificationPoints: ["all tests pass"],
    stopConditions: [],
  };
}

function makePhaseResult(index: number, name: string, success: boolean, extra: Record<string, unknown> = {}) {
  return {
    phaseIndex: index,
    phaseName: name,
    success,
    commitHash: success ? `abc${index}1234` : undefined,
    durationMs: 1000 + index * 200,
    ...extra,
  };
}

function setupSuccessMocks(phaseCount = 2) {
  const plan = makePlan(phaseCount);

  mockFetchIssue.mockResolvedValue({ number: 42, title: "Fix bug", body: "Fix the bug", labels: [] });
  mockSyncBase.mockResolvedValue(undefined);
  mockCreateBranch.mockResolvedValue({ baseBranch: "master", workBranch: "aq/42-fix-bug" });
  mockCreateWorktree.mockResolvedValue({ path: "/tmp/wt/42-fix-bug", branch: "aq/42-fix-bug" });
  mockInstallDeps.mockResolvedValue(undefined);
  mockRunCli.mockResolvedValue({ stdout: "src/\n", stderr: "", exitCode: 0 });
  mockCoreLoop.mockResolvedValue({
    plan,
    phaseResults: plan.phases.map(p => makePhaseResult(p.index, p.name, true)),
    success: true,
  });
  mockPushBranch.mockResolvedValue(undefined);
  mockCheckConflicts.mockResolvedValue({ hasConflicts: false, conflictFiles: [] });
  mockAttemptRebase.mockResolvedValue({ success: true });
  mockEnableAutoMerge.mockResolvedValue(true);
  mockCreateDraftPR.mockResolvedValue({ url: "https://github.com/test/repo/pull/1", number: 1 });
  mockRemoveWorktree.mockResolvedValue(undefined);
  mockGetDiffContent.mockResolvedValue("diff --git a/src/index.ts b/src/index.ts\n+fixed line");
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
  mockFinalValidation.mockResolvedValue({
    success: true,
    checks: [{ name: "typecheck", passed: true }, { name: "test", passed: true }],
  });
  mockValidateIssue.mockReturnValue(undefined);
  mockValidatePlan.mockReturnValue(undefined);
  mockValidateBeforePush.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: pipeline integration", () => {
  beforeEach(() => vi.clearAllMocks());

  // -------------------------------------------------------------------------
  // 1. Happy path: Issue → Plan (2 phases) → Review → Final validation → PR
  // -------------------------------------------------------------------------
  it("happy path: full pipeline with 2-phase plan completes and returns PR URL", async () => {
    setupSuccessMocks(2);

    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe("DONE");
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");

    // Verify report contains phase results for both phases
    expect(result.report).toBeDefined();
    expect(result.report!.phases).toHaveLength(2);
    expect(result.report!.phases[0].name).toBe("Phase 1");
    expect(result.report!.phases[0].success).toBe(true);
    expect(result.report!.phases[1].name).toBe("Phase 2");
    expect(result.report!.phases[1].success).toBe(true);
  });

  it("happy path: state transitions fire in correct order", async () => {
    setupSuccessMocks(2);

    await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    const fetchOrder = mockFetchIssue.mock.invocationCallOrder[0];
    const syncOrder = mockSyncBase.mock.invocationCallOrder[0];
    const branchOrder = mockCreateBranch.mock.invocationCallOrder[0];
    const worktreeOrder = mockCreateWorktree.mock.invocationCallOrder[0];
    const coreOrder = mockCoreLoop.mock.invocationCallOrder[0];
    const pushOrder = mockPushBranch.mock.invocationCallOrder[0];
    const prOrder = mockCreateDraftPR.mock.invocationCallOrder[0];

    expect(fetchOrder).toBeLessThan(syncOrder);
    expect(syncOrder).toBeLessThan(branchOrder);
    expect(branchOrder).toBeLessThan(worktreeOrder);
    expect(worktreeOrder).toBeLessThan(coreOrder);
    expect(coreOrder).toBeLessThan(pushOrder);
    expect(pushOrder).toBeLessThan(prOrder);
  });

  // -------------------------------------------------------------------------
  // 2. Phase retry: phase fails first attempt, retry succeeds
  // -------------------------------------------------------------------------
  it("phase retry: pipeline succeeds when core-loop retries internally and succeeds", async () => {
    // The orchestrator delegates retry to runCoreLoop. We simulate the final
    // outcome of a successful retry by making runCoreLoop succeed overall but
    // including a phase result that indicates it took a retry pass.
    setupSuccessMocks(1);
    const plan = makePlan(1);
    mockCoreLoop.mockResolvedValue({
      plan,
      phaseResults: [
        makePhaseResult(0, "Phase 1", true, { durationMs: 3500 /* longer = retry happened */ }),
      ],
      success: true,
    });

    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe("DONE");
    expect(result.prUrl).toBeDefined();
    expect(mockCoreLoop).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 3. Phase retry exhaustion: all retries fail → pipeline fails
  // -------------------------------------------------------------------------
  it("phase retry exhaustion: pipeline fails with error details when all retries fail", async () => {
    setupSuccessMocks(2);
    const plan = makePlan(2);
    mockCoreLoop.mockResolvedValue({
      plan,
      phaseResults: [
        makePhaseResult(0, "Phase 1", false, {
          error: "TS2345: Argument of type X is not assignable",
          errorCategory: "TS_ERROR",
        }),
      ],
      success: false,
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

    // Report should be included and capture phase failure details
    expect(result.report).toBeDefined();
    const failedPhase = result.report!.phases.find(p => !p.success);
    expect(failedPhase).toBeDefined();
    expect(failedPhase!.name).toBe("Phase 1");

    // PR should NOT have been created
    expect(mockCreateDraftPR).not.toHaveBeenCalled();
  });

  it("phase retry exhaustion: pipeline failure does not attempt push", async () => {
    setupSuccessMocks(1);
    const plan = makePlan(1);
    mockCoreLoop.mockResolvedValue({
      plan,
      phaseResults: [
        makePhaseResult(0, "Phase 1", false, {
          error: "Tests failed: 3 failing",
          errorCategory: "VERIFICATION_FAILED",
        }),
      ],
      success: false,
    });

    await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    expect(mockPushBranch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Conflict detection: push with conflicts → rebase succeeds
  // -------------------------------------------------------------------------
  it("conflict detection: rebase succeeds → pipeline completes and PR is created", async () => {
    setupSuccessMocks(1);
    // Override: conflicts detected, but rebase fixes them
    mockCheckConflicts.mockResolvedValue({
      hasConflicts: true,
      conflictFiles: ["src/index.ts"],
    });
    mockAttemptRebase.mockResolvedValue({ success: true });

    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe("DONE");
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
    expect(mockAttemptRebase).toHaveBeenCalledOnce();
    expect(mockCreateDraftPR).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 5. Conflict detection: rebase fails → pipeline continues (non-blocking)
  // -------------------------------------------------------------------------
  it("conflict rebase failure: pipeline continues and still creates PR with warning", async () => {
    setupSuccessMocks(1);
    mockCheckConflicts.mockResolvedValue({
      hasConflicts: true,
      conflictFiles: ["src/utils.ts", "src/index.ts"],
    });
    mockAttemptRebase.mockResolvedValue({ success: false });

    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    // Rebase failure is non-blocking — pipeline should still succeed
    expect(result.success).toBe(true);
    expect(result.state).toBe("DONE");
    expect(result.prUrl).toBeDefined();
    expect(mockAttemptRebase).toHaveBeenCalledOnce();
    expect(mockCreateDraftPR).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 6. Auto-merge: config.pr.autoMerge = true → enableAutoMerge called
  // -------------------------------------------------------------------------
  it("auto-merge: enableAutoMerge is called with correct args when autoMerge is true", async () => {
    setupSuccessMocks(1);

    const config = makeConfig();
    config.pr.autoMerge = true;
    config.pr.mergeMethod = "squash";

    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config,
      projectRoot: "/tmp/project",
    });

    expect(result.success).toBe(true);
    expect(mockEnableAutoMerge).toHaveBeenCalledOnce();

    const [prNumber, repo, mergeMethod] = mockEnableAutoMerge.mock.calls[0];
    expect(prNumber).toBe(1);
    expect(repo).toBe("test/repo");
    expect(mergeMethod).toBe("squash");
  });

  it("auto-merge: enableAutoMerge is NOT called when autoMerge is false", async () => {
    setupSuccessMocks(1);

    const config = makeConfig();
    config.pr.autoMerge = false;

    await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config,
      projectRoot: "/tmp/project",
    });

    expect(mockEnableAutoMerge).not.toHaveBeenCalled();
  });
});
