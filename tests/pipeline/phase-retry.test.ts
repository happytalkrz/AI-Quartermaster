import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";

// Mock dependencies
vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn(),
  loadTemplate: vi.fn(),
}));
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../src/claude/model-router.js", () => ({
  configForTask: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runShell: vi.fn(),
}));
vi.mock("../../src/pipeline/error-classifier.js", () => ({
  classifyError: vi.fn(),
}));
vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
  getHeadHash: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { retryPhase, type PhaseRetryContext } from "../../src/pipeline/phase-retry.js";
import { renderTemplate, loadTemplate } from "../../src/prompt/template-renderer.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { configForTask } from "../../src/claude/model-router.js";
import { runShell } from "../../src/utils/cli-runner.js";
import { classifyError } from "../../src/pipeline/error-classifier.js";
import { autoCommitIfDirty, getHeadHash } from "../../src/git/commit-helper.js";
import type { Plan, Phase, ErrorHistoryEntry } from "../../src/types/pipeline.js";
import type { GitHubIssue } from "../../src/github/issue-fetcher.js";

const mockRenderTemplate = vi.mocked(renderTemplate);
const mockLoadTemplate = vi.mocked(loadTemplate);
const mockRunClaude = vi.mocked(runClaude);
const mockConfigForTask = vi.mocked(configForTask);
const mockRunShell = vi.mocked(runShell);
const mockClassifyError = vi.mocked(classifyError);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockGetHeadHash = vi.mocked(getHeadHash);

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: "Test issue",
    body: "Test description",
    labels: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    issueNumber: 42,
    title: "Test Plan",
    problemDefinition: "Test problem",
    requirements: ["Test requirement"],
    affectedFiles: ["src/app.ts"],
    risks: ["Test risk"],
    phases: [makePhase(0, "TestPhase")],
    verificationPoints: ["Test verification"],
    stopConditions: ["Test stop condition"],
    ...overrides,
  };
}

function makePhase(index: number, name: string, dependsOn?: number[]): Phase {
  return {
    index,
    name,
    description: `Phase ${name} description`,
    targetFiles: [`src/${name.toLowerCase()}.ts`],
    commitStrategy: "atomic",
    verificationCriteria: [`${name} criteria`],
    dependsOn,
  };
}

function makeContext(overrides: Partial<PhaseRetryContext> = {}): PhaseRetryContext {
  return {
    issue: makeIssue(),
    plan: makePlan(),
    phase: makePhase(0, "TestPhase"),
    previousError: "Previous error message",
    errorCategory: "TS_ERROR",
    attempt: 1,
    maxRetries: 2,
    claudeConfig: { path: "claude", model: "test", maxTurns: 1, timeout: 5000, additionalArgs: [] },
    promptsDir: "/tmp/prompts",
    cwd: "/tmp/project",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    gitPath: "git",
    ...overrides,
  };
}

function makeErrorHistory(entries: Array<{ attempt: number; errorCategory: string; errorMessage: string }>): ErrorHistoryEntry[] {
  return entries.map(entry => ({
    attempt: entry.attempt,
    errorCategory: entry.errorCategory as any,
    errorMessage: entry.errorMessage,
    timestamp: "2024-01-01T00:00:00.000Z",
  }));
}

describe("retryPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue("Template content");
    mockRenderTemplate.mockReturnValue("Rendered content");
    mockRunClaude.mockResolvedValue({ success: true, output: "Claude success" });
    mockConfigForTask.mockReturnValue({ path: "claude", model: "test", maxTurns: 1, timeout: 5000, additionalArgs: [] });
    mockAutoCommitIfDirty.mockResolvedValue(false);
    mockGetHeadHash.mockResolvedValue("abc12345");
    mockRunShell.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  describe("error history rendering", () => {
    it("should render template without error history when none provided", async () => {
      const ctx = makeContext();

      await retryPhase(ctx);

      expect(mockRenderTemplate).toHaveBeenCalledWith("Template content", {
        issue: {
          number: "42",
          title: "Test issue",
        },
        phase: {
          index: "1",
          name: "TestPhase",
          description: "Phase TestPhase description",
          files: ["src/testphase.ts"],
          totalCount: "1",
        },
        retry: {
          attempt: "1",
          maxRetries: "2",
          errorCategory: "TS_ERROR",
          errorMessage: "Previous error message",
          errorHistory: undefined,
        },
        config: {
          testCommand: "npm test",
          lintCommand: "npm run lint",
        },
      });
    });

    it("should render template with error history when provided", async () => {
      const errorHistory = makeErrorHistory([
        { attempt: 0, errorCategory: "TS_ERROR", errorMessage: "Initial build error" },
        { attempt: 1, errorCategory: "TS_ERROR", errorMessage: "Retry failed with same error" },
      ]);

      const ctx = makeContext({
        errorHistory,
        attempt: 2,
      });

      await retryPhase(ctx);

      expect(mockRenderTemplate).toHaveBeenCalledWith("Template content", expect.objectContaining({
        retry: expect.objectContaining({
          attempt: "2",
          errorHistory: [
            { attempt: 0, errorCategory: "TS_ERROR", errorSummary: "Initial build error" },
            { attempt: 1, errorCategory: "TS_ERROR", errorSummary: "Retry failed with same error" },
          ],
        }),
      }));
    });

    it("should truncate long error messages in history", async () => {
      const longMessage = "x".repeat(500);
      const errorHistory = makeErrorHistory([
        { attempt: 0, errorCategory: "TS_ERROR", errorMessage: longMessage },
      ]);

      const ctx = makeContext({ errorHistory });

      await retryPhase(ctx);

      const renderCall = mockRenderTemplate.mock.calls[0][1] as any;
      const historyEntry = renderCall.retry.errorHistory[0];

      expect(historyEntry.errorSummary).toHaveLength(303); // 200 + 3 ("...") + 100
      expect(historyEntry.errorSummary).toMatch(/^x{200}\.\.\.x{100}$/);
    });

    it("should escape pipe characters in error messages for table formatting", async () => {
      const errorHistory = makeErrorHistory([
        { attempt: 0, errorCategory: "TS_ERROR", errorMessage: "Error with | pipe characters |" },
      ]);

      const ctx = makeContext({ errorHistory });

      await retryPhase(ctx);

      const renderCall = mockRenderTemplate.mock.calls[0][1] as any;
      const historyEntry = renderCall.retry.errorHistory[0];

      expect(historyEntry.errorSummary).toBe("Error with \\| pipe characters \\|");
    });

    it("should limit total error history length to stay within template bounds", async () => {
      // Create many long error messages to exceed the 3000 char limit
      const errorHistory = makeErrorHistory(
        Array.from({ length: 20 }, (_, i) => ({
          attempt: i,
          errorCategory: "TS_ERROR",
          errorMessage: `Error ${i}: ${"x".repeat(200)}`,
        }))
      );

      const ctx = makeContext({ errorHistory });

      await retryPhase(ctx);

      const renderCall = mockRenderTemplate.mock.calls[0][1] as any;
      const processedHistory = renderCall.retry.errorHistory;

      // Should have fewer entries due to length limit
      expect(processedHistory.length).toBeLessThan(20);

      // Calculate total length (rough estimate)
      const totalLength = processedHistory.reduce((sum: number, entry: any) =>
        sum + entry.errorSummary.length + 50, 0);
      expect(totalLength).toBeLessThanOrEqual(3000);
    });

    it("should use recent error as errorMessage when error history is provided", async () => {
      const errorHistory = makeErrorHistory([
        { attempt: 0, errorCategory: "TS_ERROR", errorMessage: "Very long initial error message that should be truncated in the main error display but preserved in history" },
      ]);

      const ctx = makeContext({
        errorHistory,
        previousError: "Very long recent error message that should be truncated to 500 chars for the main display",
      });

      await retryPhase(ctx);

      const renderCall = mockRenderTemplate.mock.calls[0][1] as any;

      // Should show last 500 chars of recent error for main errorMessage
      expect(renderCall.retry.errorMessage).toMatch(/^최근 에러: /);
      expect(renderCall.retry.errorMessage).toContain("Very long recent error message");
    });
  });

  describe("successful retry", () => {
    it("should return success result when Claude succeeds and tests pass", async () => {
      const ctx = makeContext();

      const result = await retryPhase(ctx);

      expect(result).toEqual({
        phaseIndex: 0,
        phaseName: "TestPhase",
        success: true,
        commitHash: "abc12345",
        durationMs: expect.any(Number),
      });
    });

    it("should auto-commit changes when dirty", async () => {
      mockAutoCommitIfDirty.mockResolvedValue(true);
      const ctx = makeContext();

      await retryPhase(ctx);

      expect(mockAutoCommitIfDirty).toHaveBeenCalledWith(
        "git",
        "/tmp/project",
        "[#42] Phase 0 fix: TestPhase"
      );
    });
  });

  describe("failed retry", () => {
    it("should return failure result when Claude fails", async () => {
      mockRunClaude.mockResolvedValue({ success: false, output: "Claude failed" });
      mockClassifyError.mockReturnValue("CLI_CRASH");

      const ctx = makeContext();

      const result = await retryPhase(ctx);

      expect(result).toEqual({
        phaseIndex: 0,
        phaseName: "TestPhase",
        success: false,
        error: "Phase retry failed: Claude failed",
        errorCategory: "CLI_CRASH",
        lastOutput: "Phase retry failed: Claude failed",
        durationMs: expect.any(Number),
      });
    });

    it("should return failure result when tests fail after Claude success", async () => {
      mockRunShell.mockResolvedValue({
        exitCode: 1,
        stdout: "Test output",
        stderr: "Test failed",
      });
      mockClassifyError.mockReturnValue("VERIFICATION_FAILED");

      const ctx = makeContext();

      const result = await retryPhase(ctx);

      expect(result).toEqual({
        phaseIndex: 0,
        phaseName: "TestPhase",
        success: false,
        error: "Tests failed after retry:\nTest output\nTest failed",
        errorCategory: "VERIFICATION_FAILED",
        lastOutput: expect.stringMatching(/Tests failed after retry/),
        durationMs: expect.any(Number),
      });
    });

    it("should skip test verification when testCommand is empty", async () => {
      const ctx = makeContext({ testCommand: "" });

      const result = await retryPhase(ctx);

      expect(mockRunShell).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("template loading", () => {
    it("should load template from correct path", async () => {
      const ctx = makeContext({ promptsDir: "/custom/prompts" });

      await retryPhase(ctx);

      expect(mockLoadTemplate).toHaveBeenCalledWith(
        resolve("/custom/prompts", "phase-retry.md")
      );
    });
  });

  describe("job logger integration", () => {
    it("should log progress when jobLogger is provided", async () => {
      const mockJobLogger = {
        log: vi.fn(),
        setProgress: vi.fn(),
        setStep: vi.fn(),
      };

      const ctx = makeContext({
        jobLogger: mockJobLogger,
        plan: makePlan({ phases: Array.from({ length: 5 }, (_, i) => makePhase(i, `Phase${i}`)) }),
        phase: makePhase(2, "CurrentPhase"),
      });

      await retryPhase(ctx);

      expect(mockJobLogger.log).toHaveBeenCalledWith("Claude 수정 중: CurrentPhase (retry 1)");
    });

    it("should handle stderr progress reporting from Claude", async () => {
      const mockJobLogger = {
        log: vi.fn(),
        setProgress: vi.fn(),
        setStep: vi.fn(),
      };

      // Mock Claude to call the stderr callback
      mockRunClaude.mockImplementation(async (opts: any) => {
        if (opts.onStderr) {
          opts.onStderr("[HEARTBEAT] Phase 2: Testing components (60%)");
          opts.onStderr("[INFO] Something else");
          opts.onStderr("Regular stderr line");
        }
        return { success: true, output: "Claude success" };
      });

      const ctx = makeContext({
        jobLogger: mockJobLogger,
        plan: makePlan({ phases: Array.from({ length: 5 }, (_, i) => makePhase(i, `Phase${i}`)) }),
        phase: makePhase(2, "CurrentPhase"),
      });

      await retryPhase(ctx);

      expect(mockJobLogger.log).toHaveBeenCalledWith("[HEARTBEAT] Phase 2: Testing components (60%)");
      expect(mockJobLogger.log).toHaveBeenCalledWith("[INFO] Something else");
      expect(mockJobLogger.log).not.toHaveBeenCalledWith("Regular stderr line");
      expect(mockJobLogger.setProgress).toHaveBeenCalled();
    });
  });
});