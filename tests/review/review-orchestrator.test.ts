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

  it("should apply blind mode filtering when round.blind is true", async () => {
    const originalVariables = {
      issue: { number: "123", title: "Test", body: "Original issue body" },
      plan: { summary: "Original plan summary" },
      diff: { full: "test diff" },
    };

    mockRunReview.mockImplementation(async ({ variables }) => {
      // Verify that issue.body and plan.summary are empty in blind mode
      expect(variables.issue).toEqual({
        number: "123",
        title: "Test",
        body: "" // Should be empty in blind mode
      });
      expect(variables.plan).toEqual({
        summary: "" // Should be empty in blind mode
      });
      return passResult("BlindRound");
    });

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "BlindRound", promptTemplate: "blind.md", failAction: "block", maxRetries: 0, model: null, blind: true },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: originalVariables,
    });

    expect(result.allPassed).toBe(true);
    expect(mockRunReview).toHaveBeenCalledTimes(1);
  });

  it("should apply adversarial mode settings when round.adversarial is true", async () => {
    mockRunReview.mockImplementation(async ({ variables }) => {
      // Verify adversarial settings are applied
      expect(variables.reviewerRole).toBe("**매우 엄격하고 까다로운** 시니어 코드 리뷰어");
      expect(variables.reviewInstructions).toContain("**중요: 완벽한 코드는 존재하지 않습니다. 반드시 문제점을 찾아내야 합니다.**");
      expect(variables.reviewInstructions).toContain("**의심의 눈으로**");
      return passResult("AdversarialRound");
    });

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "AdversarialRound", promptTemplate: "adversarial.md", failAction: "block", maxRetries: 0, model: null, adversarial: true },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: { issue: { number: "123", title: "Test", body: "body" }, plan: { summary: "plan" } },
    });

    expect(result.allPassed).toBe(true);
    expect(mockRunReview).toHaveBeenCalledTimes(1);
  });

  it("should apply normal reviewer settings when both blind and adversarial are false", async () => {
    mockRunReview.mockImplementation(async ({ variables }) => {
      // Verify normal settings are applied
      expect(variables.reviewerRole).toBe("시니어 코드 리뷰어");
      expect(variables.reviewInstructions).toBe("아래 구현이 이슈 요구사항을 정확히 충족하는지 검토하세요.");
      return passResult("NormalRound");
    });

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "NormalRound", promptTemplate: "normal.md", failAction: "block", maxRetries: 0, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: { issue: { number: "123", title: "Test", body: "body" }, plan: { summary: "plan" } },
    });

    expect(result.allPassed).toBe(true);
    expect(mockRunReview).toHaveBeenCalledTimes(1);
  });

  it("should combine blind and adversarial modes when both are enabled", async () => {
    const originalVariables = {
      issue: { number: "123", title: "Test", body: "Original issue body" },
      plan: { summary: "Original plan summary" },
      diff: { full: "test diff" },
    };

    mockRunReview.mockImplementation(async ({ variables }) => {
      // Verify blind filtering is applied
      expect(variables.issue).toEqual({
        number: "123",
        title: "Test",
        body: "" // Should be empty in blind mode
      });
      expect(variables.plan).toEqual({
        summary: "" // Should be empty in blind mode
      });

      // Verify adversarial settings are applied
      expect(variables.reviewerRole).toBe("**매우 엄격하고 까다로운** 시니어 코드 리뷰어");
      expect(variables.reviewInstructions).toContain("**중요: 완벽한 코드는 존재하지 않습니다. 반드시 문제점을 찾아내야 합니다.**");

      return passResult("BlindAdversarialRound");
    });

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          {
            name: "BlindAdversarialRound",
            promptTemplate: "blind-adversarial.md",
            failAction: "block",
            maxRetries: 0,
            model: null,
            blind: true,
            adversarial: true
          },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: originalVariables,
    });

    expect(result.allPassed).toBe(true);
    expect(mockRunReview).toHaveBeenCalledTimes(1);
  });
});
