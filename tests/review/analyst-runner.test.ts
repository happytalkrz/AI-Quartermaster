import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";

vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn(),
  loadTemplate: vi.fn(),
}));

vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
  extractJson: vi.fn(),
}));

vi.mock("../../src/review/token-estimator.js", () => ({
  exceedsTokenLimit: vi.fn(),
  analyzeTokenUsage: vi.fn(),
}));

vi.mock("../../src/review/diff-splitter.js", () => ({
  splitDiffByFiles: vi.fn(),
  groupFilesByTokenBudget: vi.fn(),
  combineBatchDiffs: vi.fn(),
  generateSplitStats: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { runAnalyst } from "../../src/review/analyst-runner.js";
import { runClaude, extractJson } from "../../src/claude/claude-runner.js";
import { renderTemplate, loadTemplate } from "../../src/prompt/template-renderer.js";
import { analyzeTokenUsage } from "../../src/review/token-estimator.js";
import { splitDiffByFiles, groupFilesByTokenBudget, combineBatchDiffs, generateSplitStats } from "../../src/review/diff-splitter.js";
import type { AnalystContext } from "../../src/review/analyst-runner.js";

const mockRunClaude = vi.mocked(runClaude);
const mockExtractJson = vi.mocked(extractJson);
const mockRenderTemplate = vi.mocked(renderTemplate);
const mockLoadTemplate = vi.mocked(loadTemplate);
const mockAnalyzeTokenUsage = vi.mocked(analyzeTokenUsage);
const mockSplitDiffByFiles = vi.mocked(splitDiffByFiles);
const mockGroupFilesByTokenBudget = vi.mocked(groupFilesByTokenBudget);
const mockCombineBatchDiffs = vi.mocked(combineBatchDiffs);
const mockGenerateSplitStats = vi.mocked(generateSplitStats);

describe("runAnalyst", () => {
  const mockContext: AnalystContext = {
    promptsDir: "/test/prompts",
    claudeConfig: {
      path: "claude",
      model: "sonnet",
      timeout: 30000,
      maxRetries: 2,
      retryDelay: 1000,
    },
    cwd: "/test/workspace",
    variables: {
      issue: { number: "123", title: "Test Issue", body: "Test body" },
      plan: { summary: "Test plan" },
      diff: { full: "test diff" },
      config: { testCommand: "npm test", lintCommand: "npm run lint" },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue("template content");
    mockRenderTemplate.mockReturnValue("rendered content");

    // 기본적으로 토큰 한도 내에 있다고 설정
    mockAnalyzeTokenUsage.mockReturnValue({
      estimatedTokens: 50000,
      modelLimit: 200000,
      effectiveLimit: 160000,
      exceedsLimit: false,
      usagePercentage: 31.25,
    });
  });

  it("should return COMPLETE when all requirements are implemented", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "claude output",
      costUsd: 0.05,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
      },
      durationMs: 1500,
    });

    mockExtractJson.mockReturnValue({
      verdict: "COMPLETE",
      findings: [],
      summary: "All requirements implemented",
      coverage: {
        implemented: ["feature A", "feature B"],
        missing: [],
        excess: [],
      },
    });

    const result = await runAnalyst(mockContext);

    expect(result).toEqual({
      verdict: "COMPLETE",
      findings: [],
      summary: "All requirements implemented",
      coverage: {
        implemented: ["feature A", "feature B"],
        missing: [],
        excess: [],
      },
      durationMs: expect.any(Number),
      costUsd: 0.05,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
      },
    });

    expect(mockLoadTemplate).toHaveBeenCalledWith(
      resolve("/test/prompts", "analyst-requirements.md")
    );
    expect(mockRenderTemplate).toHaveBeenCalledWith(
      "template content",
      mockContext.variables
    );
    expect(mockRunClaude).toHaveBeenCalledWith({
      prompt: "rendered content",
      cwd: "/test/workspace",
      config: mockContext.claudeConfig,
      enableAgents: false,
    });
  });

  it("should return INCOMPLETE when requirements are missing", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "claude output",
    });

    mockExtractJson.mockReturnValue({
      verdict: "INCOMPLETE",
      findings: [
        {
          type: "missing",
          requirement: "Feature C implementation",
          severity: "error",
          message: "Feature C is not implemented",
          suggestion: "Implement Feature C"
        }
      ],
      summary: "Missing critical features",
      coverage: {
        implemented: ["feature A"],
        missing: ["feature C"],
        excess: [],
      },
    });

    const result = await runAnalyst(mockContext);

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].type).toBe("missing");
    expect(result.coverage.missing).toContain("feature C");
  });

  it("should return MISALIGNED when implementation doesn't match requirements", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "claude output",
    });

    mockExtractJson.mockReturnValue({
      verdict: "MISALIGNED",
      findings: [
        {
          type: "mismatch",
          requirement: "API should return JSON",
          implementation: "API returns XML",
          severity: "error",
          message: "API format mismatch",
        }
      ],
      summary: "Implementation doesn't match spec",
      coverage: {
        implemented: ["API"],
        missing: [],
        excess: [],
      },
    });

    const result = await runAnalyst(mockContext);

    expect(result.verdict).toBe("MISALIGNED");
    expect(result.findings[0].type).toBe("mismatch");
  });

  it("should handle Claude execution failure", async () => {
    mockRunClaude.mockResolvedValue({
      success: false,
      output: "Claude error message",
      costUsd: 0.01,
      usage: {
        input_tokens: 100,
        output_tokens: 0,
      },
      durationMs: 500,
    });

    const result = await runAnalyst(mockContext);

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("error");
    expect(result.findings[0].message).toContain("Claude invocation failed");
    expect(result.summary).toBe("Analysis failed due to Claude error");
    expect(result.costUsd).toBe(0.01);
    expect(result.usage).toEqual({
      input_tokens: 100,
      output_tokens: 0,
    });
  });

  it("should handle JSON parsing failure gracefully", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: 'not valid json but contains "complete"',
    });

    mockExtractJson.mockImplementation(() => {
      throw new Error("Invalid JSON");
    });

    const result = await runAnalyst(mockContext);

    expect(result.verdict).toBe("COMPLETE");
    expect(result.summary).toContain("not valid json");
    expect(result.coverage).toEqual({ implemented: [], missing: [], excess: [] });
  });

  it("should detect MISALIGNED verdict from text fallback", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: 'verdict: misaligned - implementation is wrong',
    });

    mockExtractJson.mockImplementation(() => {
      throw new Error("Invalid JSON");
    });

    const result = await runAnalyst(mockContext);

    expect(result.verdict).toBe("MISALIGNED");
  });

  describe("split analysis", () => {
    it("should run split analysis when token limit is exceeded", async () => {
      // Token limit 초과 설정
      mockAnalyzeTokenUsage.mockReturnValue({
        estimatedTokens: 180000,
        modelLimit: 200000,
        effectiveLimit: 160000,
        exceedsLimit: true,
        usagePercentage: 112.5,
      });

      // diff 분할 mock 설정
      mockSplitDiffByFiles.mockReturnValue([
        { filePath: "file1.ts", diffContent: "diff1", estimatedTokens: 50000 },
        { filePath: "file2.ts", diffContent: "diff2", estimatedTokens: 60000 },
      ]);

      mockGroupFilesByTokenBudget.mockReturnValue([
        {
          files: [{ filePath: "file1.ts", diffContent: "diff1", estimatedTokens: 50000 }],
          totalEstimatedTokens: 80000,
          batchIndex: 0,
        },
        {
          files: [{ filePath: "file2.ts", diffContent: "diff2", estimatedTokens: 60000 }],
          totalEstimatedTokens: 90000,
          batchIndex: 1,
        },
      ]);

      mockCombineBatchDiffs
        .mockReturnValueOnce("diff1")
        .mockReturnValueOnce("diff2");

      mockGenerateSplitStats.mockReturnValue({
        totalFiles: 2,
        totalBatches: 2,
        totalTokens: 110000,
        filesPerBatch: [1, 1],
        tokensPerBatch: [50000, 60000],
      });

      // 각 배치에 대해 Claude 응답 설정
      mockRunClaude
        .mockResolvedValueOnce({
          success: true,
          output: "batch1 output",
          costUsd: 0.02,
          usage: { input_tokens: 500, output_tokens: 300 },
          durationMs: 1000
        })
        .mockResolvedValueOnce({
          success: true,
          output: "batch2 output",
          costUsd: 0.03,
          usage: { input_tokens: 600, output_tokens: 400, cache_read_input_tokens: 100 },
          durationMs: 1200
        });

      mockExtractJson
        .mockReturnValueOnce({
          verdict: "INCOMPLETE",
          findings: [{ type: "missing", requirement: "Feature A", severity: "error", message: "Missing A" }],
          summary: "Batch 1 analysis",
          coverage: { implemented: ["featureX"], missing: ["featureA"], excess: [] },
        })
        .mockReturnValueOnce({
          verdict: "COMPLETE",
          findings: [],
          summary: "Batch 2 analysis",
          coverage: { implemented: ["featureY"], missing: [], excess: [] },
        });

      const result = await runAnalyst(mockContext);

      expect(result.verdict).toBe("INCOMPLETE");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].requirement).toBe("Feature A");
      expect(result.coverage.implemented).toEqual(["featureX", "featureY"]);
      expect(result.coverage.missing).toEqual(["featureA"]);
      expect(result.summary).toContain("Split analysis from 2 batches");
      expect(result.costUsd).toBe(0.05); // 0.02 + 0.03
      expect(result.usage).toEqual({
        input_tokens: 1100, // 500 + 600
        output_tokens: 700, // 300 + 400
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100,
      });
    });

    it("should fall back to single analysis if no files to split", async () => {
      // Token limit 초과 설정
      mockAnalyzeTokenUsage.mockReturnValue({
        estimatedTokens: 180000,
        modelLimit: 200000,
        effectiveLimit: 160000,
        exceedsLimit: true,
        usagePercentage: 112.5,
      });

      // 빈 파일 배열 반환
      mockSplitDiffByFiles.mockReturnValue([]);

      mockRunClaude.mockResolvedValue({
        success: true,
        output: "single analysis output",
      });

      mockExtractJson.mockReturnValue({
        verdict: "COMPLETE",
        findings: [],
        summary: "Single analysis",
        coverage: { implemented: ["feature"], missing: [], excess: [] },
      });

      const result = await runAnalyst(mockContext);

      expect(result.verdict).toBe("COMPLETE");
      expect(result.summary).toBe("Single analysis");
      expect(mockSplitDiffByFiles).toHaveBeenCalled();
    });
  });
});