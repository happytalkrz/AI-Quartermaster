import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

import { createWorktree, removeWorktree, listWorktrees, isWorktreeDirty } from "../../src/git/worktree-manager.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockRunCli = vi.mocked(runCli);

const gitConfig = {
  defaultBaseBranch: "master",
  branchTemplate: "ax/{issueNumber}-{slug}",
  commitMessageTemplate: "",
  remoteAlias: "origin",
  allowedRepos: [],
  gitPath: "git",
  fetchDepth: 0,
  signCommits: false,
};

const worktreeConfig = {
  rootPath: "/tmp/worktrees",
  cleanupOnSuccess: true,
  cleanupOnFailure: false,
  maxAge: "7d",
  dirTemplate: "{issueNumber}-{slug}",
};

describe("createWorktree", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create worktree with correct path", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const info = await createWorktree(gitConfig, worktreeConfig, "ax/42-fix-bug", 42, "fix-bug", { cwd: "/repo" });
    expect(info.path).toContain("42-fix-bug");
    expect(info.branch).toBe("ax/42-fix-bug");
    expect(mockRunCli).toHaveBeenCalledWith("git", expect.arrayContaining(["worktree", "add"]), expect.any(Object));
  });

  it("should support repoSlug in dirTemplate", async () => {
    const configWithRepoSlug = {
      ...worktreeConfig,
      dirTemplate: "{repoSlug}-{issueNumber}-{slug}",
    };
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const info = await createWorktree(gitConfig, configWithRepoSlug, "ax/42-fix-bug", 42, "fix-bug", { cwd: "/repo" }, "owner-repo");
    expect(info.path).toContain("owner-repo-42-fix-bug");
    expect(info.branch).toBe("ax/42-fix-bug");
  });

  it("should strip {{repoSlug}}- prefix when repoSlug is not provided (double-brace template)", async () => {
    const configWithDoublebraceTemplate = {
      ...worktreeConfig,
      dirTemplate: "{{repoSlug}}-{{issueNumber}}-{{slug}}",
    };
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    // repoSlug 미전달 → {{repoSlug}}- 자동 제거되어 42-fix-bug 형태가 되어야 함
    const info = await createWorktree(gitConfig, configWithDoublebraceTemplate, "ax/42-fix-bug", 42, "fix-bug", { cwd: "/repo" });
    expect(info.path).toContain("42-fix-bug");
    expect(info.path).not.toContain("repoSlug");
    expect(info.branch).toBe("ax/42-fix-bug");
  });

  it("should include repoSlug when provided with double-brace dirTemplate", async () => {
    const configWithDoublebraceTemplate = {
      ...worktreeConfig,
      dirTemplate: "{{repoSlug}}-{{issueNumber}}-{{slug}}",
    };
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const info = await createWorktree(gitConfig, configWithDoublebraceTemplate, "ax/42-fix-bug", 42, "fix-bug", { cwd: "/repo" }, "myorg-myrepo");
    expect(info.path).toContain("myorg-myrepo-42-fix-bug");
    expect(info.branch).toBe("ax/42-fix-bug");
  });

  it("should set AI-Quartermaster as git author in worktree", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await createWorktree(gitConfig, worktreeConfig, "ax/42-fix-bug", 42, "fix-bug", { cwd: "/repo" });

    // Verify git config commands were called
    expect(mockRunCli).toHaveBeenCalledWith(
      "git",
      ["config", "--local", "user.name", "AI-Quartermaster"],
      { cwd: expect.stringContaining("42-fix-bug") }
    );
    expect(mockRunCli).toHaveBeenCalledWith(
      "git",
      ["config", "--local", "user.email", "noreply@ai-quartermaster.local"],
      { cwd: expect.stringContaining("42-fix-bug") }
    );
  });

  it("should throw when git config fails", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // worktree add succeeds
      .mockResolvedValueOnce({ stdout: "", stderr: "config error", exitCode: 1 }); // git config fails

    await expect(
      createWorktree(gitConfig, worktreeConfig, "ax/42-fix-bug", 42, "fix-bug", { cwd: "/repo" })
    ).rejects.toThrow("Failed to set git user.name");
  });

  it("should throw on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "error", exitCode: 1 });
    await expect(createWorktree(gitConfig, worktreeConfig, "branch", 1, "test", { cwd: "/repo" })).rejects.toThrow("Failed to create worktree");
  });

  // Path traversal security tests
  it("should reject directory names with path traversal", async () => {
    await expect(createWorktree(gitConfig, worktreeConfig, "branch", 1, "../escape", { cwd: "/repo" }))
      .rejects.toThrow("Unsafe directory name");
  });

  it("should reject directory names with absolute paths", async () => {
    await expect(createWorktree(gitConfig, worktreeConfig, "branch", 1, "/etc/passwd", { cwd: "/repo" }))
      .rejects.toThrow("Unsafe directory name");
  });

  it("should reject directory names that would escape root path", async () => {
    const maliciousConfig = {
      ...worktreeConfig,
      dirTemplate: "../{slug}" // Template itself tries to escape
    };

    await expect(createWorktree(gitConfig, maliciousConfig, "branch", 1, "test", { cwd: "/repo" }))
      .rejects.toThrow("Unsafe directory name");
  });

  it("should validate worktree path is within root", async () => {
    // Using a directory name that when combined would try to escape
    await expect(createWorktree(gitConfig, worktreeConfig, "branch", 1, "..%2F..%2Fetc", { cwd: "/repo" }))
      .rejects.toThrow("Unsafe directory name");
  });
});

describe("removeWorktree", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should remove worktree and prune", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await removeWorktree(gitConfig, "/tmp/worktrees/42-fix", { cwd: "/repo" });
    expect(mockRunCli).toHaveBeenCalledTimes(2); // remove + prune
  });

  it("should force remove when normal fails", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "dirty", exitCode: 1 }) // normal
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // force
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // prune
    await removeWorktree(gitConfig, "/tmp/wt", { cwd: "/repo" });
    expect(mockRunCli).toHaveBeenCalledTimes(3);
  });
});

describe("listWorktrees", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should parse porcelain output", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "worktree /repo\nbranch refs/heads/master\n\nworktree /tmp/wt/42-fix\nbranch refs/heads/ax/42-fix\n",
      stderr: "",
      exitCode: 0,
    });
    const list = await listWorktrees(gitConfig, { cwd: "/repo" });
    expect(list).toHaveLength(2);
    expect(list[1].path).toBe("/tmp/wt/42-fix");
    expect(list[1].branch).toBe("ax/42-fix");
  });
});

describe("isWorktreeDirty", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return false for clean worktree", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    expect(await isWorktreeDirty(gitConfig, "/tmp/wt")).toBe(false);
  });

  it("should return true for dirty worktree", async () => {
    mockRunCli.mockResolvedValue({ stdout: "M file.ts\n", stderr: "", exitCode: 0 });
    expect(await isWorktreeDirty(gitConfig, "/tmp/wt")).toBe(true);
  });
});
