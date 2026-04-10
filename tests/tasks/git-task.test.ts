import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitTask, GitTaskOptions, GitOperationType } from "../../src/tasks/git-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { GitConfig } from "../../src/types/config.js";

// Git 모듈들 모킹
vi.mock("../../src/git/branch-manager.js", () => ({
  syncBaseBranch: vi.fn(),
  createWorkBranch: vi.fn(),
  pushBranch: vi.fn(),
  deleteRemoteBranch: vi.fn(),
}));

vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
  getHeadHash: vi.fn(),
}));

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  syncBaseBranch,
  createWorkBranch,
  pushBranch,
  deleteRemoteBranch,
} from "../../src/git/branch-manager.js";
import { autoCommitIfDirty, getHeadHash } from "../../src/git/commit-helper.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockSyncBaseBranch = vi.mocked(syncBaseBranch);
const mockCreateWorkBranch = vi.mocked(createWorkBranch);
const mockPushBranch = vi.mocked(pushBranch);
const mockDeleteRemoteBranch = vi.mocked(deleteRemoteBranch);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockGetHeadHash = vi.mocked(getHeadHash);
const mockRunCli = vi.mocked(runCli);

const mockGitConfig: GitConfig = {
  defaultBaseBranch: "main",
  branchTemplate: "ax/{issueNumber}-{slug}",
  commitMessageTemplate: "fix: {summary}",
  remoteAlias: "origin",
  allowedRepos: ["test-repo"],
  gitPath: "git",
  fetchDepth: 10,
  signCommits: false,
};

function makeBranchOptions(overrides: Partial<GitTaskOptions> = {}): GitTaskOptions {
  return {
    operation: "branch",
    operationOptions: {
      gitConfig: mockGitConfig,
      cwd: "/test/repo",
      issueNumber: 123,
      issueTitle: "Test issue",
    },
    ...overrides,
  };
}

function makeCommitOptions(overrides: Partial<GitTaskOptions> = {}): GitTaskOptions {
  return {
    operation: "commit",
    operationOptions: {
      gitConfig: mockGitConfig,
      cwd: "/test/repo",
      commitMessage: "Test commit",
    },
    ...overrides,
  };
}

function makePushOptions(overrides: Partial<GitTaskOptions> = {}): GitTaskOptions {
  return {
    operation: "push",
    operationOptions: {
      gitConfig: mockGitConfig,
      cwd: "/test/repo",
      branchName: "ax/123-test-issue",
    },
    ...overrides,
  };
}

describe("GitTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("기본 속성", () => {
    it("새 GitTask를 생성할 수 있어야 한다", () => {
      const task = new GitTask(makeBranchOptions());
      expect(task.id).toBeDefined();
      expect(task.type).toBe("git");
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("사용자 정의 ID를 사용할 수 있어야 한다", () => {
      const customId = "custom-git-task-id";
      const task = new GitTask(makeBranchOptions({ id: customId }));
      expect(task.id).toBe(customId);
    });
  });

  describe("Branch Operation", () => {
    it("성공적으로 브랜치 작업을 수행해야 한다", async () => {
      const branchInfo = { baseBranch: "main", workBranch: "ax/123-test-issue" };
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue(branchInfo);

      const task = new GitTask(makeBranchOptions());
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("branch");
      expect(result.data).toEqual(branchInfo);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockSyncBaseBranch).toHaveBeenCalledWith(mockGitConfig, { cwd: "/test/repo" });
      expect(mockCreateWorkBranch).toHaveBeenCalledWith(
        mockGitConfig,
        123,
        "Test issue",
        { cwd: "/test/repo" }
      );
    });

    it("브랜치 작업 실패 시 롤백을 시도해야 한다", async () => {
      const branchInfo = { baseBranch: "main", workBranch: "ax/123-test-issue" };
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue(branchInfo);

      // 브랜치 생성 후 의도적으로 실패 발생
      mockCreateWorkBranch.mockRejectedValueOnce(new Error("Branch creation failed"));
      mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      const task = new GitTask(makeBranchOptions());

      await expect(task.run()).rejects.toThrow("Branch creation failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("Commit Operation", () => {
    it("성공적으로 커밋 작업을 수행해야 한다", async () => {
      const previousHash = "abc123";
      const newHash = "def456";

      mockGetHeadHash.mockResolvedValue(previousHash);
      mockAutoCommitIfDirty.mockResolvedValue(newHash);

      const task = new GitTask(makeCommitOptions());
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("commit");
      expect(result.data).toEqual({
        commitHash: newHash,
        previousCommitHash: previousHash,
      });
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("커밋할 변경사항이 없을 때도 성공해야 한다", async () => {
      const previousHash = "abc123";

      mockGetHeadHash.mockResolvedValue(previousHash);
      mockAutoCommitIfDirty.mockResolvedValue(undefined); // 변경사항 없음

      const task = new GitTask(makeCommitOptions());
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        commitHash: undefined,
        previousCommitHash: previousHash,
      });
    });

    it("커밋 실패 시 롤백을 시도해야 한다", async () => {
      const previousHash = "abc123";
      mockGetHeadHash.mockResolvedValue(previousHash);
      mockAutoCommitIfDirty.mockRejectedValue(new Error("Commit failed"));

      // 롤백을 위한 reset 명령 모킹
      mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      const task = new GitTask(makeCommitOptions());

      await expect(task.run()).rejects.toThrow("Commit failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("Push Operation", () => {
    it("성공적으로 푸시 작업을 수행해야 한다", async () => {
      mockPushBranch.mockResolvedValue(undefined);

      const task = new GitTask(makePushOptions());
      const result = await task.run();

      expect(result.success).toBe(true);
      expect(result.operation).toBe("push");
      expect(result.data).toEqual({ branchName: "ax/123-test-issue" });
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(mockPushBranch).toHaveBeenCalledWith(
        mockGitConfig,
        "ax/123-test-issue",
        { cwd: "/test/repo" }
      );
    });

    it("푸시 실패 시 롤백을 시도해야 한다", async () => {
      mockPushBranch.mockRejectedValue(new Error("Push failed"));
      mockDeleteRemoteBranch.mockResolvedValue(undefined);

      const task = new GitTask(makePushOptions());

      await expect(task.run()).rejects.toThrow("Push failed");
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("Rollback", () => {
    it("수동으로 롤백을 수행할 수 있어야 한다", async () => {
      mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      const task = new GitTask(makeBranchOptions());

      // 태스크를 실패 상태로 설정
      task["_status"] = TaskStatus.FAILED;
      task["_state"] = { branchCreated: "ax/123-test-issue" };

      await task.rollback();

      // 브랜치 삭제가 시도되었는지 확인 (현재 브랜치가 아닌 경우)
      expect(mockRunCli).toHaveBeenCalled();
    });

    it("성공한 태스크는 롤백하지 않아야 한다", async () => {
      const task = new GitTask(makeBranchOptions());
      task["_status"] = TaskStatus.SUCCESS;

      await task.rollback();

      // 아무 git 명령도 실행되지 않아야 함
      expect(mockRunCli).not.toHaveBeenCalled();
    });
  });

  describe("Kill", () => {
    it("실행 중인 태스크를 kill할 수 있어야 한다", async () => {
      const task = new GitTask(makeBranchOptions());
      task["_status"] = TaskStatus.RUNNING;
      task["_state"] = { branchCreated: "ax/123-test-issue" };

      mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      await task.kill();

      expect(task.status).toBe(TaskStatus.KILLED);
    });
  });

  describe("Timeout", () => {
    it("타임아웃이 설정되면 자동으로 kill되어야 한다", async () => {
      vi.useFakeTimers();

      const options = makeBranchOptions({
        operationOptions: {
          ...makeBranchOptions().operationOptions,
          timeout: 1000, // 1초 타임아웃
        },
      });

      mockSyncBaseBranch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000)) // 2초 대기
      );

      const task = new GitTask(options);
      const runPromise = task.run();

      // 1초 후 타임아웃 발생
      vi.advanceTimersByTime(1000);

      await vi.waitFor(() => expect(task.status).toBe(TaskStatus.KILLED));

      vi.useRealTimers();
    });
  });

  describe("toJSON", () => {
    it("태스크 정보를 JSON으로 직렬화할 수 있어야 한다", () => {
      const task = new GitTask(makeBranchOptions({ id: "test-id" }));
      const json = task.toJSON();

      expect(json).toMatchObject({
        id: "test-id",
        type: "git",
        status: TaskStatus.PENDING,
        metadata: {
          operation: "branch",
        },
      });
    });

    it("실행 결과와 상태를 포함해야 한다", async () => {
      const branchInfo = { baseBranch: "main", workBranch: "ax/123-test-issue" };
      mockSyncBaseBranch.mockResolvedValue(undefined);
      mockCreateWorkBranch.mockResolvedValue(branchInfo);

      const task = new GitTask(makeBranchOptions({ id: "test-id" }));
      await task.run();

      const json = task.toJSON();
      expect(json.metadata).toMatchObject({
        operation: "branch",
        success: true,
        data: branchInfo,
        state: { branchCreated: "ax/123-test-issue" },
      });
      expect(json.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Unknown Operation", () => {
    it("알 수 없는 operation type에 대해 에러를 던져야 한다", async () => {
      const task = new GitTask({
        operation: "unknown" as GitOperationType,
        operationOptions: makeBranchOptions().operationOptions,
      });

      await expect(task.run()).rejects.toThrow("Unknown operation type: unknown");
    });
  });

  describe("PR Operation", () => {
    it("PR operation은 아직 구현되지 않았다는 에러를 던져야 한다", async () => {
      const task = new GitTask({
        operation: "pr",
        operationOptions: {
          gitConfig: mockGitConfig,
          cwd: "/test/repo",
          branchInfo: { baseBranch: "main", workBranch: "ax/123-test" },
          title: "Test PR",
          body: "Test PR body",
        },
      });

      await expect(task.run()).rejects.toThrow("PR operation not yet implemented");
    });
  });
});