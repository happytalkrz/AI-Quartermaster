import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
  extractJson: vi.fn(),
}));
vi.mock("../../src/prompt/template-renderer.js", () => ({
  renderTemplate: vi.fn((t: string) => t),
  loadTemplate: vi.fn(() => "mock template"),
}));

import { runReviewRound } from "../../src/review/review-runner.js";
import { runClaude, extractJson } from "../../src/claude/claude-runner.js";

const mockRunClaude = vi.mocked(runClaude);
const mockExtractJson = vi.mocked(extractJson);

const claudeConfig = { path: "claude", model: "test", maxTurns: 1, timeout: 1000, additionalArgs: [] };

describe("runReviewRound", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return PASS when Claude returns PASS verdict", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: '{"verdict":"PASS"}', durationMs: 100 });
    mockExtractJson.mockReturnValue({ verdict: "PASS", findings: [], summary: "All good" });

    const result = await runReviewRound({
      roundName: "Test Round",
      promptTemplate: "test.md",
      promptsDir: "/prompts",
      claudeConfig,
      cwd: "/tmp",
      variables: {},
    });
    expect(result.verdict).toBe("PASS");
  });

  it("should return FAIL when Claude returns FAIL verdict", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: '{"verdict":"FAIL"}', durationMs: 100 });
    mockExtractJson.mockReturnValue({ verdict: "FAIL", findings: [{ severity: "error", message: "bug" }], summary: "Failed" });

    const result = await runReviewRound({
      roundName: "Test",
      promptTemplate: "test.md",
      promptsDir: "/prompts",
      claudeConfig,
      cwd: "/tmp",
      variables: {},
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.findings).toHaveLength(1);
  });

  it("should return FAIL when Claude invocation fails", async () => {
    mockRunClaude.mockResolvedValue({ success: false, output: "error", durationMs: 50 });

    const result = await runReviewRound({
      roundName: "Test",
      promptTemplate: "test.md",
      promptsDir: "/prompts",
      claudeConfig,
      cwd: "/tmp",
      variables: {},
    });
    expect(result.verdict).toBe("FAIL");
  });

  it("should handle non-JSON Claude output gracefully", async () => {
    mockRunClaude.mockResolvedValue({ success: true, output: "Looks good, verdict: PASS", durationMs: 100 });
    mockExtractJson.mockImplementation(() => { throw new Error("not JSON"); });

    const result = await runReviewRound({
      roundName: "Test",
      promptTemplate: "test.md",
      promptsDir: "/prompts",
      claudeConfig,
      cwd: "/tmp",
      variables: {},
    });
    expect(result.verdict).toBe("PASS"); // detected from text
  });
});
