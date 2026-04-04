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
vi.mock("../../src/review/token-estimator.js", () => ({
  analyzeTokenUsage: vi.fn(),
  summarizeForBudget: vi.fn(),
}));

import { executePhase } from "../../src/pipeline/phase-executor.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { runCli, runShell } from "../../src/utils/cli-runner.js";
import type { PhaseExecutorContext } from "../../src/pipeline/phase-executor.js";

import { renderTemplate, loadTemplate } from "../../src/prompt/template-renderer.js";
import { analyzeTokenUsage, summarizeForBudget } from "../../src/review/token-estimator.js";

const mockRunClaude = vi.mocked(runClaude);
const mockRunCli = vi.mocked(runCli);
const mockRunShell = vi.mocked(runShell);
const mockRenderTemplate = vi.mocked(renderTemplate);
const mockLoadTemplate = vi.mocked(loadTemplate);
const mockAnalyzeTokenUsage = vi.mocked(analyzeTokenUsage);
const mockSummarizeForBudget = vi.mocked(summarizeForBudget);

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
          dependsOn: [],
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
      dependsOn: [],
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
    mockAnalyzeTokenUsage.mockReturnValue({
      estimatedTokens: 1000,
      modelLimit: 200000,
      effectiveLimit: 160000,
      exceedsLimit: false,
      usagePercentage: 0.6,
    });
    mockSummarizeForBudget.mockReturnValue("summarized content");
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

  it("includes costUsd when Claude returns cost information", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: "done", costUsd: 0.025 });
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status (clean)
      .mockResolvedValueOnce({ stdout: "abc12345", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(true);
    expect(result.costUsd).toBe(0.025);
  });

  it("includes costUsd in failure result when available", async () => {
    mockRunClaude.mockResolvedValue({ success: false, output: "Claude failed", costUsd: 0.015 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(false);
    expect(result.costUsd).toBe(0.015);
  });

  it("costUsd is undefined when Claude does not provide cost", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: "done" }); // no costUsd field
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status (clean)
      .mockResolvedValueOnce({ stdout: "abc12345", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(true);
    expect(result.costUsd).toBeUndefined();
  });

  it("checks token usage and logs warning when budget exceeded", async () => {
    // Mock token usage that exceeds budget
    mockAnalyzeTokenUsage.mockReturnValue({
      estimatedTokens: 180000,
      modelLimit: 200000,
      effectiveLimit: 160000,
      exceedsLimit: true,
      usagePercentage: 112.5,
    });

    mockRunClaude.mockResolvedValue({ success: true, output: "done" });
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status (clean)
      .mockResolvedValueOnce({ stdout: "abc12345", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(true);
    expect(mockAnalyzeTokenUsage).toHaveBeenCalled();
  });

  it("optimizes previousResults when budget exceeded and previousSummary is long", async () => {
    // Mock token usage that exceeds budget
    mockAnalyzeTokenUsage
      .mockReturnValueOnce({
        estimatedTokens: 180000,
        modelLimit: 200000,
        effectiveLimit: 160000,
        exceedsLimit: true,
        usagePercentage: 112.5,
      })
      .mockReturnValueOnce({
        estimatedTokens: 150000,
        modelLimit: 200000,
        effectiveLimit: 160000,
        exceedsLimit: false,
        usagePercentage: 93.75,
      });

    // Create long previousResults to generate a summary over 1000 characters
    const longPreviousResults = [];
    for (let i = 0; i < 50; i++) {
      longPreviousResults.push({
        phaseIndex: i,
        phaseName: `Very long phase name that will contribute to making the summary exceed 1000 characters when combined with many other phases - Phase ${i}`,
        success: i % 2 === 0,
      });
    }

    mockSummarizeForBudget.mockReturnValue("optimized summary");

    mockRunClaude.mockResolvedValue({ success: true, output: "done" });
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status (clean)
      .mockResolvedValueOnce({ stdout: "abc12345", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx({ previousResults: longPreviousResults }));

    expect(result.success).toBe(true);
    expect(mockAnalyzeTokenUsage).toHaveBeenCalledTimes(2);
    expect(mockSummarizeForBudget).toHaveBeenCalled();
    expect(mockRenderTemplate).toHaveBeenCalledTimes(2); // Initial render + optimized render
  });

  it("analyzes token usage with correct model name from config", async () => {
    const ctx = makeCtx({
      claudeConfig: {
        path: "claude",
        model: "claude-sonnet-4-20250514",
        models: { plan: "claude-opus-4-6", phase: "claude-sonnet-4-6", review: "claude-haiku-4-5", fallback: "claude-sonnet-4-20250514" },
        maxTurns: 1,
        timeout: 5000,
        additionalArgs: [],
      },
    });

    mockRunClaude.mockResolvedValue({ success: true, output: "done" });
    mockRunCli
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git status (clean)
      .mockResolvedValueOnce({ stdout: "abc12345", stderr: "", exitCode: 0 }); // git log
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await executePhase(ctx);

    expect(result.success).toBe(true);
    expect(mockAnalyzeTokenUsage).toHaveBeenCalledWith("rendered prompt", "claude-sonnet-4-6");
  });
});
