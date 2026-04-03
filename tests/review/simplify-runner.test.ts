import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn((t: string) => t),
  loadTemplate: vi.fn(() => "mock template"),
}));
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../src/claude/model-router.js", () => ({
  configForTask: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
  runShell: vi.fn(),
}));
vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
}));
vi.mock("../../src/git/diff-collector.js", () => ({
  parseNumstat: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { runSimplify } from "../../src/review/simplify-runner.js";
import { renderTemplate, loadTemplate } from "../../src/prompt/template-renderer.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { configForTask } from "../../src/claude/model-router.js";
import { runCli, runShell } from "../../src/utils/cli-runner.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";
import { parseNumstat } from "../../src/git/diff-collector.js";
import type { SimplifyContext } from "../../src/review/simplify-runner.js";

const mockRenderTemplate = vi.mocked(renderTemplate);
const mockLoadTemplate = vi.mocked(loadTemplate);
const mockRunClaude = vi.mocked(runClaude);
const mockConfigForTask = vi.mocked(configForTask);
const mockRunCli = vi.mocked(runCli);
const mockRunShell = vi.mocked(runShell);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockParseNumstat = vi.mocked(parseNumstat);

const mockContext: SimplifyContext = {
  promptTemplate: "simplify.md",
  promptsDir: "/prompts",
  claudeConfig: {
    path: "claude",
    model: "test",
    maxTurns: 1,
    timeout: 10000,
    additionalArgs: [],
  },
  cwd: "/tmp/test",
  testCommand: "npm test",
  variables: { issue: { number: "123", title: "Test Issue" } },
};

describe("runSimplify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue("mock template");
    mockRenderTemplate.mockReturnValue("rendered template");
    mockConfigForTask.mockReturnValue({ model: "test", timeout: 10000 });
  });

  it("should return failure when Claude invocation fails", async () => {
    mockRunClaude.mockResolvedValue({
      success: false,
      output: "Claude error",
      durationMs: 100,
    });

    const result = await runSimplify(mockContext);

    expect(result).toEqual({
      applied: false,
      linesRemoved: 0,
      linesAdded: 0,
      filesModified: [],
      testsPassed: true,
      rolledBack: false,
      summary: "Claude invocation failed",
    });
    expect(mockRunClaude).toHaveBeenCalledWith({
      prompt: "rendered template",
      cwd: "/tmp/test",
      config: { model: "test", timeout: 10000 },
    });
  });

  it("should return no changes when no modifications are made", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "No changes needed",
      durationMs: 100,
    });
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const result = await runSimplify(mockContext);

    expect(result).toEqual({
      applied: false,
      linesRemoved: 0,
      linesAdded: 0,
      filesModified: [],
      testsPassed: true,
      rolledBack: false,
      summary: "No changes needed",
    });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["diff", "--numstat", "HEAD"], {
      cwd: "/tmp/test",
    });
  });

  it("should rollback when tests fail after simplification", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "Simplified code",
      durationMs: 100,
    });
    mockRunCli.mockResolvedValue({
      stdout: "2\t1\tsrc/test.ts\n",
      stderr: "",
      exitCode: 0,
    });
    mockRunShell.mockResolvedValue({
      stdout: "Test failed",
      stderr: "Error in tests",
      exitCode: 1,
    });

    const result = await runSimplify(mockContext);

    expect(result).toEqual({
      applied: false,
      linesRemoved: 0,
      linesAdded: 0,
      filesModified: [],
      testsPassed: false,
      rolledBack: true,
      summary: "Simplification rolled back due to test failure",
    });
    expect(mockRunShell).toHaveBeenCalledWith("npm test", {
      cwd: "/tmp/test",
      timeout: 120000,
    });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["checkout", "."], {
      cwd: "/tmp/test",
    });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["clean", "-fd"], {
      cwd: "/tmp/test",
    });
  });

  it("should successfully apply simplification when tests pass", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "Simplified code successfully",
      durationMs: 100,
    });
    mockRunCli.mockResolvedValue({
      stdout: "3\t5\tsrc/test.ts\n2\t1\tsrc/utils.ts\n",
      stderr: "",
      exitCode: 0,
    });
    mockRunShell.mockResolvedValue({
      stdout: "All tests passed",
      stderr: "",
      exitCode: 0,
    });
    mockParseNumstat.mockReturnValue({
      insertions: 5,
      deletions: 6,
      files: ["src/test.ts", "src/utils.ts"],
    });

    const result = await runSimplify(mockContext);

    expect(result).toEqual({
      applied: true,
      linesRemoved: 6,
      linesAdded: 5,
      filesModified: ["src/test.ts", "src/utils.ts"],
      testsPassed: true,
      rolledBack: false,
      summary: "Simplified 2 files (+5 -6)",
    });
    expect(mockParseNumstat).toHaveBeenCalledWith("3\t5\tsrc/test.ts\n2\t1\tsrc/utils.ts\n");
    expect(mockAutoCommitIfDirty).toHaveBeenCalledWith("git", "/tmp/test", "refactor: code simplification");
  });

  it("should use custom git path when provided", async () => {
    const contextWithGitPath = {
      ...mockContext,
      gitPath: "/usr/bin/git",
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: "Simplified code",
      durationMs: 100,
    });
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    await runSimplify(contextWithGitPath);

    expect(mockRunCli).toHaveBeenCalledWith("/usr/bin/git", ["diff", "--numstat", "HEAD"], {
      cwd: "/tmp/test",
    });
  });

  it("should pass template variables correctly to renderer", async () => {
    const contextWithVariables = {
      ...mockContext,
      variables: {
        issue: { number: "456", title: "Complex Issue" },
        customVar: "test value",
      },
    };

    mockRunClaude.mockResolvedValue({
      success: false,
      output: "Error",
      durationMs: 50,
    });

    await runSimplify(contextWithVariables);

    expect(mockRenderTemplate).toHaveBeenCalledWith("mock template", {
      issue: { number: "456", title: "Complex Issue" },
      customVar: "test value",
    });
  });

  it("should handle diff parsing with no files", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "Minor changes",
      durationMs: 100,
    });
    mockRunCli.mockResolvedValue({
      stdout: "0\t0\t\n",
      stderr: "",
      exitCode: 0,
    });
    mockRunShell.mockResolvedValue({
      stdout: "Tests passed",
      stderr: "",
      exitCode: 0,
    });
    mockParseNumstat.mockReturnValue({
      insertions: 0,
      deletions: 0,
      files: [],
    });

    const result = await runSimplify(mockContext);

    expect(result.applied).toBe(true);
    expect(result.filesModified).toEqual([]);
    expect(result.summary).toBe("Simplified 0 files (+0 -0)");
  });
});