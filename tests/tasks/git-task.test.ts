import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitTask, GitTaskOptions, GitTaskPrOptions } from "../../src/tasks/git-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { GitConfig, PrConfig, GhCliConfig } from "../../src/types/config.js";

vi.mock("../../src/git/branch-manager.js", () => ({
  syncBaseBranch: vi.fn(),
  createWorkBranch: vi.fn(),
  pushBranch: vi.fn(),
}));
vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
}));
vi.mock("../../src/github/pr-creator.js", () => ({
  createDraftPR: vi.fn(),
}));
vi.mock("../../src/safety/rollback-manager.js", () => ({
  createCheckpoint: vi.fn(),
  rollbackToCheckpoint: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { syncBaseBranch, createWorkBranch, pushBranch } from "../../src/git/branch-manager.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";
import { createDraftPR } from "../../src/github/pr-creator.js";
import { createCheckpoint, rollbackToCheckpoint } from "../../src/safety/rollback-manager.js";

const mockSyncBaseBranch = vi.mocked(syncBaseBranch);
const mockCreateWorkBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockCreateCheckpoint = vi.mocked(createCheckpoint);
const mockRollbackToCheckpoint = vi.mocked(rollbackToCheckpoint);

const baseGitConfig: GitConfig = {
  defaultBaseBranch: "main",
  branchTemplate: "aq/{issueNumber}-{slug}",
  commitMessageTemplate: "[#{issueNumber}] {title}",
  remoteAlias: "origin",
  allowedRepos: ["test/repo"],
  gitPath: "git",
  fetchDepth: 50,
  signCommits: false,
};

function makeOptions(overrides: Partial<GitTaskOptions> = {}): GitTaskOptions {
  return {
    gitConfig: baseGitConfig,
    issueNumber: 42,
    issueTitle: "feat: add widget",
    cwd: "/tmp/test-repo",
    ...overrides,
  };
}

describe("GitTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCheckpoint.mockResolvedValue("checkpoint-abc123");
    mockSyncBaseBranch.mockResolvedValue(undefined);
    mockCreateWorkBranch.mockResolvedValue({ baseBranch: "main", workBranch: "aq/42-feat-add-widget" });
    mockAutoCommitIfDirty.mockResolvedValue("commitabc");
    mockPushBranch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("생성 및 기본 속성", () => {
    it("should create task with auto-generated UUID", () => {
      const task = new GitTask(makeOptions());

      expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(task.type).toBe("git");
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should use custom ID when provided", () => {
      const task = new GitTask(makeOptions({ id: "my-custom-id" }));

      expect(task.id).toBe("my-custom-id");
    });

    it("should start with PENDING status", () => {
      const task = new GitTask(makeOptions());

      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.getResult()).toBeUndefined();
    });
  });

  describe("run() — 정상 실행", () => {
    it("should execute all git steps and return success result", async () => {
      const task = new GitTask(makeOptions());
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.branchName).toBe("aq/42-feat-add-widget");
      expect(result.commitHash).toBe("commitabc");
      expect(result.prUrl).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("should call syncBaseBranch with correct args", async () => {
      await new GitTask(makeOptions()).run();

      expect(mockSyncBaseBranch).toHaveBeenCalledWith(baseGitConfig, { cwd: "/tmp/test-repo" });
    });

    it("should call createWorkBranch with issue info", async () => {
      await new GitTask(makeOptions()).run();

      expect(mockCreateWorkBranch).toHaveBeenCalledWith(
        baseGitConfig,
        42,
        "feat: add widget",
        { cwd: "/tmp/test-repo" }
      );
    });

    it("should call autoCommitIfDirty with formatted message", async () => {
      await new GitTask(makeOptions()).run();

      expect(mockAutoCommitIfDirty).toHaveBeenCalledWith(
        "git",
        "/tmp/test-repo",
        "[#42] feat: add widget"
      );
    });

    it("should call pushBranch with work branch name", async () => {
      await new GitTask(makeOptions()).run();

      expect(mockPushBranch).toHaveBeenCalledWith(
        baseGitConfig,
        "aq/42-feat-add-widget",
        { cwd: "/tmp/test-repo" }
      );
    });

    it("should create checkpoint before git operations", async () => {
      await new GitTask(makeOptions()).run();

      expect(mockCreateCheckpoint).toHaveBeenCalledWith({ cwd: "/tmp/test-repo", gitPath: "git" });
    });

    it("should skip PR creation when prOptions is not provided", async () => {
      await new GitTask(makeOptions()).run();

      expect(mockCreateDraftPR).not.toHaveBeenCalled();
    });
  });

  describe("run() — PR 생성 포함", () => {
    const prConfig: PrConfig = {
      draft: true,
      labelPrefix: "aq/",
      autoMerge: false,
    };
    const ghConfig: GhCliConfig = {
      path: "gh",
      timeout: 30000,
    };
    const prOptions: GitTaskPrOptions = {
      prConfig,
      ghConfig,
      repo: "test/repo",
      plan: { phases: [], summary: "test plan" } as never,
      phaseResults: [],
      promptsDir: "/tmp/prompts",
      dryRun: false,
    };

    it("should create PR and include URL in result", async () => {
      mockCreateDraftPR.mockResolvedValue({ url: "https://github.com/test/repo/pull/99", number: 99 });

      const task = new GitTask(makeOptions({ prOptions }));
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/99");
      expect(mockCreateDraftPR).toHaveBeenCalledOnce();
    });

    it("should pass correct args to createDraftPR", async () => {
      mockCreateDraftPR.mockResolvedValue({ url: "https://github.com/test/repo/pull/1", number: 1 });

      await new GitTask(makeOptions({ prOptions })).run();

      expect(mockCreateDraftPR).toHaveBeenCalledWith(
        prConfig,
        ghConfig,
        expect.objectContaining({
          issueNumber: 42,
          issueTitle: "feat: add widget",
          repo: "test/repo",
          branchName: "aq/42-feat-add-widget",
          baseBranch: "main",
        }),
        expect.objectContaining({
          cwd: "/tmp/test-repo",
          promptsDir: "/tmp/prompts",
          dryRun: false,
        })
      );
    });

    it("should handle null PR result without failing", async () => {
      mockCreateDraftPR.mockResolvedValue(null);

      const task = new GitTask(makeOptions({ prOptions }));
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.prUrl).toBeUndefined();
    });
  });

  describe("run() — 실패 처리", () => {
    it("should return failed result when syncBaseBranch throws", async () => {
      mockSyncBaseBranch.mockRejectedValue(new Error("fetch failed"));

      const task = new GitTask(makeOptions());
      const result = await task.run();

      expect(result.success).toBe(false);
      expect(result.error).toContain("fetch failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("should return failed result when createWorkBranch throws", async () => {
      mockCreateWorkBranch.mockRejectedValue(new Error("branch create failed"));

      const task = new GitTask(makeOptions());
      const result = await task.run();

      expect(result.success).toBe(false);
      expect(result.error).toContain("branch create failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("should return failed result when pushBranch throws", async () => {
      mockPushBranch.mockRejectedValue(new Error("push rejected"));

      const task = new GitTask(makeOptions());
      const result = await task.run();

      expect(result.success).toBe(false);
      expect(result.error).toContain("push rejected");
    });

    it("should not rollback when autoRollback is false (default)", async () => {
      mockSyncBaseBranch.mockRejectedValue(new Error("sync failed"));

      await new GitTask(makeOptions()).run();

      expect(mockRollbackToCheckpoint).not.toHaveBeenCalled();
    });

    it("should rollback when autoRollback is true and checkpoint exists", async () => {
      mockSyncBaseBranch.mockRejectedValue(new Error("sync failed"));

      const task = new GitTask(makeOptions({ autoRollback: true }));
      const result = await task.run();

      expect(result.success).toBe(false);
      expect(result.rolledBackTo).toBe("checkpoint-abc123");
      expect(mockRollbackToCheckpoint).toHaveBeenCalledWith(
        "checkpoint-abc123",
        { cwd: "/tmp/test-repo", gitPath: "git" }
      );
    });

    it("should not rollback when autoRollback is true but checkpoint creation failed", async () => {
      mockCreateCheckpoint.mockRejectedValue(new Error("checkpoint failed"));
      mockSyncBaseBranch.mockRejectedValue(new Error("sync failed"));

      const task = new GitTask(makeOptions({ autoRollback: true }));
      const result = await task.run();

      expect(result.success).toBe(false);
      expect(result.rolledBackTo).toBeUndefined();
      expect(mockRollbackToCheckpoint).not.toHaveBeenCalled();
    });

    it("should include durationMs in failed result", async () => {
      mockSyncBaseBranch.mockRejectedValue(new Error("failed"));

      const result = await new GitTask(makeOptions()).run();

      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should throw when run() is called again after completion", async () => {
      const task = new GitTask(makeOptions());
      await task.run();

      await expect(task.run()).rejects.toThrow(/already in SUCCESS state/);
    });

    it("should throw when run() is called again after failure", async () => {
      mockSyncBaseBranch.mockRejectedValue(new Error("fail"));

      const task = new GitTask(makeOptions());
      await task.run();

      await expect(task.run()).rejects.toThrow(/already in FAILED state/);
    });
  });

  describe("kill()", () => {
    it("should kill a running task", async () => {
      let resolveRun!: () => void;
      mockSyncBaseBranch.mockImplementation(
        () => new Promise<void>((resolve) => { resolveRun = resolve; })
      );

      const task = new GitTask(makeOptions());
      const runPromise = task.run();

      await new Promise((r) => setTimeout(r, 10));

      await task.kill();
      resolveRun();

      expect(task.status).toBe(TaskStatus.KILLED);
      await runPromise;
    });

    it("should do nothing when killing a PENDING task", async () => {
      const task = new GitTask(makeOptions());

      await task.kill();

      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should do nothing when killing an already completed task", async () => {
      const task = new GitTask(makeOptions());
      await task.run();

      await task.kill();

      expect(task.status).toBe(TaskStatus.SUCCESS);
    });
  });

  describe("toJSON()", () => {
    it("should serialize PENDING task correctly", () => {
      const task = new GitTask(makeOptions({ id: "test-id-123" }));
      const json = task.toJSON();

      expect(json).toMatchObject({
        id: "test-id-123",
        type: "git",
        status: TaskStatus.PENDING,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
      });
      expect(json.metadata?.issueNumber).toBe(42);
      expect(json.metadata?.issueTitle).toBe("feat: add widget");
    });

    it("should include result metadata after successful run", async () => {
      const task = new GitTask(makeOptions({ id: "run-id" }));
      await task.run();

      const json = task.toJSON();

      expect(json.status).toBe(TaskStatus.SUCCESS);
      expect(json.metadata?.branchName).toBe("aq/42-feat-add-widget");
      expect(json.metadata?.commitHash).toBe("commitabc");
      expect(json.metadata?.success).toBe(true);
      expect(json.startedAt).toBeDefined();
      expect(json.completedAt).toBeDefined();
      expect(json.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should include extra metadata from options", () => {
      const task = new GitTask(makeOptions({
        id: "meta-id",
        metadata: { customKey: "customVal" },
      }));
      const json = task.toJSON();

      expect(json.metadata?.customKey).toBe("customVal");
    });
  });

  describe("getResult()", () => {
    it("should return undefined before run", () => {
      expect(new GitTask(makeOptions()).getResult()).toBeUndefined();
    });

    it("should return result after successful run", async () => {
      const task = new GitTask(makeOptions());
      await task.run();

      const result = task.getResult();

      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.branchName).toBe("aq/42-feat-add-widget");
    });

    it("should return error result after failed run", async () => {
      mockSyncBaseBranch.mockRejectedValue(new Error("boom"));

      const task = new GitTask(makeOptions());
      await task.run();

      const result = task.getResult();

      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error).toContain("boom");
    });
  });
});
