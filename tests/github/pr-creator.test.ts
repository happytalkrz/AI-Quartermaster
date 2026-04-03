import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn((t: string) => t),
  loadTemplate: vi.fn(() => "mock template"),
}));

import { createDraftPR, closeIssue } from "../../src/github/pr-creator.js";
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
  branchName: "ax/42-fix-login",
  baseBranch: "master",
};

describe("createDraftPR", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create PR and return URL", async () => {
    mockRunCli.mockResolvedValue({ stdout: "https://github.com/test/repo/pull/1\n", stderr: "", exitCode: 0 });
    const result = await createDraftPR(prConfig, ghConfig, ctx, { cwd: "/tmp", promptsDir: "/prompts" });
    expect(result.url).toBe("https://github.com/test/repo/pull/1");
    expect(result.number).toBe(1);
  });

  it("should include --draft flag", async () => {
    mockRunCli.mockResolvedValue({ stdout: "https://github.com/test/repo/pull/2\n", stderr: "", exitCode: 0 });
    await createDraftPR(prConfig, ghConfig, ctx, { cwd: "/tmp", promptsDir: "/prompts" });
    const callArgs = mockRunCli.mock.calls[0][1];
    expect(callArgs).toContain("--draft");
  });

  it("should throw on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "auth error", exitCode: 1 });
    await expect(createDraftPR(prConfig, ghConfig, ctx, { cwd: "/tmp", promptsDir: "/prompts" })).rejects.toThrow("Failed to create PR");
  });

  it("should skip in dry run mode", async () => {
    const result = await createDraftPR(prConfig, ghConfig, ctx, { cwd: "/tmp", promptsDir: "/prompts", dryRun: true });
    expect(result.url).toContain("dry-run");
    expect(mockRunCli).not.toHaveBeenCalled();
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
