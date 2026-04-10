import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitTask, GitTaskOptions, GitOperationType } from "../../src/tasks/git-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import { syncBaseBranch, createWorkBranch, checkConflicts, attemptRebase, deleteRemoteBranch, pushBranch } from "../../src/git/branch-manager.js";
import { autoCommitIfDirty, getHeadHash } from "../../src/git/commit-helper.js";
import { createDraftPR, enableAutoMerge } from "../../src/github/pr-creator.js";
import type { GitConfig, PrConfig, GhCliConfig } from "../../src/types/config.js";
import type { PrContext } from "../../src/github/pr-creator.js";

// Mock all git modules
vi.mock("../../src/git/branch-manager.js");
vi.mock("../../src/git/commit-helper.js");
vi.mock("../../src/github/pr-creator.js");
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockSyncBaseBranch = vi.mocked(syncBaseBranch);
const mockCreateWorkBranch = vi.mocked(createWorkBranch);
const mockCheckConflicts = vi.mocked(checkConflicts);
const mockAttemptRebase = vi.mocked(attemptRebase);
const mockDeleteRemoteBranch = vi.mocked(deleteRemoteBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockGetHeadHash = vi.mocked(getHeadHash);
const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockEnableAutoMerge = vi.mocked(enableAutoMerge);

describe("GitTask", () => {
  let gitConfig: GitConfig;
  let prConfig: PrConfig;
  let ghConfig: GhCliConfig;
  let prContext: PrContext;
  let baseOptions: Partial<GitTaskOptions>;

  beforeEach(() => {
    vi.clearAllMocks();

    gitConfig = {
      gitPath: "git",
      remoteAlias: "origin",
      defaultBaseBranch: "main",
      branchTemplate: "aq/{issueNumber}-{slug}",
      fetchDepth: 0,
    };

    prConfig = {
      titleTemplate: "[#{issueNumber}] {title}",
      bodyTemplate: "pr-body.md",
      targetBranch: "main",
      draft: true,
      linkIssue: true,
      labels: ["auto-generated"],
      assignees: [],
      reviewers: [],
      autoMerge: false,
      mergeMethod: "merge",
      deleteBranch: true,
    };

    ghConfig = {
      path: "gh",
      timeout: 30000,
    };

    prContext = {
      issueNumber: 123,
      issueTitle: "Test issue",
      repo: "owner/repo",
      plan: {
        problemDefinition: "Test problem",
        phases: [],
        requirements: ["Test requirement"],
        risks: ["Test risk"],
      },
      phaseResults: [],
      branchName: "aq/123-test-issue",
      baseBranch: "main",
      totalCostUsd: 0.1,
      instanceLabel: "test",
    };

    baseOptions = {
      gitConfig,
      cwd: "/test/path",
      issueNumber: 123,
      issueTitle: "Test issue",
      commitMessage: "Test commit",
      enableRollback: true,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("생성 및 기본 속성", () => {
    it("should create task with auto-generated ID", () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "branch",
        gitConfig,
      };
      const task = new GitTask(options);

      expect(task.id).toBeDefined();
      expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(task.type).toBe("git");
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should create task with custom ID", () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        id: "custom-git-task-id",
        operation: "branch",
        gitConfig,
      };
      const task = new GitTask(options);

      expect(task.id).toBe("custom-git-task-id");
      expect(task.type).toBe("git");
      expect(task.status).toBe(TaskStatus.PENDING);
    });
  });

  describe("Branch Operation", () => {
    it("should successfully execute branch operation", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "branch",
        gitConfig,
      };

      const branchInfo = { baseBranch: "main", workBranch: "aq/123-test-issue" };
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue(branchInfo);

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("branch");
      expect(result.branchInfo).toEqual(branchInfo);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockSyncBaseBranch).toHaveBeenCalledWith(gitConfig, { cwd: "/test/path" });
      expect(mockCreateWorkBranch).toHaveBeenCalledWith(gitConfig, 123, "Test issue", { cwd: "/test/path" });
    });

    it("should fail branch operation when required fields are missing", async () => {
      const options: GitTaskOptions = {
        operation: "branch",
        gitConfig,
        cwd: "/test/path",
        // Missing issueNumber and issueTitle
      };

      const task = new GitTask(options);

      await expect(task.run()).rejects.toThrow("Branch operation requires issueNumber, issueTitle, and cwd");
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("should perform rollback on branch operation failure", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "branch",
        gitConfig,
        enableRollback: true,
      };

      const branchInfo = { baseBranch: "main", workBranch: "aq/123-test-issue" };
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue(branchInfo);
      mockDeleteRemoteBranch.mockResolvedValue(undefined);

      const task = new GitTask(options);

      // Mock an error after branch creation
      mockSyncBaseBranch.mockRejectedValue(new Error("Sync failed"));

      await expect(task.run()).rejects.toThrow("Sync failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("Commit Operation", () => {
    it("should successfully execute commit operation", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "commit",
        gitConfig,
        commitMessage: "Test commit message",
      };

      const originalHash = "abc123";
      const newCommitHash = "def456";
      mockGetHeadHash.mockResolvedValue(originalHash);
      mockAutoCommitIfDirty.mockResolvedValue(newCommitHash);

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("commit");
      expect(result.commitHash).toBe(newCommitHash);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockGetHeadHash).toHaveBeenCalledWith(gitConfig.gitPath, "/test/path");
      expect(mockAutoCommitIfDirty).toHaveBeenCalledWith(gitConfig.gitPath, "/test/path", "Test commit message");
    });

    it("should handle no changes to commit", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "commit",
        gitConfig,
        commitMessage: "Test commit message",
      };

      const originalHash = "abc123";
      mockGetHeadHash.mockResolvedValue(originalHash);
      mockAutoCommitIfDirty.mockResolvedValue(undefined); // No changes

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("commit");
      expect(result.commitHash).toBe(originalHash);
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("should fail commit operation when required fields are missing", async () => {
      const options: GitTaskOptions = {
        operation: "commit",
        gitConfig,
        cwd: "/test/path",
        // Missing commitMessage
      };

      const task = new GitTask(options);

      await expect(task.run()).rejects.toThrow("Commit operation requires commitMessage and cwd");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("Push Operation", () => {
    it("should successfully execute push operation without conflicts", async () => {
      const branchInfo = { baseBranch: "main", workBranch: "aq/123-test-issue" };
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "push",
        gitConfig,
        existingBranchInfo: branchInfo,
      };

      const conflictInfo = { hasConflicts: false, conflictFiles: [] };
      mockCheckConflicts.mockResolvedValue(conflictInfo);
      mockPushBranch.mockResolvedValue(undefined);

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("push");
      expect(result.conflictInfo).toEqual(conflictInfo);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockCheckConflicts).toHaveBeenCalledWith(gitConfig, "main", { cwd: "/test/path" });
      expect(mockPushBranch).toHaveBeenCalledWith(gitConfig, "aq/123-test-issue", { cwd: "/test/path" });
    });

    it("should handle conflicts with successful rebase", async () => {
      const branchInfo = { baseBranch: "main", workBranch: "aq/123-test-issue" };
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "push",
        gitConfig,
        existingBranchInfo: branchInfo,
      };

      const conflictInfo = { hasConflicts: true, conflictFiles: ["file1.ts"] };
      mockCheckConflicts.mockResolvedValue(conflictInfo);
      mockAttemptRebase.mockResolvedValue({ success: true });
      mockPushBranch.mockResolvedValue(undefined);

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("push");
      expect(result.conflictInfo).toEqual(conflictInfo);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockAttemptRebase).toHaveBeenCalledWith(gitConfig, "main", { cwd: "/test/path" });
    });

    it("should fail push operation when rebase fails", async () => {
      const branchInfo = { baseBranch: "main", workBranch: "aq/123-test-issue" };
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "push",
        gitConfig,
        existingBranchInfo: branchInfo,
      };

      const conflictInfo = { hasConflicts: true, conflictFiles: ["file1.ts"] };
      mockCheckConflicts.mockResolvedValue(conflictInfo);
      mockAttemptRebase.mockResolvedValue({ success: false, error: "Rebase failed" });

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(false);
      expect(result.operation).toBe("push");
      expect(result.conflictInfo).toEqual(conflictInfo);
      expect(result.error).toBe("Rebase failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("should fail push operation when required fields are missing", async () => {
      const options: GitTaskOptions = {
        operation: "push",
        gitConfig,
        cwd: "/test/path",
        // Missing existingBranchInfo
      };

      const task = new GitTask(options);

      await expect(task.run()).rejects.toThrow("Push operation requires existingBranchInfo and cwd");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("PR Operation", () => {
    it("should successfully execute PR operation", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "pr",
        gitConfig,
        prConfig,
        ghConfig,
        prContext,
        promptsDir: "/prompts",
        dryRun: false,
      };

      const prResult = { url: "https://github.com/owner/repo/pull/1", number: 1 };
      mockCreateDraftPR.mockResolvedValue(prResult);

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("pr");
      expect(result.prResult).toEqual(prResult);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockCreateDraftPR).toHaveBeenCalledWith(prConfig, ghConfig, prContext, {
        cwd: "/test/path",
        promptsDir: "/prompts",
        dryRun: false,
      });
    });

    it("should enable auto-merge when configured", async () => {
      const autoMergePrConfig = {
        ...prConfig,
        autoMerge: true,
        mergeMethod: "merge" as const,
        deleteBranch: true,
      };

      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "pr",
        gitConfig,
        prConfig: autoMergePrConfig,
        ghConfig,
        prContext,
        promptsDir: "/prompts",
        dryRun: false,
      };

      const prResult = { url: "https://github.com/owner/repo/pull/1", number: 1 };
      mockCreateDraftPR.mockResolvedValue(prResult);
      mockEnableAutoMerge.mockResolvedValue(true);

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("pr");
      expect(result.prResult).toEqual(prResult);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockEnableAutoMerge).toHaveBeenCalledWith(1, "owner/repo", "merge", {
        ghPath: ghConfig.path,
        dryRun: false,
        isDraft: true,
        deleteBranch: true,
      });
    });

    it("should fail PR operation when PR creation fails", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "pr",
        gitConfig,
        prConfig,
        ghConfig,
        prContext,
        promptsDir: "/prompts",
        dryRun: false,
      };

      mockCreateDraftPR.mockResolvedValue(null);

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(false);
      expect(result.operation).toBe("pr");
      expect(result.error).toBe("Failed to create PR");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("Full Workflow Operation", () => {
    it("should successfully execute full workflow", async () => {
      const branchInfo = { baseBranch: "main", workBranch: "aq/123-test-issue" };
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "full-workflow",
        gitConfig,
        prConfig,
        ghConfig,
        prContext,
        promptsDir: "/prompts",
        existingBranchInfo: branchInfo,
      };

      // Mock all operations to succeed
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue(branchInfo);
      mockGetHeadHash.mockResolvedValue("abc123");
      mockAutoCommitIfDirty.mockResolvedValue("def456");
      mockCheckConflicts.mockResolvedValue({ hasConflicts: false, conflictFiles: [] });
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({ url: "https://github.com/owner/repo/pull/1", number: 1 });

      const task = new GitTask(options);
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("full-workflow");
      expect(result.branchInfo).toEqual(branchInfo);
      expect(result.commitHash).toBe("def456");
      expect(result.prResult).toEqual({ url: "https://github.com/owner/repo/pull/1", number: 1 });
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });
  });

  describe("Task Kill and Rollback", () => {
    it("should kill task and perform rollback", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "branch",
        gitConfig,
        enableRollback: true,
      };

      mockDeleteRemoteBranch.mockResolvedValue(undefined);

      const task = new GitTask(options);

      // Set task to running state
      task["_status"] = TaskStatus.RUNNING;

      await task.kill();

      expect(task.status).toBe(TaskStatus.KILLED);
    });

    it("should manually trigger rollback", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "branch",
        gitConfig,
        enableRollback: true,
      };

      const task = new GitTask(options);
      mockDeleteRemoteBranch.mockResolvedValue(undefined);

      // Set up rollback data to simulate a branch was created
      task["_rollbackData"].branchCreated = "aq/123-test-issue";

      await task.rollback();

      // Verify rollback was called (implementation details may vary)
      expect(mockDeleteRemoteBranch).toHaveBeenCalledWith(
        gitConfig,
        "aq/123-test-issue",
        { cwd: "/test/path" }
      );
    });
  });

  describe("JSON Serialization", () => {
    it("should serialize task to JSON", () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "branch",
        gitConfig,
      };

      const task = new GitTask(options);
      const json = task.toJSON();

      expect(json.id).toBe(task.id);
      expect(json.type).toBe("git");
      expect(json.status).toBe(TaskStatus.PENDING);
      expect(json.metadata?.operation).toBe("branch");
      expect(json.metadata?.issueNumber).toBe(123);
      expect(json.metadata?.issueTitle).toBe("Test issue");
    });

    it("should restore task from JSON", () => {
      const serializedTask = {
        id: "test-task-id",
        type: "git" as const,
        status: TaskStatus.PENDING,
        metadata: {
          operation: "branch",
          issueNumber: 123,
          issueTitle: "Test issue",
          enableRollback: true,
        },
      };

      const task = GitTask.fromJSON(serializedTask, gitConfig);

      expect(task.id).toBe("test-task-id");
      expect(task.type).toBe("git");
      expect(task.status).toBe(TaskStatus.PENDING);
    });
  });

  describe("Event Listeners", () => {
    it("should support event listeners", async () => {
      const options: GitTaskOptions = {
        ...baseOptions,
        operation: "branch",
        gitConfig,
      };

      const branchInfo = { baseBranch: "main", workBranch: "aq/123-test-issue" };
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue(branchInfo);

      const task = new GitTask(options);
      const startedSpy = vi.fn();
      const completedSpy = vi.fn();

      task.on("started", startedSpy);
      task.on("completed", completedSpy);

      await task.run();

      expect(startedSpy).toHaveBeenCalled();
      expect(completedSpy).toHaveBeenCalled();
    });
  });
});