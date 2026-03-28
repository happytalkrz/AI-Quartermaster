import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/review/review-runner.js", () => ({
  runReviewRound: vi.fn(),
}));

import { runReviews } from "../../src/review/review-orchestrator.js";
import { runReviewRound } from "../../src/review/review-runner.js";
import type { ReviewResult } from "../../src/types/review.js";

const mockRunReview = vi.mocked(runReviewRound);

const claudeConfig = { path: "claude", model: "test", maxTurns: 1, timeout: 1000, additionalArgs: [] };

function passResult(name: string): ReviewResult {
  return { roundName: name, verdict: "PASS", findings: [], summary: "OK", durationMs: 100 };
}
function failResult(name: string): ReviewResult {
  return { roundName: name, verdict: "FAIL", findings: [{ severity: "error", message: "fail" }], summary: "Bad", durationMs: 100 };
}

describe("runReviews", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should pass when all rounds pass", async () => {
    mockRunReview.mockResolvedValue(passResult("round"));

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "R1", promptTemplate: "r1.md", failAction: "block", maxRetries: 0, model: null },
          { name: "R2", promptTemplate: "r2.md", failAction: "warn", maxRetries: 0, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: {},
    });
    expect(result.allPassed).toBe(true);
    expect(result.rounds).toHaveLength(2);
  });

  it("should halt on block failure", async () => {
    mockRunReview.mockResolvedValue(failResult("R1"));

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "R1", promptTemplate: "r1.md", failAction: "block", maxRetries: 0, model: null },
          { name: "R2", promptTemplate: "r2.md", failAction: "warn", maxRetries: 0, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: {},
    });
    expect(result.allPassed).toBe(false);
    expect(result.rounds).toHaveLength(1); // R2 never ran
  });

  it("should retry on retry failure action", async () => {
    mockRunReview
      .mockResolvedValueOnce(failResult("R1"))
      .mockResolvedValueOnce(failResult("R1"))
      .mockResolvedValueOnce(passResult("R1"));

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "R1", promptTemplate: "r1.md", failAction: "retry", maxRetries: 2, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: {},
    });
    expect(result.allPassed).toBe(true);
    expect(mockRunReview).toHaveBeenCalledTimes(3);
  });

  it("should skip reviews when disabled", async () => {
    const result = await runReviews({
      reviewConfig: { enabled: false, rounds: [], simplify: { enabled: false, promptTemplate: "" } },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: {},
    });
    expect(result.allPassed).toBe(true);
    expect(result.rounds).toHaveLength(0);
  });
});
