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

import { runAnalyst } from "../../src/review/analyst-runner.js";
import { runClaude, extractJson } from "../../src/claude/claude-runner.js";
import { renderTemplate, loadTemplate } from "../../src/prompt/template-renderer.js";
import type { AnalystContext } from "../../src/review/analyst-runner.js";

const mockRunClaude = vi.mocked(runClaude);
const mockExtractJson = vi.mocked(extractJson);
const mockRenderTemplate = vi.mocked(renderTemplate);
const mockLoadTemplate = vi.mocked(loadTemplate);

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
  });

  it("should return COMPLETE when all requirements are implemented", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "claude output",
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
    });

    const result = await runAnalyst(mockContext);

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("error");
    expect(result.findings[0].message).toContain("Claude invocation failed");
    expect(result.summary).toBe("Analysis failed due to Claude error");
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
});