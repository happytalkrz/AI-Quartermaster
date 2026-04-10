import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitTask, type GitTaskOptions, type GitTaskParams } from "../../src/tasks/git-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { GitConfig, WorktreeConfig } from "../../src/types/config.js";

vi.mock("../../src/git/branch-manager.js", () => ({
  syncBaseBranch: vi.fn(),
  createWorkBranch: vi.fn(),
  pushBranch: vi.fn(),
}));

vi.mock("../../src/git/worktree-manager.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
}));

import {
  syncBaseBranch,
  createWorkBranch,
  pushBranch,
} from "../../src/git/branch-manager.js";
import {
  createWorktree,
  removeWorktree,
} from "../../src/git/worktree-manager.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";

const mockSyncBaseBranch = vi.mocked(syncBaseBranch);
const mockCreateWorkBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockRemoveWorktree = vi.mocked(removeWorktree);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);

const mockGitConfig: GitConfig = {
  defaultBranch: "main",
  remote: "origin",
  worktreeBase: ".aq-worktrees",
  branchPrefix: "aq/",
  commitMsgTemplate: "[#{issue}] {title}",
};

const mockWorktreeConfig: WorktreeConfig = {
  maxWorktrees: 5,
};

describe("GitTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("생성 및 기본 속성", () => {
    it("auto-generated UUID id를 가진다", () => {
      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(task.id).toBeDefined();
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("options.id가 지정되면 해당 id를 사용한다", () => {
      const task = new GitTask({
        id: "custom-git-id",
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(task.id).toBe("custom-git-id");
    });

    it("type이 'git'이다", () => {
      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(task.type).toBe("git");
    });

    it("초기 status가 PENDING이다", () => {
      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("서로 다른 인스턴스는 서로 다른 id를 가진다", () => {
      const t1 = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });
      const t2 = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe("operation: syncBaseBranch", () => {
    it("syncBaseBranch를 호출하고 결과를 반환한다", async () => {
      mockSyncBaseBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      const result = await task.run();

      expect(result).toEqual({ operation: "syncBaseBranch" });
      expect(mockSyncBaseBranch).toHaveBeenCalledWith(mockGitConfig, {
        cwd: expect.any(String),
      });
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("syncBaseBranch 실패 시 FAILED 상태가 된다", async () => {
      mockSyncBaseBranch.mockRejectedValueOnce(new Error("git sync failed"));

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      await expect(task.run()).rejects.toThrow("git sync failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("operation: createWorkBranch", () => {
    it("createWorkBranch를 호출하고 branch 결과를 반환한다", async () => {
      const mockBranch = { name: "aq/42-fix-bug", baseBranch: "main" };
      mockCreateWorkBranch.mockResolvedValueOnce(mockBranch);

      const task = new GitTask({
        params: {
          operation: "createWorkBranch",
          gitConfig: mockGitConfig,
          issueNumber: 42,
          issueTitle: "Fix bug",
        },
      });

      const result = await task.run();

      expect(result).toEqual({ operation: "createWorkBranch", branch: mockBranch });
      expect(mockCreateWorkBranch).toHaveBeenCalledWith(
        mockGitConfig,
        42,
        "Fix bug",
        { cwd: expect.any(String) }
      );
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });
  });

  describe("operation: createWorktree", () => {
    it("createWorktree를 호출하고 worktree 결과를 반환한다", async () => {
      const mockWorktree = { path: ".aq-worktrees/42-fix", branch: "aq/42-fix" };
      mockCreateWorktree.mockResolvedValueOnce(mockWorktree);

      const task = new GitTask({
        params: {
          operation: "createWorktree",
          gitConfig: mockGitConfig,
          worktreeConfig: mockWorktreeConfig,
          branchName: "aq/42-fix",
          issueNumber: 42,
          slug: "fix",
        },
      });

      const result = await task.run();

      expect(result).toEqual({ operation: "createWorktree", worktree: mockWorktree });
      expect(mockCreateWorktree).toHaveBeenCalledWith(
        mockGitConfig,
        mockWorktreeConfig,
        "aq/42-fix",
        42,
        "fix",
        { cwd: expect.any(String) },
        undefined
      );
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("repoSlug를 전달하면 createWorktree에 그대로 넘긴다", async () => {
      const mockWorktree = { path: ".aq-worktrees/42-fix", branch: "aq/42-fix" };
      mockCreateWorktree.mockResolvedValueOnce(mockWorktree);

      const task = new GitTask({
        params: {
          operation: "createWorktree",
          gitConfig: mockGitConfig,
          worktreeConfig: mockWorktreeConfig,
          branchName: "aq/42-fix",
          issueNumber: 42,
          slug: "fix",
          repoSlug: "my-repo",
        },
      });

      await task.run();

      expect(mockCreateWorktree).toHaveBeenCalledWith(
        mockGitConfig,
        mockWorktreeConfig,
        "aq/42-fix",
        42,
        "fix",
        { cwd: expect.any(String) },
        "my-repo"
      );
    });
  });

  describe("operation: removeWorktree", () => {
    it("removeWorktree를 호출하고 결과를 반환한다", async () => {
      mockRemoveWorktree.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: {
          operation: "removeWorktree",
          gitConfig: mockGitConfig,
          worktreePath: "/path/to/worktree",
        },
      });

      const result = await task.run();

      expect(result).toEqual({ operation: "removeWorktree" });
      expect(mockRemoveWorktree).toHaveBeenCalledWith(
        mockGitConfig,
        "/path/to/worktree",
        { cwd: expect.any(String), force: undefined }
      );
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("force 옵션을 전달한다", async () => {
      mockRemoveWorktree.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: {
          operation: "removeWorktree",
          gitConfig: mockGitConfig,
          worktreePath: "/path/to/worktree",
          force: true,
        },
      });

      await task.run();

      expect(mockRemoveWorktree).toHaveBeenCalledWith(
        mockGitConfig,
        "/path/to/worktree",
        { cwd: expect.any(String), force: true }
      );
    });
  });

  describe("operation: pushBranch", () => {
    it("pushBranch를 호출하고 결과를 반환한다", async () => {
      mockPushBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: {
          operation: "pushBranch",
          gitConfig: mockGitConfig,
          branchName: "aq/42-fix",
        },
      });

      const result = await task.run();

      expect(result).toEqual({ operation: "pushBranch" });
      expect(mockPushBranch).toHaveBeenCalledWith(mockGitConfig, "aq/42-fix", {
        cwd: expect.any(String),
      });
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });
  });

  describe("operation: autoCommit", () => {
    it("autoCommitIfDirty를 호출하고 commitHash를 반환한다", async () => {
      mockAutoCommitIfDirty.mockResolvedValueOnce("abc123");

      const task = new GitTask({
        params: {
          operation: "autoCommit",
          gitPath: "/repo/.git",
          commitMsg: "test commit",
        },
      });

      const result = await task.run();

      expect(result).toEqual({ operation: "autoCommit", commitHash: "abc123" });
      expect(mockAutoCommitIfDirty).toHaveBeenCalledWith(
        "/repo/.git",
        expect.any(String),
        "test commit"
      );
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("commitHash가 undefined이어도 정상 처리한다", async () => {
      mockAutoCommitIfDirty.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: {
          operation: "autoCommit",
          gitPath: "/repo/.git",
          commitMsg: "no changes",
        },
      });

      const result = await task.run();

      expect(result).toEqual({ operation: "autoCommit", commitHash: undefined });
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });
  });

  describe("상태 전이", () => {
    it("PENDING → RUNNING → SUCCESS 순서로 전이한다", async () => {
      let statusDuringRun: TaskStatus | undefined;

      mockSyncBaseBranch.mockImplementationOnce(async () => {
        statusDuringRun = task.status;
      });

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(task.status).toBe(TaskStatus.PENDING);
      await task.run();

      expect(statusDuringRun).toBe(TaskStatus.RUNNING);
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("오류 발생 시 PENDING → RUNNING → FAILED 순서로 전이한다", async () => {
      mockSyncBaseBranch.mockRejectedValueOnce(new Error("fail"));

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(task.status).toBe(TaskStatus.PENDING);
      await expect(task.run()).rejects.toThrow("fail");
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("이미 실행된 태스크를 다시 run하면 에러를 던진다", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      await task.run();

      await expect(task.run()).rejects.toThrow(
        /already SUCCESS and cannot be run again/
      );
    });
  });

  describe("kill()", () => {
    it("PENDING 상태에서 kill하면 KILLED 상태가 된다", async () => {
      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      await task.kill();

      expect(task.status).toBe(TaskStatus.KILLED);
    });

    it("RUNNING 상태에서 kill하면 작업 완료 후 KILLED 상태가 된다", async () => {
      let resolveRun!: () => void;
      const runHeld = new Promise<void>((r) => { resolveRun = r; });

      mockSyncBaseBranch.mockImplementationOnce(() => runHeld);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      const runPromise = task.run();

      // 실행 시작 대기
      await new Promise((r) => setTimeout(r, 10));
      expect(task.status).toBe(TaskStatus.RUNNING);

      // kill 플래그 설정
      const killPromise = task.kill();

      // 실행 완료 후 KILLED로 전환
      resolveRun();
      await expect(runPromise).rejects.toThrow(/was killed/);
      await killPromise;

      expect(task.status).toBe(TaskStatus.KILLED);
    });

    it("이미 SUCCESS 상태에서 kill을 호출해도 상태가 변경되지 않는다", async () => {
      mockSyncBaseBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      await task.run();
      expect(task.status).toBe(TaskStatus.SUCCESS);

      await task.kill();
      // SUCCESS 상태에서 kill해도 아무 일도 안 일어남
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("getResult()는 성공 후 결과를 반환한다", async () => {
      mockSyncBaseBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      expect(task.getResult()).toBeUndefined();

      await task.run();

      expect(task.getResult()).toEqual({ operation: "syncBaseBranch" });
    });
  });

  describe("라이프사이클 이벤트", () => {
    it("run 시작 시 started 이벤트를 발생시킨다", async () => {
      mockSyncBaseBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });
      const startedFn = vi.fn();
      task.on("started", startedFn);

      await task.run();

      expect(startedFn).toHaveBeenCalledTimes(1);
    });

    it("성공 시 completed 이벤트를 발생시킨다", async () => {
      mockSyncBaseBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });
      const completedFn = vi.fn();
      const failedFn = vi.fn();
      task.on("completed", completedFn);
      task.on("failed", failedFn);

      await task.run();

      expect(completedFn).toHaveBeenCalledTimes(1);
      expect(failedFn).not.toHaveBeenCalled();
    });

    it("실패 시 failed 이벤트를 발생시킨다", async () => {
      mockSyncBaseBranch.mockRejectedValueOnce(new Error("git error"));

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });
      const completedFn = vi.fn();
      const failedFn = vi.fn();
      task.on("completed", completedFn);
      task.on("failed", failedFn);

      await expect(task.run()).rejects.toThrow("git error");

      expect(failedFn).toHaveBeenCalledTimes(1);
      expect(completedFn).not.toHaveBeenCalled();
    });

    it("PENDING 상태에서 kill 시 killed 이벤트를 발생시킨다", async () => {
      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });
      const killedFn = vi.fn();
      task.on("killed", killedFn);

      await task.kill();

      expect(killedFn).toHaveBeenCalledTimes(1);
    });

    it("once 리스너는 한 번만 발생한다", async () => {
      mockSyncBaseBranch.mockResolvedValue(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });
      const onceFn = vi.fn();
      task.once("started", onceFn);

      await task.run();

      expect(onceFn).toHaveBeenCalledTimes(1);
    });

    it("off로 리스너를 제거하면 이벤트를 수신하지 않는다", async () => {
      mockSyncBaseBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });
      const startedFn = vi.fn();
      task.on("started", startedFn);
      task.off("started", startedFn);

      await task.run();

      expect(startedFn).not.toHaveBeenCalled();
    });
  });

  describe("toJSON() 직렬화", () => {
    it("PENDING 상태의 태스크를 직렬화한다", () => {
      const task = new GitTask({
        id: "git-task-123",
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      const json = task.toJSON();

      expect(json).toMatchObject({
        id: "git-task-123",
        type: "git",
        status: TaskStatus.PENDING,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
        metadata: { operation: "syncBaseBranch" },
      });
    });

    it("성공 후 startedAt, completedAt, durationMs가 채워진다", async () => {
      mockSyncBaseBranch.mockResolvedValueOnce(undefined);

      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
      });

      await task.run();

      const json = task.toJSON();

      expect(json.startedAt).toBeDefined();
      expect(json.completedAt).toBeDefined();
      expect(json.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof json.durationMs).toBe("number");
    });

    it("operation 이름이 metadata에 포함된다", () => {
      const operations: GitTaskParams["operation"][] = [
        "syncBaseBranch",
        "pushBranch",
        "removeWorktree",
        "autoCommit",
      ];

      for (const op of operations) {
        let params: GitTaskParams;
        if (op === "pushBranch") {
          params = { operation: op, gitConfig: mockGitConfig, branchName: "test" };
        } else if (op === "removeWorktree") {
          params = { operation: op, gitConfig: mockGitConfig, worktreePath: "/path" };
        } else if (op === "autoCommit") {
          params = { operation: op, gitPath: "/repo/.git", commitMsg: "msg" };
        } else {
          params = { operation: op, gitConfig: mockGitConfig };
        }

        const task = new GitTask({ params });
        expect(task.toJSON().metadata?.operation).toBe(op);
      }
    });

    it("options.metadata가 toJSON()에 포함된다", () => {
      const task = new GitTask({
        params: { operation: "syncBaseBranch", gitConfig: mockGitConfig },
        metadata: { issueNumber: 42, repo: "test/repo" },
      });

      const json = task.toJSON();

      expect(json.metadata?.issueNumber).toBe(42);
      expect(json.metadata?.repo).toBe("test/repo");
      expect(json.metadata?.operation).toBe("syncBaseBranch");
    });
  });
});
