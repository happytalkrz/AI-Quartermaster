import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/review/review-runner.js", () => ({
  runReviewRound: vi.fn(),
}));

vi.mock("../../src/review/token-estimator.js", () => ({
  exceedsTokenLimit: vi.fn(),
  getEffectiveTokenLimit: vi.fn(),
}));

vi.mock("../../src/review/diff-splitter.js", () => ({
  splitDiffByFiles: vi.fn(),
  groupFilesByTokenBudget: vi.fn(),
  combineBatchDiffs: vi.fn(),
}));

vi.mock("../../src/review/result-merger.js", () => ({
  mergeReviewResults: vi.fn(),
}));

vi.mock("../../src/prompt/template-renderer.js", () => ({
  loadTemplate: vi.fn(),
  renderTemplate: vi.fn(),
}));

import { runReviews } from "../../src/review/review-orchestrator.js";
import { runReviewRound } from "../../src/review/review-runner.js";
import { exceedsTokenLimit, getEffectiveTokenLimit } from "../../src/review/token-estimator.js";
import { splitDiffByFiles, groupFilesByTokenBudget, combineBatchDiffs } from "../../src/review/diff-splitter.js";
import { mergeReviewResults } from "../../src/review/result-merger.js";
import { loadTemplate, renderTemplate } from "../../src/prompt/template-renderer.js";
import type { ReviewResult } from "../../src/types/review.js";

const mockRunReview = vi.mocked(runReviewRound);
const mockExceedsTokenLimit = vi.mocked(exceedsTokenLimit);
const mockGetEffectiveTokenLimit = vi.mocked(getEffectiveTokenLimit);
const mockSplitDiffByFiles = vi.mocked(splitDiffByFiles);
const mockGroupFilesByTokenBudget = vi.mocked(groupFilesByTokenBudget);
const mockCombineBatchDiffs = vi.mocked(combineBatchDiffs);
const mockMergeReviewResults = vi.mocked(mergeReviewResults);
const mockLoadTemplate = vi.mocked(loadTemplate);
const mockRenderTemplate = vi.mocked(renderTemplate);

const claudeConfig = { path: "claude", model: "test", maxTurns: 1, timeout: 1000, additionalArgs: [] };

function passResult(name: string): ReviewResult {
  return { roundName: name, verdict: "PASS", findings: [], summary: "OK", durationMs: 100 };
}
function failResult(name: string): ReviewResult {
  return { roundName: name, verdict: "FAIL", findings: [{ severity: "error", message: "fail" }], summary: "Bad", durationMs: 100 };
}

describe("runReviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup for split review functionality
    mockExceedsTokenLimit.mockReturnValue(false);
    mockGetEffectiveTokenLimit.mockReturnValue(160000);
    mockLoadTemplate.mockReturnValue("template content");
    mockRenderTemplate.mockReturnValue("rendered template");
    mockSplitDiffByFiles.mockReturnValue([]);
    mockGroupFilesByTokenBudget.mockReturnValue([]);
    mockCombineBatchDiffs.mockReturnValue("");
    mockMergeReviewResults.mockReturnValue(passResult("Merged"));
  });

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

  it("should use standard review when token limit is not exceeded", async () => {
    mockExceedsTokenLimit.mockReturnValue(false);
    mockRunReview.mockResolvedValue(passResult("StandardReview"));

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "StandardReview", promptTemplate: "review.md", failAction: "block", maxRetries: 0, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: { diff: "small diff content" },
    });

    expect(result.allPassed).toBe(true);
    expect(mockExceedsTokenLimit).toHaveBeenCalledWith("rendered template", "test");
    expect(mockRunReview).toHaveBeenCalledTimes(1);
    expect(mockSplitDiffByFiles).not.toHaveBeenCalled();
  });

  it("should use split review when token limit is exceeded", async () => {
    mockExceedsTokenLimit.mockReturnValue(true);

    // Mock split review components
    const fileDiffs = [
      { filePath: "file1.ts", diffContent: "diff1", estimatedTokens: 1000 },
      { filePath: "file2.ts", diffContent: "diff2", estimatedTokens: 2000 },
    ];
    const batches = [
      { files: [fileDiffs[0]], totalEstimatedTokens: 1500, batchIndex: 0 },
      { files: [fileDiffs[1]], totalEstimatedTokens: 2500, batchIndex: 1 },
    ];

    mockSplitDiffByFiles.mockReturnValue(fileDiffs);
    mockGroupFilesByTokenBudget.mockReturnValue(batches);
    mockCombineBatchDiffs.mockReturnValueOnce("diff1").mockReturnValueOnce("diff2");

    // Each split review returns a result
    mockRunReview
      .mockResolvedValueOnce(passResult("SplitReview (Split 1/2)"))
      .mockResolvedValueOnce(passResult("SplitReview (Split 2/2)"));

    const mergedResult = passResult("SplitReview");
    mockMergeReviewResults.mockReturnValue(mergedResult);

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "SplitReview", promptTemplate: "review.md", failAction: "block", maxRetries: 0, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: { diff: "very large diff content" },
    });

    expect(result.allPassed).toBe(true);
    expect(mockExceedsTokenLimit).toHaveBeenCalledWith("rendered template", "test");
    expect(mockSplitDiffByFiles).toHaveBeenCalledWith("very large diff content");
    expect(mockGroupFilesByTokenBudget).toHaveBeenCalledWith(fileDiffs, 160000, "rendered template");
    expect(mockRunReview).toHaveBeenCalledTimes(2);
    expect(mockMergeReviewResults).toHaveBeenCalledWith(
      [
        expect.objectContaining({ roundName: "SplitReview (Split 1/2)" }),
        expect.objectContaining({ roundName: "SplitReview (Split 2/2)" }),
      ],
      "SplitReview"
    );
  });

  it("should handle split review with no diff files", async () => {
    mockExceedsTokenLimit.mockReturnValue(true);
    mockSplitDiffByFiles.mockReturnValue([]);

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "EmptyDiff", promptTemplate: "review.md", failAction: "block", maxRetries: 0, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: { diff: "" },
    });

    expect(result.allPassed).toBe(true);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].verdict).toBe("PASS");
    expect(result.rounds[0].summary).toBe("No changes to review");
    expect(mockRunReview).not.toHaveBeenCalled();
  });

  it("should handle split review failure correctly", async () => {
    mockExceedsTokenLimit.mockReturnValue(true);

    const fileDiffs = [
      { filePath: "file1.ts", diffContent: "diff1", estimatedTokens: 1000 },
    ];
    const batches = [
      { files: [fileDiffs[0]], totalEstimatedTokens: 1500, batchIndex: 0 },
    ];

    mockSplitDiffByFiles.mockReturnValue(fileDiffs);
    mockGroupFilesByTokenBudget.mockReturnValue(batches);
    mockCombineBatchDiffs.mockReturnValue("diff1");
    mockRunReview.mockResolvedValue(failResult("SplitReview (Split 1/1)"));

    const mergedResult = failResult("SplitReview");
    mockMergeReviewResults.mockReturnValue(mergedResult);

    const result = await runReviews({
      reviewConfig: {
        enabled: true,
        rounds: [
          { name: "SplitReview", promptTemplate: "review.md", failAction: "block", maxRetries: 0, model: null },
        ],
        simplify: { enabled: false, promptTemplate: "" },
      },
      claudeConfig,
      promptsDir: "/prompts",
      cwd: "/tmp",
      variables: { diff: "large diff content" },
    });

    expect(result.allPassed).toBe(false);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].verdict).toBe("FAIL");
  });
});
