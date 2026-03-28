import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

import { syncBaseBranch, createWorkBranch } from "../../src/git/branch-manager.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockRunCli = vi.mocked(runCli);

const defaultGitConfig = {
  defaultBaseBranch: "master",
  branchTemplate: "ax/{issueNumber}-{slug}",
  commitMessageTemplate: "[#{issueNumber}] {phase}: {summary}",
  remoteAlias: "origin",
  allowedRepos: ["test/repo"],
  gitPath: "git",
  fetchDepth: 0,
  signCommits: false,
};

describe("syncBaseBranch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should fetch from remote", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await syncBaseBranch(defaultGitConfig, { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["fetch", "origin", "master"], { cwd: "/tmp" });
  });

  it("should include --depth when fetchDepth > 0", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await syncBaseBranch({ ...defaultGitConfig, fetchDepth: 1 }, { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["fetch", "origin", "master", "--depth", "1"], { cwd: "/tmp" });
  });

  it("should throw on fetch failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "network error", exitCode: 1 });
    await expect(syncBaseBranch(defaultGitConfig, { cwd: "/tmp" })).rejects.toThrow("git fetch failed");
  });
});

describe("createWorkBranch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create branch with correct name", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const info = await createWorkBranch(defaultGitConfig, 42, "Add Login Feature", { cwd: "/tmp" });
    expect(info.workBranch).toBe("ax/42-add-login-feature");
    expect(info.baseBranch).toBe("master");
  });

  it("should delete and recreate if branch exists locally", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "  ax/42-test\n", stderr: "", exitCode: 0 }) // branch --list (exists)
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // branch -D
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // ls-remote (not on remote)
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // branch create
    const info = await createWorkBranch(defaultGitConfig, 42, "test", { cwd: "/tmp" });
    expect(info.workBranch).toBe("ax/42-test");
    expect(mockRunCli).toHaveBeenCalledWith("git", ["branch", "-D", "ax/42-test"], { cwd: "/tmp" });
  });

  it("should delete remote branch if exists", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // branch --list (empty)
      .mockResolvedValueOnce({ stdout: "abc123\trefs/heads/ax/42-test", stderr: "", exitCode: 0 }) // ls-remote (exists)
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // push --delete
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // branch create
    const info = await createWorkBranch(defaultGitConfig, 42, "test", { cwd: "/tmp" });
    expect(info.workBranch).toBe("ax/42-test");
    expect(mockRunCli).toHaveBeenCalledWith("git", ["push", "origin", "--delete", "ax/42-test"], { cwd: "/tmp" });
  });

  it("should create branch from remote base ref", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await createWorkBranch(defaultGitConfig, 42, "Fix bug", { cwd: "/tmp" });
    // 3rd call should be git branch ax/42-fix-bug origin/master
    expect(mockRunCli).toHaveBeenCalledWith("git", ["branch", "ax/42-fix-bug", "origin/master"], { cwd: "/tmp" });
  });
});
