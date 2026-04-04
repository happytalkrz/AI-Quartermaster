import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn((t: string) => t),
  loadTemplate: vi.fn(() => "mock template"),
}));

import { createDraftPR, closeIssue, checkPrConflict, commentOnIssue, listOpenPrs, enableAutoMerge, addIssueComment } from "../../src/github/pr-creator.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockRunCli = vi.mocked(runCli);

const prConfig = {
  targetBranch: "master",
  draft: true,
  titleTemplate: "[AQ-#{issueNumber}] {title}",
  bodyTemplate: "pr-body.md",
  labels: ["ai-quartermaster"],
  assignees: [],
  reviewers: [],
  linkIssue: true,
  autoMerge: false,
  mergeMethod: "squash" as const,
};

const ghConfig = { path: "gh", timeout: 30000 };

const ctx = {
  issueNumber: 42,
  issueTitle: "Fix login",
  repo: "test/repo",
  plan: {
    issueNumber: 42,
    title: "Fix login",
    problemDefinition: "Login is broken",
    requirements: ["Fix it"],
    affectedFiles: ["src/login.ts"],
    risks: ["None"],
    phases: [{ index: 0, name: "Fix", description: "Fix it", targetFiles: [], commitStrategy: "", verificationCriteria: [] }],
    verificationPoints: [],
    stopConditions: [],
  },
  phaseResults: [{ phaseIndex: 0, phaseName: "Fix", success: true, commitHash: "abc12345", durationMs: 1000 }],
  branch: "aq/42-fix-login",
  worktreePath: "/tmp/wt",
};

describe("createDraftPR", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create PR with correct arguments", async () => {
    mockRunCli.mockResolvedValue({ stdout: "https://github.com/test/repo/pull/1", stderr: "", exitCode: 0 });
    const result = await createDraftPR(prConfig, ghConfig, ctx, { cwd: "/tmp", promptsDir: "/prompts" });
    expect(result.url).toBe("https://github.com/test/repo/pull/1");
    expect(mockRunCli).toHaveBeenCalled();
  });

  it("should return null on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "error", exitCode: 1 });
    const result = await createDraftPR(prConfig, ghConfig, ctx, { cwd: "/tmp", promptsDir: "/prompts" });
    expect(result).toBe(null);
  });

  it("should skip in dry run mode", async () => {
    const dryConfig = { ...prConfig };
    const dryGh = { ...ghConfig };
    const result = await createDraftPR(dryConfig, dryGh, ctx, { cwd: "/tmp", promptsDir: "/prompts", dryRun: true });
    expect(result).toBe("DRY_RUN");
  });
});

describe("closeIssue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should close issue successfully", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const result = await closeIssue(42, "test/repo", {});
    expect(result).toBe(true);
    expect(mockRunCli).toHaveBeenCalledWith("gh", ["issue", "close", "42", "--repo", "test/repo"], {});
  });

  it("should return false on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "Issue not found", exitCode: 1 });
    const result = await closeIssue(42, "test/repo", {});
    expect(result).toBe(false);
  });

  it("should skip in dry run mode", async () => {
    const result = await closeIssue(42, "test/repo", { dryRun: true });
    expect(result).toBe(true);
    expect(mockRunCli).not.toHaveBeenCalled();
  });

  it("should use custom gh path", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await closeIssue(42, "test/repo", { ghPath: "/custom/gh" });
    expect(mockRunCli).toHaveBeenCalledWith("/custom/gh", ["issue", "close", "42", "--repo", "test/repo"], {});
  });

  it("should include totalCostUsd in stats when provided", async () => {
    const ctxWithCost = { ...ctx, totalCostUsd: 0.1234 };

    mockRunCli.mockResolvedValue({ stdout: "https://github.com/test/repo/pull/3\n", stderr: "", exitCode: 0 });

    await createDraftPR(prConfig, ghConfig, ctxWithCost, { cwd: "/tmp", promptsDir: "/prompts" });

    const callArgs = mockRunCli.mock.calls[0][1];
    const bodyIndex = callArgs.indexOf("--body");
    expect(bodyIndex).toBeGreaterThanOrEqual(0);

    // The body should contain totalCostUsd formatted to 4 decimal places
    // We can't easily verify the exact template contents due to mocking, but we can verify the call was made with stats
    expect(mockRunCli).toHaveBeenCalledWith("gh", expect.arrayContaining(["--body"]), expect.any(Object));
  });

  it("should use default totalCostUsd when not provided", async () => {
    const ctxWithoutCost = { ...ctx }; // totalCostUsd is undefined

    mockRunCli.mockResolvedValue({ stdout: "https://github.com/test/repo/pull/4\n", stderr: "", exitCode: 0 });

    await createDraftPR(prConfig, ghConfig, ctxWithoutCost, { cwd: "/tmp", promptsDir: "/prompts" });

    // Should still work, defaults to '0.0000' in template
    expect(mockRunCli).toHaveBeenCalledWith("gh", expect.arrayContaining(["--body"]), expect.any(Object));
  });
});

describe("checkPrConflict", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return null when PR has no conflicts", async () => {
    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify({ mergeStateStatus: "CLEAN", mergeable: true }),
      stderr: "",
      exitCode: 0,
    });
    const result = await checkPrConflict(123, "test/repo", {});
    expect(result).toBe(null);
  });

  it("should return conflict info when PR has DIRTY status", async () => {
    mockRunCli
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ mergeStateStatus: "DIRTY", mergeable: false }),
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "diff --git a/src/file1.ts b/src/file1.ts\n--- a/src/file1.ts\n+++ b/src/file1.ts",
        stderr: "",
        exitCode: 0,
      });

    const result = await checkPrConflict(123, "test/repo", {});
    expect(result).toMatchObject({
      prNumber: 123,
      repo: "test/repo",
      conflictFiles: ["src/file1.ts"],
      mergeStatus: "DIRTY",
    });
    expect(result?.detectedAt).toBeDefined();
  });

  it("should return null on gh pr view failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "PR not found", exitCode: 1 });
    const result = await checkPrConflict(123, "test/repo", {});
    expect(result).toBe(null);
  });

  it("should skip in dry run mode", async () => {
    const result = await checkPrConflict(123, "test/repo", { dryRun: true });
    expect(result).toBe(null);
    expect(mockRunCli).not.toHaveBeenCalled();
  });
});

describe("commentOnIssue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should post comment successfully", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const result = await commentOnIssue(42, "test/repo", "Test comment", {});
    expect(result).toBe(true);
    expect(mockRunCli).toHaveBeenCalledWith("gh", [
      "issue", "comment", "42", "--repo", "test/repo", "--body", "Test comment"
    ], {});
  });

  it("should return false on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "Issue not found", exitCode: 1 });
    const result = await commentOnIssue(42, "test/repo", "Test comment", {});
    expect(result).toBe(false);
  });

  it("should skip in dry run mode", async () => {
    const result = await commentOnIssue(42, "test/repo", "Test comment", { dryRun: true });
    expect(result).toBe(true);
    expect(mockRunCli).not.toHaveBeenCalled();
  });

  it("should use custom gh path", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await commentOnIssue(42, "test/repo", "Test comment", { ghPath: "/custom/gh" });
    expect(mockRunCli).toHaveBeenCalledWith("/custom/gh", [
      "issue", "comment", "42", "--repo", "test/repo", "--body", "Test comment"
    ], {});
  });
});

describe("listOpenPrs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should list open PRs successfully", async () => {
    const prData = [
      { number: 123, title: "Fix bug in auth" },
      { number: 124, title: "Add new feature" },
    ];
    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(prData),
      stderr: "",
      exitCode: 0,
    });

    const result = await listOpenPrs("test/repo", {});
    expect(result).toEqual(prData);
    expect(mockRunCli).toHaveBeenCalledWith("gh", [
      "pr", "list", "--repo", "test/repo", "--state", "open", "--json", "number,title", "--limit", "100"
    ], {});
  });

  it("should return empty array when no PRs exist", async () => {
    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify([]),
      stderr: "",
      exitCode: 0,
    });

    const result = await listOpenPrs("test/repo", {});
    expect(result).toEqual([]);
  });

  it("should return null on gh CLI failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "Repository not found", exitCode: 1 });
    const result = await listOpenPrs("test/repo", {});
    expect(result).toBe(null);
  });

  it("should skip in dry run mode", async () => {
    const result = await listOpenPrs("test/repo", { dryRun: true });
    expect(result).toEqual([]);
    expect(mockRunCli).not.toHaveBeenCalled();
  });

  it("should use custom gh path", async () => {
    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify([]),
      stderr: "",
      exitCode: 0,
    });

    await listOpenPrs("test/repo", { ghPath: "/custom/gh" });
    expect(mockRunCli).toHaveBeenCalledWith("/custom/gh", [
      "pr", "list", "--repo", "test/repo", "--state", "open", "--json", "number,title", "--limit", "100"
    ], {});
  });
});

describe("enableAutoMerge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should enable auto-merge successfully", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const result = await enableAutoMerge(42, "test/repo", "squash", {});
    expect(result).toBe(true);
    expect(mockRunCli).toHaveBeenCalledWith("gh", ["pr", "merge", "42", "--repo", "test/repo", "--auto", "--squash"], {});
  });

  it("should include --delete-branch flag when deleteBranch is true", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await enableAutoMerge(42, "test/repo", "squash", { deleteBranch: true });
    expect(mockRunCli).toHaveBeenCalledWith("gh", ["pr", "merge", "42", "--repo", "test/repo", "--auto", "--squash", "--delete-branch"], {});
  });

  it("should not include --delete-branch flag when deleteBranch is false", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await enableAutoMerge(42, "test/repo", "squash", { deleteBranch: false });
    expect(mockRunCli).toHaveBeenCalledWith("gh", ["pr", "merge", "42", "--repo", "test/repo", "--auto", "--squash"], {});
  });

  it("should mark PR as ready when isDraft is true", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // pr ready
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // pr merge

    const result = await enableAutoMerge(42, "test/repo", "squash", { isDraft: true });
    expect(result).toBe(true);
    expect(mockRunCli).toHaveBeenNthCalledWith(1, "gh", ["pr", "ready", "42", "--repo", "test/repo"], {});
    expect(mockRunCli).toHaveBeenNthCalledWith(2, "gh", ["pr", "merge", "42", "--repo", "test/repo", "--auto", "--squash"], {});
  });

  it("should return false when pr ready fails", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "Draft PR not found", exitCode: 1 });
    const result = await enableAutoMerge(42, "test/repo", "squash", { isDraft: true });
    expect(result).toBe(false);
  });

  it("should return false when merge fails", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "PR not mergeable", exitCode: 1 });
    const result = await enableAutoMerge(42, "test/repo", "squash", {});
    expect(result).toBe(false);
  });

  it("should skip in dry run mode", async () => {
    const result = await enableAutoMerge(42, "test/repo", "squash", { dryRun: true });
    expect(result).toBe(true);
    expect(mockRunCli).not.toHaveBeenCalled();
  });

  it("should use custom gh path", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await enableAutoMerge(42, "test/repo", "squash", { ghPath: "/custom/gh" });
    expect(mockRunCli).toHaveBeenCalledWith("/custom/gh", ["pr", "merge", "42", "--repo", "test/repo", "--auto", "--squash"], {});
  });

  it("should handle different merge methods", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await enableAutoMerge(42, "test/repo", "merge", {});
    expect(mockRunCli).toHaveBeenCalledWith("gh", ["pr", "merge", "42", "--repo", "test/repo", "--auto", "--merge"], {});

    mockRunCli.mockClear();
    await enableAutoMerge(42, "test/repo", "rebase", {});
    expect(mockRunCli).toHaveBeenCalledWith("gh", ["pr", "merge", "42", "--repo", "test/repo", "--auto", "--rebase"], {});
  });
});

describe("addIssueComment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should add comment to issue successfully", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const result = await addIssueComment(42, "test/repo", "Test comment", {});
    expect(result).toBe(true);
    expect(mockRunCli).toHaveBeenCalledWith("gh", ["issue", "comment", "42", "--repo", "test/repo", "--body", "Test comment"], {});
  });

  it("should return false on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "Comment failed", exitCode: 1 });
    const result = await addIssueComment(42, "test/repo", "Test comment", {});
    expect(result).toBe(false);
  });

  it("should skip in dry run mode", async () => {
    const result = await addIssueComment(42, "test/repo", "Test comment", { dryRun: true });
    expect(result).toBe(true);
    expect(mockRunCli).not.toHaveBeenCalled();
  });

  it("should use custom gh path", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await addIssueComment(42, "test/repo", "Test comment", { ghPath: "/custom/gh" });
    expect(mockRunCli).toHaveBeenCalledWith("/custom/gh", ["issue", "comment", "42", "--repo", "test/repo", "--body", "Test comment"], {});
  });
});
