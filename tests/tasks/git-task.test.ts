import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitTask, GitTaskOptions, GitTaskStep } from "../../src/tasks/git-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { GitConfig, PrConfig, GhCliConfig } from "../../src/types/config.js";
import type { Plan, PhaseResult } from "../../src/types/pipeline.js";

// Mock the git modules
vi.mock("../../src/git/branch-manager.js", () => ({
  syncBaseBranch: vi.fn(),
  createWorkBranch: vi.fn(),
  pushBranch: vi.fn(),
  deleteRemoteBranch: vi.fn(),
  checkConflicts: vi.fn(),
}));

vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
}));

vi.mock("../../src/github/pr-creator.js", () => ({
  createDraftPR: vi.fn(),
}));

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  syncBaseBranch,
  createWorkBranch,
  pushBranch,
  deleteRemoteBranch,
} from "../../src/git/branch-manager.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";
import { createDraftPR } from "../../src/github/pr-creator.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockSyncBaseBranch = vi.mocked(syncBaseBranch);
const mockCreateWorkBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockDeleteRemoteBranch = vi.mocked(deleteRemoteBranch);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockRunCli = vi.mocked(runCli);

function makeGitConfig(): GitConfig {
  return {
    defaultBaseBranch: "main",
    branchTemplate: "aq/{issueNumber}-{slug}",
    commitMessageTemplate: "feat: implement #{issueNumber}",
    remoteAlias: "origin",
    allowedRepos: ["test/repo"],
    gitPath: "git",
    fetchDepth: 100,
    signCommits: false,
  };
}

function makePrConfig(): PrConfig {
  return {
    targetBranch: "main",
    draft: true,
    titleTemplate: "[#{issueNumber}] {title}",
    bodyTemplate: "pr-template.md",
    labels: ["automated"],
    assignees: [],
    reviewers: [],
    linkIssue: true,
    autoMerge: false,
    mergeMethod: "squash",
    deleteBranch: true,
  };
}

function makeGhConfig(): GhCliConfig {
  return {
    path: "gh",
    timeout: 30000,
  };
}

function makePlan(): Plan {
  return {
    issueNumber: 123,
    title: "Test issue",
    problemDefinition: "Test problem",
    requirements: ["Implement feature"],
    affectedFiles: ["src/test.ts"],
    risks: [],
    phases: [
      {
        index: 0,
        name: "Implementation",
        description: "Implement the feature",
        targetFiles: ["src/test.ts"],
        commitStrategy: "single",
        verificationCriteria: [],
      }
    ],
    verificationPoints: [],
    stopConditions: [],
  };
}

function makePhaseResults(): PhaseResult[] {
  return [
    {
      phaseIndex: 0,
      phaseName: "Implementation",
      success: true,
      commitHash: "abc123",
      durationMs: 5000,
    }
  ];
}

function makeOptions(overrides: Partial<GitTaskOptions> = {}): GitTaskOptions {
  return {
    issueNumber: 123,
    issueTitle: "Test issue",
    repo: "test/repo",
    gitConfig: makeGitConfig(),
    prConfig: makePrConfig(),
    ghConfig: makeGhConfig(),
    plan: makePlan(),
    phaseResults: makePhaseResults(),
    promptsDir: "/fake/prompts",
    cwd: "/fake/cwd",
    ...overrides,
  };
}

describe("GitTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 생성 및 기본 속성
  // ---------------------------------------------------------------------------
  describe("생성 및 기본 속성", () => {
    it("should auto-generate UUID when id is not provided", () => {
      const task = new GitTask(makeOptions());

      expect(task.id).toBeDefined();
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("should use provided id", () => {
      const task = new GitTask(makeOptions({ id: "my-git-task" }));
      expect(task.id).toBe("my-git-task");
    });

    it("should have type = 'git'", () => {
      const task = new GitTask(makeOptions());
      expect(task.type).toBe("git");
    });

    it("should start with PENDING status", () => {
      const task = new GitTask(makeOptions());
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should use all steps by default", () => {
      const task = new GitTask(makeOptions());
      const json = task.toJSON();
      expect(json.metadata?.steps).toEqual([
        "sync-base",
        "create-branch",
        "commit-changes",
        "push-branch",
        "create-pr"
      ]);
    });

    it("should use custom steps when provided", () => {
      const task = new GitTask(makeOptions({ steps: ["create-branch", "commit-changes"] }));
      const json = task.toJSON();
      expect(json.metadata?.steps).toEqual(["create-branch", "commit-changes"]);
    });
  });

  // ---------------------------------------------------------------------------
  // 성공 시나리오
  // ---------------------------------------------------------------------------
  describe("성공 시나리오", () => {
    it("should execute all steps successfully", async () => {
      // Mock all module functions to succeed
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({
        url: "https://github.com/test/repo/pull/456",
        number: 456
      });

      const task = new GitTask(makeOptions());
      const results = await task.run();

      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(results).toHaveLength(5);
      expect(results.every(r => r.success)).toBe(true);

      // Verify all steps were called
      expect(mockSyncBaseBranch).toHaveBeenCalledWith(
        makeGitConfig(),
        { cwd: "/fake/cwd" }
      );
      expect(mockCreateWorkBranch).toHaveBeenCalledWith(
        makeGitConfig(),
        123,
        "Test issue",
        { cwd: "/fake/cwd" }
      );
      expect(mockAutoCommitIfDirty).toHaveBeenCalled();
      expect(mockPushBranch).toHaveBeenCalled();
      expect(mockCreateDraftPR).toHaveBeenCalled();

      // Check results
      expect(task.getBranchInfo()).toEqual({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      expect(task.getCommitHash()).toBe("commit123");
      expect(task.getPrResult()).toEqual({
        url: "https://github.com/test/repo/pull/456",
        number: 456
      });
    });

    it("should handle commit with no changes", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue(undefined); // No changes
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({
        url: "https://github.com/test/repo/pull/456",
        number: 456
      });

      const task = new GitTask(makeOptions());
      const results = await task.run();

      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(task.getCommitHash()).toBeUndefined();
    });

    it("should execute only specified steps", async () => {
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");

      const task = new GitTask(makeOptions({
        steps: ["create-branch", "commit-changes"]
      }));
      const results = await task.run();

      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(results).toHaveLength(2);
      expect(results[0].step).toBe("create-branch");
      expect(results[1].step).toBe("commit-changes");

      // Verify only specified steps were called
      expect(mockSyncBaseBranch).not.toHaveBeenCalled();
      expect(mockCreateWorkBranch).toHaveBeenCalled();
      expect(mockAutoCommitIfDirty).toHaveBeenCalled();
      expect(mockPushBranch).not.toHaveBeenCalled();
      expect(mockCreateDraftPR).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 실패 시나리오 및 롤백
  // ---------------------------------------------------------------------------
  describe("실패 시나리오 및 롤백", () => {
    it("should fail and rollback when sync-base fails", async () => {
      mockSyncBaseBranch.mockRejectedValue(new Error("Failed to sync"));

      const task = new GitTask(makeOptions());

      await expect(task.run()).rejects.toThrow("Failed to sync");
      expect(task.status).toBe(TaskStatus.FAILED);

      const results = task.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].step).toBe("sync-base");
      expect(results[0].error).toBe("Failed to sync");
    });

    it("should fail and rollback when create-branch fails", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockRejectedValue(new Error("Branch creation failed"));
      mockDeleteRemoteBranch.mockResolvedValue(undefined); // Rollback

      const task = new GitTask(makeOptions());

      await expect(task.run()).rejects.toThrow("Branch creation failed");
      expect(task.status).toBe(TaskStatus.FAILED);

      // Should not attempt remote branch deletion since branch creation failed
      expect(mockDeleteRemoteBranch).not.toHaveBeenCalled();
    });

    it("should fail and rollback when commit fails", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockRejectedValue(new Error("Commit failed"));
      mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }); // Rollback git reset

      const task = new GitTask(makeOptions());

      await expect(task.run()).rejects.toThrow("Commit failed");
      expect(task.status).toBe(TaskStatus.FAILED);

      // Should not call git reset since no commit was made
      expect(mockRunCli).not.toHaveBeenCalled();
    });

    it("should fail and rollback when push fails", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockRejectedValue(new Error("Push failed"));
      mockDeleteRemoteBranch.mockResolvedValue(undefined); // Rollback

      const task = new GitTask(makeOptions());

      await expect(task.run()).rejects.toThrow("Push failed");
      expect(task.status).toBe(TaskStatus.FAILED);

      // Should attempt to delete remote branch if push created it
      expect(mockDeleteRemoteBranch).toHaveBeenCalledWith(
        makeGitConfig(),
        "aq/123-test-issue",
        { cwd: "/fake/cwd" }
      );
    });

    it("should fail when create-pr fails", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockRejectedValue(new Error("PR creation failed"));

      const task = new GitTask(makeOptions());

      await expect(task.run()).rejects.toThrow("PR creation failed");
      expect(task.status).toBe(TaskStatus.FAILED);

      // PR creation failure doesn't trigger rollback since it's idempotent
    });

    it("should handle rollback errors gracefully", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockRejectedValue(new Error("Push failed"));
      mockDeleteRemoteBranch.mockRejectedValue(new Error("Rollback failed")); // Rollback fails

      const task = new GitTask(makeOptions());

      // Should still throw original error, not rollback error
      await expect(task.run()).rejects.toThrow("Push failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  // ---------------------------------------------------------------------------
  // 중복 실행 방지
  // ---------------------------------------------------------------------------
  describe("중복 실행 방지", () => {
    it("should throw when run() is called on already-running task", async () => {
      mockSyncBaseBranch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const task = new GitTask(makeOptions());

      // 첫 번째 run은 대기 상태
      const runPromise = task.run();

      // 즉시 두 번째 run 시도
      await expect(task.run()).rejects.toThrow(/already RUNNING/);

      // 정리
      await task.kill();
      await Promise.race([runPromise, Promise.resolve()]);
    });

    it("should throw when run() is called on completed task", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({
        url: "https://github.com/test/repo/pull/456",
        number: 456
      });

      const task = new GitTask(makeOptions());
      await task.run();

      await expect(task.run()).rejects.toThrow(/already SUCCESS/);
    });
  });

  // ---------------------------------------------------------------------------
  // kill() 기능
  // ---------------------------------------------------------------------------
  describe("kill() 기능", () => {
    it("should set status to KILLED when task is running", async () => {
      mockSyncBaseBranch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const task = new GitTask(makeOptions());
      const runPromise = task.run();

      // 실행 중인 상태에서 kill
      await task.kill();

      expect(task.status).toBe(TaskStatus.KILLED);

      // 정리
      await Promise.race([runPromise, Promise.resolve()]);
    });

    it("should be no-op when task is PENDING", async () => {
      const task = new GitTask(makeOptions());

      await task.kill();

      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should be no-op when task is already SUCCESS", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({
        url: "https://github.com/test/repo/pull/456",
        number: 456
      });

      const task = new GitTask(makeOptions());
      await task.run();

      await task.kill();

      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("should attempt rollback of current step on kill", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockImplementation(() => new Promise(() => {})); // Never resolves
      mockDeleteRemoteBranch.mockResolvedValue(undefined); // Rollback

      const task = new GitTask(makeOptions());
      const runPromise = task.run();

      // Wait a bit to ensure we're in the create-branch step
      await new Promise(resolve => setTimeout(resolve, 10));

      await task.kill();

      expect(task.status).toBe(TaskStatus.KILLED);

      // Should not call rollback since branch creation was never completed
      expect(mockDeleteRemoteBranch).not.toHaveBeenCalled();

      // 정리
      await Promise.race([runPromise, Promise.resolve()]);
    });
  });

  // ---------------------------------------------------------------------------
  // toJSON() 및 메타데이터
  // ---------------------------------------------------------------------------
  describe("toJSON() 및 메타데이터", () => {
    it("should include id, type, status in JSON", () => {
      const task = new GitTask(makeOptions({ id: "gt-001" }));
      const json = task.toJSON();

      expect(json.id).toBe("gt-001");
      expect(json.type).toBe("git");
      expect(json.status).toBe(TaskStatus.PENDING);
    });

    it("should include git-specific metadata", () => {
      const task = new GitTask(makeOptions({ id: "gt-002" }));
      const json = task.toJSON();

      expect(json.metadata?.issueNumber).toBe(123);
      expect(json.metadata?.repo).toBe("test/repo");
      expect(json.metadata?.steps).toBeDefined();
      expect(json.metadata?.dryRun).toBe(undefined);
    });

    it("should include execution results in metadata after run", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({
        url: "https://github.com/test/repo/pull/456",
        number: 456
      });

      const task = new GitTask(makeOptions({ id: "gt-003" }));
      await task.run();

      const json = task.toJSON();

      expect(json.metadata?.branchName).toBe("aq/123-test-issue");
      expect(json.metadata?.baseBranch).toBe("main");
      expect(json.metadata?.commitHash).toBe("commit123");
      expect(json.metadata?.prUrl).toBe("https://github.com/test/repo/pull/456");
      expect(json.metadata?.prNumber).toBe(456);
      expect(json.durationMs).toBeGreaterThanOrEqual(0);
      expect(json.startedAt).toBeDefined();
      expect(json.completedAt).toBeDefined();
    });

    it("should include custom metadata", () => {
      const task = new GitTask(makeOptions({
        id: "gt-004",
        metadata: { customField: "value" }
      }));
      const json = task.toJSON();

      expect(json.metadata?.customField).toBe("value");
    });

    it("should show current step during execution", async () => {
      mockSyncBaseBranch.mockImplementation(async () => {
        const json = task.toJSON();
        expect(json.metadata?.currentStep).toBe("sync-base");
      });
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({
        url: "https://github.com/test/repo/pull/456",
        number: 456
      });

      const task = new GitTask(makeOptions({ id: "gt-005" }));
      await task.run();

      const json = task.toJSON();
      expect(json.metadata?.currentStep).toBeUndefined(); // Should be cleared after completion
    });
  });

  // ---------------------------------------------------------------------------
  // 에러 시나리오
  // ---------------------------------------------------------------------------
  describe("에러 시나리오", () => {
    it("should fail when branch info is missing for push step", async () => {
      const task = new GitTask(makeOptions({
        steps: ["push-branch"] // Skip create-branch
      }));

      await expect(task.run()).rejects.toThrow(/Branch info not available/);
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("should fail when branch info is missing for create-pr step", async () => {
      const task = new GitTask(makeOptions({
        steps: ["create-pr"] // Skip create-branch
      }));

      await expect(task.run()).rejects.toThrow(/Branch info not available/);
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("should handle unknown step gracefully", async () => {
      const task = new GitTask(makeOptions({
        steps: ["invalid-step" as GitTaskStep]
      }));

      await expect(task.run()).rejects.toThrow(/Unknown git task step: invalid-step/);
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  // ---------------------------------------------------------------------------
  // Dry run 모드
  // ---------------------------------------------------------------------------
  describe("Dry run 모드", () => {
    it("should pass dry run flag to PR creator", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue({
        baseBranch: "main",
        workBranch: "aq/123-test-issue"
      });
      mockAutoCommitIfDirty.mockResolvedValue("commit123");
      mockPushBranch.mockResolvedValue(undefined);
      mockCreateDraftPR.mockResolvedValue({
        url: "https://github.com/dry-run",
        number: 0
      });

      const task = new GitTask(makeOptions({
        dryRun: true,
        steps: ["sync-base", "create-branch", "commit-changes", "push-branch", "create-pr"]
      }));
      await task.run();

      expect(mockCreateDraftPR).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          dryRun: true
        })
      );
    });
  });
});