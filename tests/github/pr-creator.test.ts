import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn((t: string) => t),
  loadTemplate: vi.fn(() => "mock template"),
}));

import { createDraftPR } from "../../src/github/pr-creator.js";
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
