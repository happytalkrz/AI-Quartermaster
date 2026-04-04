import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

import { syncBaseBranch, createWorkBranch, deleteRemoteBranch, checkConflicts, attemptRebase, pushBranch } from "../../src/git/branch-manager.js";
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
    await expect(syncBaseBranch(defaultGitConfig, { cwd: "/tmp" })).rejects.toThrow("Git fetch failed: network error");
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

describe("deleteRemoteBranch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should delete remote branch successfully", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await deleteRemoteBranch(defaultGitConfig, "feature-branch", { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["push", "origin", "--delete", "feature-branch"], { cwd: "/tmp" });
  });

  it("should throw on delete failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "permission denied", exitCode: 1 });
    await expect(deleteRemoteBranch(defaultGitConfig, "feature-branch", { cwd: "/tmp" })).rejects.toThrow("Failed to delete remote branch feature-branch");
  });
});

describe("checkConflicts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return no conflicts when merge-tree succeeds without conflicts", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "abc123", stderr: "", exitCode: 0 }) // merge-base
      .mockResolvedValueOnce({ stdout: "clean merge output", stderr: "", exitCode: 0 }); // merge-tree

    const result = await checkConflicts(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result).toEqual({ hasConflicts: false, conflictFiles: [] });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["merge-base", "HEAD", "origin/master"], { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["merge-tree", "abc123", "HEAD", "origin/master"], { cwd: "/tmp" });
  });

  it("should detect conflicts from merge-tree output", async () => {
    const conflictOutput = `changed in both
  base   100644 abc123 src/file1.ts
  our    100644 def456 src/file1.ts
  their  100644 789abc src/file1.ts
<<<<<<< HEAD
our changes
=======
their changes
>>>>>>> origin/master`;

    mockRunCli
      .mockResolvedValueOnce({ stdout: "abc123", stderr: "", exitCode: 0 }) // merge-base
      .mockResolvedValueOnce({ stdout: conflictOutput, stderr: "", exitCode: 0 }); // merge-tree

    const result = await checkConflicts(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result.hasConflicts).toBe(true);
    expect(result.conflictFiles).toContain("src/file1.ts");
  });

  it("should handle merge-base failure gracefully", async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "no merge base", exitCode: 1 }); // merge-base fails

    const result = await checkConflicts(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result).toEqual({ hasConflicts: false, conflictFiles: [] });
    expect(mockRunCli).toHaveBeenCalledTimes(1);
  });

  it("should return generic conflict when unable to parse specific files", async () => {
    const malformedOutput = `changed in both
<<<<<<< HEAD
some content
=======
other content
>>>>>>> origin/master`;

    mockRunCli
      .mockResolvedValueOnce({ stdout: "abc123", stderr: "", exitCode: 0 }) // merge-base
      .mockResolvedValueOnce({ stdout: malformedOutput, stderr: "", exitCode: 0 }); // merge-tree

    const result = await checkConflicts(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result.hasConflicts).toBe(true);
    expect(result.conflictFiles).toEqual([]);
  });
});

describe("attemptRebase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should succeed when rebase completes without conflicts", async () => {
    mockRunCli.mockResolvedValue({ stdout: "Successfully rebased", stderr: "", exitCode: 0 });

    const result = await attemptRebase(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result).toEqual({ success: true });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["rebase", "origin/master"], { cwd: "/tmp" });
  });

  it("should abort and return error when rebase fails", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "CONFLICT: merge conflict in file.ts", exitCode: 1 }) // rebase fails
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase --abort succeeds

    const result = await attemptRebase(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Merge conflict");
    expect(mockRunCli).toHaveBeenCalledWith("git", ["rebase", "origin/master"], { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["rebase", "--abort"], { cwd: "/tmp" });
  });

  it("should handle rebase abort failure", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "rebase conflict", exitCode: 1 }) // rebase fails
      .mockResolvedValueOnce({ stdout: "", stderr: "abort failed", exitCode: 1 }); // rebase --abort fails

    const result = await attemptRebase(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("rebase conflict");
    expect(mockRunCli).toHaveBeenCalledWith("git", ["rebase", "--abort"], { cwd: "/tmp" });
  });

  it("should use stdout as error message when stderr is empty", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "stdout error message", stderr: "", exitCode: 1 }) // rebase fails
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rebase --abort succeeds

    const result = await attemptRebase(defaultGitConfig, "master", { cwd: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("stdout error message");
  });
});

describe("pushBranch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should push branch with upstream tracking", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await pushBranch(defaultGitConfig, "feature-branch", { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["push", "-u", "origin", "feature-branch"], { cwd: "/tmp" });
  });

  it("should throw on push failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "remote rejected", exitCode: 1 });

    await expect(pushBranch(defaultGitConfig, "feature-branch", { cwd: "/tmp" })).rejects.toThrow("Failed to push branch feature-branch");
  });

  it("should handle network errors during push", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "fatal: unable to access 'https://github.com/': Could not resolve host", exitCode: 128 });

    await expect(pushBranch(defaultGitConfig, "feature-branch", { cwd: "/tmp" })).rejects.toThrow("Failed to push branch feature-branch");
  });

  it("should handle permission denied errors", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "Permission denied (publickey)", exitCode: 128 });

    await expect(pushBranch(defaultGitConfig, "feature-branch", { cwd: "/tmp" })).rejects.toThrow("Failed to push branch feature-branch");
  });
});
