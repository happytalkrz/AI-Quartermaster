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
  closeIssue: vi.fn(),
  commentOnIssue: vi.fn(),
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
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../src/pipeline/pipeline-setup.js", () => ({
  resolveResolvedProject: vi.fn(),
  checkDuplicatePR: vi.fn(),
  fetchAndValidateIssue: vi.fn(),
}));

import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { fetchIssue } from "../../src/github/issue-fetcher.js";
import { createDraftPR, enableAutoMerge, closeIssue, commentOnIssue } from "../../src/github/pr-creator.js";
import { syncBaseBranch, createWorkBranch, pushBranch, checkConflicts, attemptRebase } from "../../src/git/branch-manager.js";
import { createWorktree, removeWorktree } from "../../src/git/worktree-manager.js";
import { runCoreLoop } from "../../src/pipeline/core-loop.js";
import { installDependencies } from "../../src/pipeline/dependency-installer.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { runFinalValidation } from "../../src/pipeline/final-validator.js";
import { runReviews } from "../../src/review/review-orchestrator.js";
import { runSimplify } from "../../src/review/simplify-runner.js";
import { getDiffContent } from "../../src/git/diff-collector.js";
import { validateIssue, validatePlan, validateBeforePush } from "../../src/safety/safety-checker.js";
import { resolveResolvedProject, checkDuplicatePR, fetchAndValidateIssue } from "../../src/pipeline/pipeline-setup.js";

const mockFetchIssue = vi.mocked(fetchIssue);
const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockSyncBase = vi.mocked(syncBaseBranch);
const mockCreateBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockCheckConflicts = vi.mocked(checkConflicts);
const mockAttemptRebase = vi.mocked(attemptRebase);
const mockEnableAutoMerge = vi.mocked(enableAutoMerge);
const mockCloseIssue = vi.mocked(closeIssue);
const mockCommentOnIssue = vi.mocked(commentOnIssue);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockRemoveWorktree = vi.mocked(removeWorktree);
const mockCoreLoop = vi.mocked(runCoreLoop);
const mockInstallDeps = vi.mocked(installDependencies);
const mockRunCli = vi.mocked(runCli);
const mockRunClaude = vi.mocked(runClaude);
const mockRunReviews = vi.mocked(runReviews);
const mockRunSimplify = vi.mocked(runSimplify);
const mockFinalValidation = vi.mocked(runFinalValidation);
const mockGetDiffContent = vi.mocked(getDiffContent);
const mockValidateBeforePush = vi.mocked(validateBeforePush);
const mockResolveResolvedProject = vi.mocked(resolveResolvedProject);
const mockCheckDuplicatePR = vi.mocked(checkDuplicatePR);
const mockFetchAndValidateIssue = vi.mocked(fetchAndValidateIssue);

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
  mockRunClaude.mockResolvedValue(undefined);
  mockCoreLoop.mockResolvedValue({
    plan: {
      issueNumber: 42, title: "Fix bug", problemDefinition: "Bug fix",
      requirements: ["Fix"], affectedFiles: [], risks: [],
      phases: [{ index: 0, name: "Fix", description: "Fix it", targetFiles: [], commitStrategy: "", verificationCriteria: [], dependsOn: [] }],
      verificationPoints: [], stopConditions: [],
    },
    phaseResults: [{ phaseIndex: 0, phaseName: "Fix", success: true, commitHash: "abc12345", durationMs: 1000 }],
    success: true,
  });
  mockPushBranch.mockResolvedValue(undefined);
  mockCheckConflicts.mockResolvedValue({ hasConflicts: false, conflictFiles: [] });
  mockAttemptRebase.mockResolvedValue({ success: true });
  mockEnableAutoMerge.mockResolvedValue(true);
  mockCloseIssue.mockResolvedValue(true);
  mockCreateDraftPR.mockResolvedValue({ url: "https://github.com/test/repo/pull/1", number: 1 });
  mockRemoveWorktree.mockResolvedValue(undefined);
  mockGetDiffContent.mockResolvedValue("diff --git a/file.ts b/file.ts\n+new line");
  mockRunReviews.mockResolvedValue({ rounds: [], allPassed: true });
  mockRunSimplify.mockResolvedValue({ applied: false, linesRemoved: 0, linesAdded: 0, filesModified: [], testsPassed: true, rolledBack: false, summary: "No changes" });
  mockFinalValidation.mockResolvedValue({ success: true, checks: [{ name: "test", passed: true }] });
  mockValidateBeforePush.mockResolvedValue(undefined);
  mockCommentOnIssue.mockResolvedValue(undefined);
  mockResolveResolvedProject.mockReturnValue({
    projectRoot: "/tmp/project",
    promptsDir: "/tmp/project/prompts",
    gitConfig: {
      gitPath: "git",
      allowedRepos: ["test/repo"],
      autoCreateBranch: true,
      defaultBaseBranch: "main",
      branchTemplate: "ax/{issue-number}-{slug}",
    },
  });
  mockCheckDuplicatePR.mockResolvedValue({ hasDuplicatePR: false });
  mockFetchAndValidateIssue.mockResolvedValue({
    issue: { number: 42, title: "Fix bug", body: "Fix it", labels: [] },
    mode: "code",
    checkpoint: vi.fn(),
  });
}

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunClaude.mockResolvedValue(undefined);
  });

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
        phases: [{ index: 0, name: "Fix", description: "", targetFiles: [], commitStrategy: "", verificationCriteria: [], dependsOn: [] }],
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
    const fetchOrder = mockFetchAndValidateIssue.mock.invocationCallOrder[0];
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

  it("should close issue after PR creation", async () => {
    setupSuccessMocks();
    await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });
    expect(mockCloseIssue).toHaveBeenCalledWith(42, "test/repo", expect.objectContaining({
      ghPath: expect.any(String),
      dryRun: false,
    }));
  });

  it("should continue pipeline even if issue close fails", async () => {
    setupSuccessMocks();
    mockCloseIssue.mockResolvedValue(false);
    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });
    expect(result.success).toBe(true);
    expect(result.state).toBe("DONE");
    // Verify closeIssue was called with correct parameters even though it returned false
    expect(mockCloseIssue).toHaveBeenCalledWith(42, "test/repo", expect.objectContaining({
      ghPath: expect.any(String),
      dryRun: false,
    }));
    // Pipeline should still produce a PR URL despite issue close failure
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
  });

  describe("review fix loop", () => {
    it("should succeed on first fix attempt", async () => {
      setupSuccessMocks();

      // First review fails with error findings
      mockRunReviews
        .mockResolvedValueOnce({
          rounds: [{
            roundName: "basic",
            verdict: "FAIL",
            findings: [{ severity: "error", message: "Missing validation", file: "src/test.ts", line: 10 }],
            summary: "Validation missing",
            durationMs: 1000
          }],
          allPassed: false
        })
        // Second review (after fix) passes
        .mockResolvedValueOnce({
          rounds: [{
            roundName: "basic",
            verdict: "PASS",
            findings: [],
            summary: "All good",
            durationMs: 800
          }],
          allPassed: true,
          fixAttempts: [{
            attempt: 1,
            findingsSnapshot: {
              reviewFindings: [{ severity: "error", message: "Missing validation", file: "src/test.ts", line: 10 }]
            },
            fixResult: {
              success: true,
              filesModified: [],
              summary: "Fixed 1 issues"
            }
          }]
        });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("DONE");
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
      expect(mockRunReviews).toHaveBeenCalledTimes(2); // Initial + 1 retry
      // Both runReviews calls should pass the review config and worktree path
      expect(mockRunReviews).toHaveBeenNthCalledWith(1, expect.objectContaining({
        reviewConfig: expect.any(Object),
        cwd: expect.any(String),
        promptsDir: expect.any(String),
      }));
      expect(mockRunReviews).toHaveBeenNthCalledWith(2, expect.objectContaining({
        reviewConfig: expect.any(Object),
        cwd: expect.any(String),
        promptsDir: expect.any(String),
      }));
      // Claude fix prompt must reference the specific finding from the failed review
      expect(mockRunClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Missing validation")
        })
      );
    });

    it("should succeed on second fix attempt", async () => {
      setupSuccessMocks();

      // First review fails
      mockRunReviews
        .mockResolvedValueOnce({
          rounds: [{
            roundName: "basic",
            verdict: "FAIL",
            findings: [{ severity: "error", message: "Logic error", file: "src/logic.ts", line: 5 }],
            summary: "Logic issues",
            durationMs: 1000
          }],
          allPassed: false
        })
        // First retry still fails
        .mockResolvedValueOnce({
          rounds: [{
            roundName: "basic",
            verdict: "FAIL",
            findings: [{ severity: "error", message: "Still has error", file: "src/logic.ts", line: 5 }],
            summary: "Still failing",
            durationMs: 900
          }],
          allPassed: false
        })
        // Second retry passes
        .mockResolvedValueOnce({
          rounds: [{
            roundName: "basic",
            verdict: "PASS",
            findings: [],
            summary: "Fixed",
            durationMs: 700
          }],
          allPassed: true,
          fixAttempts: [
            {
              attempt: 1,
              findingsSnapshot: {
                reviewFindings: [{ severity: "error", message: "Logic error", file: "src/logic.ts", line: 5 }]
              },
              fixResult: {
                success: false,
                filesModified: [],
                summary: "Fixed 1 issues"
              }
            },
            {
              attempt: 2,
              findingsSnapshot: {
                reviewFindings: [{ severity: "error", message: "Still has error", file: "src/logic.ts", line: 5 }]
              },
              fixResult: {
                success: true,
                filesModified: [],
                summary: "Fixed 1 issues"
              }
            }
          ]
        });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("DONE");
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
      expect(mockRunReviews).toHaveBeenCalledTimes(3); // Initial + 2 retries
      // All three runReviews calls should target the same worktree
      const [firstCall, secondCall, thirdCall] = mockRunReviews.mock.calls;
      expect(firstCall[0]).toMatchObject({ reviewConfig: expect.any(Object), cwd: expect.any(String) });
      expect(secondCall[0]).toMatchObject({ reviewConfig: expect.any(Object), cwd: expect.any(String) });
      expect(thirdCall[0]).toMatchObject({ reviewConfig: expect.any(Object), cwd: expect.any(String) });
      // All calls should use the same worktree path (consistent cwd)
      expect(firstCall[0].cwd).toBe(secondCall[0].cwd);
      expect(secondCall[0].cwd).toBe(thirdCall[0].cwd);
      // Claude should have been invoked for each failed review attempt
      expect(mockRunClaude).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries exhausted", async () => {
      setupSuccessMocks();

      // Configure max retries = 2
      const config = makeConfig();
      config.safety.maxRetries = 2;

      // All reviews fail
      mockRunReviews.mockResolvedValue({
        rounds: [{
          roundName: "basic",
          verdict: "FAIL",
          findings: [{ severity: "error", message: "Persistent error", file: "src/bad.ts", line: 1 }],
          summary: "Always failing",
          durationMs: 1000
        }],
        allPassed: false,
        fixAttempts: [
          {
            attempt: 1,
            findingsSnapshot: {
              reviewFindings: [{ severity: "error", message: "Persistent error", file: "src/bad.ts", line: 1 }]
            },
            fixResult: {
              success: false,
              filesModified: [],
              summary: "Fixed 1 issues"
            }
          },
          {
            attempt: 2,
            findingsSnapshot: {
              reviewFindings: [{ severity: "error", message: "Persistent error", file: "src/bad.ts", line: 1 }]
            },
            fixResult: {
              success: false,
              filesModified: [],
              summary: "Fixed 1 issues"
            }
          }
        ]
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config,
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(result.error).toContain("Review failed after 2 retries");
      // Error message should include the specific finding that kept failing
      expect(result.error).toContain("Persistent error");
      expect(mockRunReviews).toHaveBeenCalledTimes(3); // Initial + 2 retries
      // No PR should be created when review ultimately fails
      expect(result.prUrl).toBeUndefined();
      expect(mockCreateDraftPR).not.toHaveBeenCalled();
      // closeIssue should NOT be called since we never reached PR creation
      expect(mockCloseIssue).not.toHaveBeenCalled();
    });

    it("should include critical analyst issues in fix loop", async () => {
      setupSuccessMocks();

      // Mock analyst to return critical findings
      vi.mocked(mockRunReviews).mockImplementation(async (ctx) => {
        // First call - both analyst and review fail
        return {
          analyst: {
            verdict: "INCOMPLETE",
            findings: [
              { type: "missing", requirement: "Error handling", severity: "error", message: "Missing error handling", suggestion: "Add try-catch" },
            ],
            summary: "Requirements not met",
            coverage: { implemented: [], missing: ["Error handling"], excess: [] },
            durationMs: 1200
          },
          rounds: [{
            roundName: "basic",
            verdict: "FAIL",
            findings: [{ severity: "error", message: "Type error", file: "src/types.ts", line: 20 }],
            summary: "Type issues",
            durationMs: 1000
          }],
          allPassed: false
        };
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe("FAILED");
      expect(mockRunClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Type error")
        })
      );
    });
  });

  it("should fail if PR creation succeeds but prUrl is missing", async () => {
    setupSuccessMocks();
    // Mock successful execution but missing prUrl
    mockCreateDraftPR.mockResolvedValue({ url: undefined, number: 1 });

    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    expect(result.success).toBe(false);
    expect(result.state).toBe("FAILED");
    expect(result.error).toContain("Pipeline completed but failed to create PR URL");
    expect(result.prUrl).toBeUndefined();
  });

  it("should fail if executePostProcessingPhases returns undefined prUrl", async () => {
    setupSuccessMocks();
    // Setup all mocks but don't call setupSuccessMocks for createDraftPR
    mockCreateDraftPR.mockResolvedValue({ url: "", number: 1 }); // Empty string should also fail

    const result = await runPipeline({
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    });

    expect(result.success).toBe(false);
    expect(result.state).toBe("FAILED");
    expect(result.error).toContain("Pipeline completed but failed to create PR URL");
  });

  describe("feasibility check integration", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should skip issue when feasibility check fails due to too many requirements", async () => {
      // Setup config with strict feasibility limits
      const config = makeConfig();
      config.safety = {
        ...config.safety,
        feasibilityCheck: {
          enabled: true,
          maxRequirements: 3,
          maxFiles: 4,
          blockedKeywords: ["architecture", "refactor"],
          skipReasons: ["Too many requirements", "Too many files", "Blocked keyword found"]
        }
      };

      // Mock issue with too many requirements
      const issueWithManyRequirements = {
        number: 42,
        title: "Complex Feature",
        body: `
## Requirements
- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3
- [ ] Requirement 4
- [ ] Requirement 5
        `,
        labels: []
      };

      // Setup basic mocks that are needed before feasibility check
      mockResolveResolvedProject.mockReturnValue({
        projectRoot: "/tmp/project",
        promptsDir: "/tmp/project/prompts",
        gitConfig: {
          gitPath: "git",
          allowedRepos: ["test/repo"],
          autoCreateBranch: true,
          defaultBaseBranch: "main",
          branchTemplate: "ax/{issue-number}-{slug}",
        },
      });
      mockCheckDuplicatePR.mockResolvedValue({ hasDuplicatePR: false });
      mockFetchAndValidateIssue.mockResolvedValue({
        issue: issueWithManyRequirements,
        mode: "code",
        checkpoint: vi.fn(),
      });

      // Setup mock for commentOnIssue
      mockCommentOnIssue.mockResolvedValue(undefined);

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config,
        projectRoot: "/tmp/project",
      });

      // Should return success with SKIPPED state
      expect(result.success).toBe(true);
      expect(result.state).toBe("SKIPPED");
      expect(result.error).toContain("Too many requirements");

      // Should not create PR or proceed with pipeline execution
      expect(mockCreateDraftPR).not.toHaveBeenCalled();
      expect(mockCoreLoop).not.toHaveBeenCalled();

      // Should have a report
      expect(result.report).toBeDefined();
    });

    it("should skip issue when blocked keyword is detected", async () => {
      const config = makeConfig();
      config.safety = {
        ...config.safety,
        feasibilityCheck: {
          enabled: true,
          maxRequirements: 10,
          maxFiles: 10,
          blockedKeywords: ["architecture", "refactor", "migration"],
          skipReasons: ["Blocked keyword found"]
        }
      };

      const issueWithBlockedKeyword = {
        number: 42,
        title: "Architecture Refactor",
        body: "Need to refactor the entire architecture for better performance",
        labels: []
      };

      mockResolveResolvedProject.mockReturnValue({
        projectRoot: "/tmp/project",
        promptsDir: "/tmp/project/prompts",
        gitConfig: {
          gitPath: "git",
          allowedRepos: ["test/repo"],
          autoCreateBranch: true,
          defaultBaseBranch: "main",
          branchTemplate: "ax/{issue-number}-{slug}",
        },
      });
      mockCheckDuplicatePR.mockResolvedValue({ hasDuplicatePR: false });
      mockFetchAndValidateIssue.mockResolvedValue({
        issue: issueWithBlockedKeyword,
        mode: "code",
        checkpoint: vi.fn(),
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config,
        projectRoot: "/tmp/project",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("SKIPPED");
      expect(result.error).toContain("Blocked keywords found");
      expect(result.error).toContain("architecture");
      expect(result.error).toContain("refactor");
    });

    it("should proceed normally when feasibility check is disabled", async () => {
      const config = makeConfig();
      config.safety = {
        ...config.safety,
        feasibilityCheck: {
          enabled: false,
          maxRequirements: 1, // Very strict limits that would fail if enabled
          maxFiles: 1,
          blockedKeywords: ["architecture"],
          skipReasons: []
        }
      };

      const issueWithManyRequirements = {
        number: 42,
        title: "Architecture Change",
        body: `
## Requirements
- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3
- [ ] Requirement 4
- [ ] Requirement 5
Need to change the architecture
        `,
        labels: []
      };

      // Setup all success mocks
      setupSuccessMocks();
      mockFetchAndValidateIssue.mockResolvedValue({
        issue: issueWithManyRequirements,
        mode: "code",
        checkpoint: vi.fn(),
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config,
        projectRoot: "/tmp/project",
      });

      // Should succeed despite having conditions that would fail feasibility check
      expect(result.success).toBe(true);
      expect(result.state).toBe("DONE");
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");

      // Should have proceeded with normal pipeline execution
      expect(mockCoreLoop).toHaveBeenCalled();
      expect(mockCreateDraftPR).toHaveBeenCalled();
    });

    it("should proceed normally when feasibility check passes", async () => {
      const config = makeConfig();
      config.safety = {
        ...config.safety,
        feasibilityCheck: {
          enabled: true,
          maxRequirements: 10,
          maxFiles: 10,
          blockedKeywords: ["migration"],
          skipReasons: []
        }
      };

      const feasibleIssue = {
        number: 42,
        title: "Simple Bug Fix",
        body: `
## Requirements
- [ ] Fix the button click handler
- [ ] Add test for the fix

Files to change: src/components/Button.tsx
        `,
        labels: []
      };

      setupSuccessMocks();
      mockFetchAndValidateIssue.mockResolvedValue({
        issue: feasibleIssue,
        mode: "code",
        checkpoint: vi.fn(),
      });

      const result = await runPipeline({
        issueNumber: 42,
        repo: "test/repo",
        config,
        projectRoot: "/tmp/project",
      });

      // Should succeed with normal pipeline execution
      expect(result.success).toBe(true);
      expect(result.state).toBe("DONE");
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");

      // Should have proceeded with core loop and PR creation
      expect(mockCoreLoop).toHaveBeenCalled();
      expect(mockCreateDraftPR).toHaveBeenCalled();
    });
  });
});
