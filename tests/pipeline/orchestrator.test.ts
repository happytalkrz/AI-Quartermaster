import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/github/issue-fetcher.js", () => ({
  fetchIssue: vi.fn(),
}));
vi.mock("../../src/github/pr-creator.js", () => ({
  createDraftPR: vi.fn(),
}));
vi.mock("../../src/git/branch-manager.js", () => ({
  syncBaseBranch: vi.fn(),
  createWorkBranch: vi.fn(),
  pushBranch: vi.fn(),
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
import { createDraftPR } from "../../src/github/pr-creator.js";
import { syncBaseBranch, createWorkBranch, pushBranch } from "../../src/git/branch-manager.js";
import { createWorktree, removeWorktree } from "../../src/git/worktree-manager.js";
import { runCoreLoop } from "../../src/pipeline/core-loop.js";
import { installDependencies } from "../../src/pipeline/dependency-installer.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { runFinalValidation } from "../../src/pipeline/final-validator.js";
import { runReviews } from "../../src/review/review-orchestrator.js";
import { runSimplify } from "../../src/review/simplify-runner.js";
import { getDiffContent } from "../../src/git/diff-collector.js";
import { validateIssue, validatePlan, validateBeforePush } from "../../src/safety/safety-checker.js";

const mockFetchIssue = vi.mocked(fetchIssue);
const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockSyncBase = vi.mocked(syncBaseBranch);
const mockCreateBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
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

import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

function makeConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.projectName = "test";
  config.general.targetRoot = "/tmp/project";
  config.git.allowedRepos = ["test/repo"];
  return config;
}

function setupSuccessMocks() {
  mockFetchIssue.mockResolvedValue({ number: 42, title: "Fix bug", body: "Fix it", labels: [] });
  mockSyncBase.mockResolvedValue(undefined);
  mockCreateBranch.mockResolvedValue({ baseBranch: "master", workBranch: "ax/42-fix-bug" });
  mockCreateWorktree.mockResolvedValue({ path: "/tmp/wt/42-fix-bug", branch: "ax/42-fix-bug" });
  mockInstallDeps.mockResolvedValue(undefined);
  mockRunCli.mockResolvedValue({ stdout: "src/\n", stderr: "", exitCode: 0 });
  mockCoreLoop.mockResolvedValue({
    plan: {
      issueNumber: 42, title: "Fix bug", problemDefinition: "Bug fix",
      requirements: ["Fix"], affectedFiles: [], risks: [],
      phases: [{ index: 0, name: "Fix", description: "Fix it", targetFiles: [], commitStrategy: "", verificationCriteria: [] }],
      verificationPoints: [], stopConditions: [],
    },
    phaseResults: [{ phaseIndex: 0, phaseName: "Fix", success: true, commitHash: "abc12345", durationMs: 1000 }],
    success: true,
  });
  mockPushBranch.mockResolvedValue(undefined);
  mockCreateDraftPR.mockResolvedValue({ url: "https://github.com/test/repo/pull/1", number: 1 });
  mockRemoveWorktree.mockResolvedValue(undefined);
  mockGetDiffContent.mockResolvedValue("diff --git a/file.ts b/file.ts\n+new line");
  mockRunReviews.mockResolvedValue({ rounds: [], allPassed: true });
  mockRunSimplify.mockResolvedValue({ applied: false, linesRemoved: 0, linesAdded: 0, filesModified: [], testsPassed: true, rolledBack: false, summary: "No changes" });
  mockFinalValidation.mockResolvedValue({ success: true, checks: [{ name: "test", passed: true }] });
  mockValidateBeforePush.mockResolvedValue(undefined);
}

describe("runPipeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should run full pipeline successfully", async () => {
    setupSuccessMocks();
    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });
    expect(result.success).toBe(true);
    expect(result.state).toBe("DONE");
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
  });

  it("should fail if repo not in allowedRepos", async () => {
    const result = await runPipeline({
      issueNumber: 42,
      repo: "other/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });
    expect(result.success).toBe(false);
    expect(result.state).toBe("FAILED");
    expect(result.error).toContain("not configured");
  });

  it("should fail if core loop fails", async () => {
    setupSuccessMocks();
    mockCoreLoop.mockResolvedValue({
      plan: {
        issueNumber: 42, title: "Fix", problemDefinition: "Bug",
        requirements: [], affectedFiles: [], risks: [],
        phases: [{ index: 0, name: "Fix", description: "", targetFiles: [], commitStrategy: "", verificationCriteria: [] }],
        verificationPoints: [], stopConditions: [],
      },
      phaseResults: [{ phaseIndex: 0, phaseName: "Fix", success: false, error: "test failed", durationMs: 500 }],
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
  });

  it("should call pipeline steps in correct order", async () => {
    setupSuccessMocks();
    await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });
    // Verify call order via invocationCallOrder
    const fetchOrder = mockFetchIssue.mock.invocationCallOrder[0];
    const syncOrder = mockSyncBase.mock.invocationCallOrder[0];
    const createBranchOrder = mockCreateBranch.mock.invocationCallOrder[0];
    const createWorktreeOrder = mockCreateWorktree.mock.invocationCallOrder[0];
    const coreLoopOrder = mockCoreLoop.mock.invocationCallOrder[0];
    const pushOrder = mockPushBranch.mock.invocationCallOrder[0];
    const prOrder = mockCreateDraftPR.mock.invocationCallOrder[0];

    expect(fetchOrder).toBeLessThan(syncOrder);
    expect(syncOrder).toBeLessThan(createBranchOrder);
    expect(createBranchOrder).toBeLessThan(createWorktreeOrder);
    expect(createWorktreeOrder).toBeLessThan(coreLoopOrder);
    expect(coreLoopOrder).toBeLessThan(pushOrder);
    expect(pushOrder).toBeLessThan(prOrder);
  });
});
