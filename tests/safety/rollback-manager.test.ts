import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

import { createCheckpoint, rollbackToCheckpoint, ensureCleanState, type WorktreeManager, type EnsureCleanStateOptions } from "../../src/safety/rollback-manager.js";
import { runCli } from "../../src/utils/cli-runner.js";
import type { GitConfig, WorktreeConfig } from "../../src/types/config.js";

const mockRunCli = vi.mocked(runCli);

describe("createCheckpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return current HEAD hash", async () => {
    mockRunCli.mockResolvedValue({ stdout: "abc123def456\n", stderr: "", exitCode: 0 });
    const hash = await createCheckpoint({ cwd: "/tmp" });
    expect(hash).toBe("abc123def456");
  });

  it("should throw on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "error", exitCode: 1 });
    await expect(createCheckpoint({ cwd: "/tmp" })).rejects.toThrow("Rollback");
  });
});

describe("rollbackToCheckpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should reset to given hash and clean", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await rollbackToCheckpoint("abc123", { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["reset", "--hard", "abc123"], { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["clean", "-fd"], { cwd: "/tmp" });
  });

  it("should throw RollbackError on failure", async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "error", exitCode: 1 });
    await expect(rollbackToCheckpoint("abc", { cwd: "/tmp" })).rejects.toThrow("Rollback");
  });
});

describe("ensureCleanState", () => {
  beforeEach(() => vi.clearAllMocks());

  const mockWorktreeManager: WorktreeManager = {
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
  };

  const mockGitConfig: GitConfig = {
    defaultBaseBranch: "main",
    branchTemplate: "aq/{issueNumber}-{slug}",
    commitMessageTemplate: "[#{issueNumber}] {title}",
    remoteAlias: "origin",
    allowedRepos: ["test/repo"],
    gitPath: "git",
    fetchDepth: 50,
    signCommits: false,
  };

  const mockWorktreeConfig: WorktreeConfig = {
    rootPath: ".aq-worktrees",
    cleanupOnSuccess: true,
    cleanupOnFailure: false,
    maxAge: "7d",
    dirTemplate: "{issueNumber}-{slug}",
  };

  const mockOptions: EnsureCleanStateOptions = {
    cwd: "/tmp",
    gitPath: "git",
    gitConfig: mockGitConfig,
    worktreeConfig: mockWorktreeConfig,
    branchName: "test-branch",
    issueNumber: 123,
    slug: "test-slug",
    worktreePath: "/tmp/test-worktree",
  };

  it("should rollback successfully and return worktree info", async () => {
    // Mock successful rollback
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await ensureCleanState("abc123", mockWorktreeManager, mockOptions);

    expect(mockRunCli).toHaveBeenCalledWith("git", ["reset", "--hard", "abc123"], { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["clean", "-fd"], { cwd: "/tmp" });
    expect(result).toEqual({
      path: "/tmp/test-worktree",
      branch: "test-branch",
    });
    expect(mockWorktreeManager.removeWorktree).not.toHaveBeenCalled();
    expect(mockWorktreeManager.createWorktree).not.toHaveBeenCalled();
  });

  it("should fallback to worktree recreation when rollback fails", async () => {
    // Mock rollback failure
    mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "rollback error", exitCode: 1 });

    // Mock successful worktree recreation
    vi.mocked(mockWorktreeManager.removeWorktree).mockResolvedValue();
    vi.mocked(mockWorktreeManager.createWorktree).mockResolvedValue({
      path: "/tmp/new-worktree",
      branch: "test-branch",
    });

    const result = await ensureCleanState("abc123", mockWorktreeManager, mockOptions);

    expect(mockWorktreeManager.removeWorktree).toHaveBeenCalledWith(
      mockGitConfig,
      "/tmp/test-worktree",
      { cwd: "/tmp", force: true }
    );
    expect(mockWorktreeManager.createWorktree).toHaveBeenCalledWith(
      mockGitConfig,
      mockWorktreeConfig,
      "test-branch",
      123,
      "test-slug",
      { cwd: "/tmp" },
      undefined
    );
    expect(result).toEqual({
      path: "/tmp/new-worktree",
      branch: "test-branch",
    });
  });

  it("should throw RollbackError when both rollback and worktree recreation fail", async () => {
    // Mock rollback failure
    mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "rollback error", exitCode: 1 });

    // Mock worktree recreation failure
    vi.mocked(mockWorktreeManager.removeWorktree).mockRejectedValue(new Error("remove failed"));

    await expect(ensureCleanState("abc123", mockWorktreeManager, mockOptions))
      .rejects.toThrow("Failed to ensure clean state");

    expect(mockWorktreeManager.removeWorktree).toHaveBeenCalled();
    expect(mockWorktreeManager.createWorktree).not.toHaveBeenCalled();
  });
});
