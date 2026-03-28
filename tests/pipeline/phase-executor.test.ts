import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
  runShell: vi.fn(),
}));
vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn().mockReturnValue("rendered prompt"),
  loadTemplate: vi.fn().mockReturnValue("template content"),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { executePhase } from "../../src/pipeline/phase-executor.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { runCli, runShell } from "../../src/utils/cli-runner.js";
import type { PhaseExecutorContext } from "../../src/pipeline/phase-executor.js";

import { renderTemplate, loadTemplate } from "../../src/prompt/template-renderer.js";

const mockRunClaude = vi.mocked(runClaude);
const mockRunCli = vi.mocked(runCli);
const mockRunShell = vi.mocked(runShell);
const mockRenderTemplate = vi.mocked(renderTemplate);
const mockLoadTemplate = vi.mocked(loadTemplate);

function makeCtx(overrides: Partial<PhaseExecutorContext> = {}): PhaseExecutorContext {
  return {
    issue: { number: 42, title: "Fix bug", body: "Fix it", labels: [] },
    plan: {
      issueNumber: 42,
      title: "Fix plan",
      problemDefinition: "A bug",
      requirements: [],
      affectedFiles: [],
      risks: [],
      phases: [
        {
          index: 0,
          name: "Phase One",
          description: "Do something",
          targetFiles: ["src/foo.ts"],
          commitStrategy: "atomic",
          verificationCriteria: [],
        },
      ],
      verificationPoints: [],
      stopConditions: [],
    },
    phase: {
      index: 0,
      name: "Phase One",
      description: "Do something",
      targetFiles: ["src/foo.ts"],
      commitStrategy: "atomic",
      verificationCriteria: [],
    },
    previousResults: [],
    claudeConfig: { path: "claude", model: "test", maxTurns: 1, timeout: 5000, additionalArgs: [] },
    promptsDir: "/tmp/prompts",
    cwd: "/tmp/project",
    testCommand: "npm test",
    lintCommand: "",
    gitPath: "git",
    ...overrides,
  };
}

describe("executePhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue("template content");
    mockRenderTemplate.mockReturnValue("rendered prompt");
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("returns success result when Claude succeeds and tests pass", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: "done" });
    // status --porcelain returns empty (no uncommitted changes)
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status
      .mockResolvedValueOnce({ stdout: "abc12345", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(true);
    expect(result.phaseIndex).toBe(0);
    expect(result.phaseName).toBe("Phase One");
    expect(result.commitHash).toBe("abc12345");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns failure result when Claude call fails", async () => {
    mockRunClaude.mockResolvedValue({ success: false, output: "Claude error: TS2345 type mismatch" });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(false);
    expect(result.phaseName).toBe("Phase One");
    expect(result.error).toContain("Phase implementation failed");
    expect(result.errorCategory).toBe("TS_ERROR");
  });

  it("returns failure when tests fail", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: "done" });
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status (clean)
      .mockResolvedValueOnce({ stdout: "deadbeef", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "3 tests failed", stderr: "", exitCode: 1 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe("VERIFICATION_FAILED");
    expect(result.error).toContain("Tests failed");
  });

  it("auto-commits when git status shows uncommitted changes", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: "done" });
    mockRunCli
      .mockResolvedValueOnce({ stdout: " M src/foo.ts\n", stderr: "", exitCode: 0 }) // status: dirty
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git add
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git commit
      .mockResolvedValueOnce({ stdout: "cafebabe", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(true);
    // Verify git add and commit were called
    const cliCalls = mockRunCli.mock.calls;
    expect(cliCalls.some(c => c[1][0] === "add")).toBe(true);
    expect(cliCalls.some(c => c[1][0] === "commit")).toBe(true);
  });

  it("skips tests when testCommand is empty", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: "done" });
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status (clean)
      .mockResolvedValueOnce({ stdout: "beefdead", stderr: "", exitCode: 0 }); // git log

    const result = await executePhase(makeCtx({ testCommand: "", lintCommand: "" }));

    expect(result.success).toBe(true);
    expect(mockRunShell).not.toHaveBeenCalled();
  });

  it("classifies TIMEOUT error correctly", async () => {
    mockRunClaude.mockResolvedValue({ success: false, output: "Process timed out after 120s" });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe("TIMEOUT");
  });

  it("includes durationMs in both success and failure results", async () => {
    mockRunClaude.mockResolvedValue({ success: false, output: "ENOENT: spawn git" });

    const result = await executePhase(makeCtx());

    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
