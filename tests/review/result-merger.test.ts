import { describe, it, expect } from "vitest";
import { mergeReviewResults, deduplicateFindings, mergeSplitReviewResults } from "../../src/review/result-merger.js";
import type { ReviewResult, ReviewFinding, SplitReviewResult } from "../../src/types/review.js";

describe("result-merger", () => {
  describe("mergeReviewResults", () => {
    it("should return default result for empty array", () => {
      const result = mergeReviewResults([]);

      expect(result).toEqual({
        roundName: "Split Review",
        verdict: "PASS",
        findings: [],
        summary: "No review results to merge.",
        durationMs: 0,
      });
    });

    it("should return single result with updated roundName", () => {
      const singleResult: ReviewResult = {
        roundName: "Original Round",
        verdict: "PASS",
        findings: [{ severity: "info", message: "All good" }],
        summary: "Everything looks fine",
        durationMs: 100,
      };

      const result = mergeReviewResults([singleResult], "Custom Round");

      expect(result).toEqual({
        roundName: "Custom Round",
        verdict: "PASS",
        findings: [{ severity: "info", message: "All good" }],
        summary: "Everything looks fine",
        durationMs: 100,
      });
    });

    it("should merge multiple PASS results", () => {
      const results: ReviewResult[] = [
        {
          roundName: "Split 1",
          verdict: "PASS",
          findings: [{ severity: "info", message: "File 1 looks good" }],
          summary: "First split is clean",
          durationMs: 50,
        },
        {
          roundName: "Split 2",
          verdict: "PASS",
          findings: [{ severity: "warning", message: "Minor issue in file 2" }],
          summary: "Second split has minor warnings",
          durationMs: 75,
        },
      ];

      const result = mergeReviewResults(results);

      expect(result.verdict).toBe("PASS");
      expect(result.findings).toHaveLength(2);
      expect(result.durationMs).toBe(125);
      expect(result.summary).toContain("Merged review from 2 splits");
      expect(result.summary).toContain("First split is clean");
      expect(result.summary).toContain("Second split has minor warnings");
    });

    it("should return FAIL when any result is FAIL", () => {
      const results: ReviewResult[] = [
        {
          roundName: "Split 1",
          verdict: "PASS",
          findings: [],
          summary: "Clean",
          durationMs: 50,
        },
        {
          roundName: "Split 2",
          verdict: "FAIL",
          findings: [{ severity: "error", message: "Critical bug" }],
          summary: "Has errors",
          durationMs: 75,
        },
      ];

      const result = mergeReviewResults(results);

      expect(result.verdict).toBe("FAIL");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe("error");
    });

    it("should deduplicate findings", () => {
      const results: ReviewResult[] = [
        {
          roundName: "Split 1",
          verdict: "PASS",
          findings: [
            { severity: "warning", file: "test.ts", line: 10, message: "Duplicate warning" },
            { severity: "info", message: "General info" },
          ],
          summary: "First",
          durationMs: 50,
        },
        {
          roundName: "Split 2",
          verdict: "PASS",
          findings: [
            { severity: "warning", file: "test.ts", line: 10, message: "Duplicate warning" }, // 중복
            { severity: "error", file: "other.ts", line: 5, message: "Unique error" },
          ],
          summary: "Second",
          durationMs: 75,
        },
      ];

      const result = mergeReviewResults(results);

      expect(result.findings).toHaveLength(3); // 중복 제거되어 3개
      expect(result.findings.filter(f => f.message === "Duplicate warning")).toHaveLength(1);
    });

    it("should handle empty summaries", () => {
      const results: ReviewResult[] = [
        {
          roundName: "Split 1",
          verdict: "PASS",
          findings: [],
          summary: "",
          durationMs: 50,
        },
        {
          roundName: "Split 2",
          verdict: "PASS",
          findings: [],
          summary: "   ", // 공백만
          durationMs: 75,
        },
      ];

      const result = mergeReviewResults(results);

      expect(result.summary).toBe("Merged review from 2 splits with no detailed summaries.");
    });

    it("should use custom roundName", () => {
      const results: ReviewResult[] = [
        {
          roundName: "Split 1",
          verdict: "PASS",
          findings: [],
          summary: "Clean",
          durationMs: 50,
        },
      ];

      const result = mergeReviewResults(results, "Custom Merge");

      expect(result.roundName).toBe("Custom Merge");
    });
  });

  describe("deduplicateFindings", () => {
    it("should remove exact duplicates", () => {
      const findings: ReviewFinding[] = [
        { severity: "error", file: "test.ts", line: 10, message: "Same error" },
        { severity: "warning", file: "other.ts", message: "Different message" },
        { severity: "error", file: "test.ts", line: 10, message: "Same error" }, // 중복
        { severity: "info", message: "Global info" },
      ];

      const result = deduplicateFindings(findings);

      expect(result).toHaveLength(3);
      expect(result.filter(f => f.message === "Same error")).toHaveLength(1);
    });

    it("should handle findings without file/line", () => {
      const findings: ReviewFinding[] = [
        { severity: "info", message: "Global message" },
        { severity: "warning", file: "test.ts", message: "File-specific message" },
        { severity: "info", message: "Global message" }, // 중복
        { severity: "error", file: "test.ts", line: 5, message: "Line-specific message" },
      ];

      const result = deduplicateFindings(findings);

      expect(result).toHaveLength(3);
      expect(result.filter(f => f.message === "Global message")).toHaveLength(1);
    });

    it("should differentiate by file path", () => {
      const findings: ReviewFinding[] = [
        { severity: "error", file: "src/test.ts", line: 10, message: "Same message" },
        { severity: "error", file: "tests/test.ts", line: 10, message: "Same message" },
      ];

      const result = deduplicateFindings(findings);

      expect(result).toHaveLength(2); // 다른 파일이므로 중복 아님
    });

    it("should differentiate by line number", () => {
      const findings: ReviewFinding[] = [
        { severity: "error", file: "test.ts", line: 10, message: "Same message" },
        { severity: "error", file: "test.ts", line: 20, message: "Same message" },
      ];

      const result = deduplicateFindings(findings);

      expect(result).toHaveLength(2); // 다른 라인이므로 중복 아님
    });

    it("should handle file without line number", () => {
      const findings: ReviewFinding[] = [
        { severity: "warning", file: "README.md", message: "Doc issue" },
        { severity: "warning", file: "README.md", message: "Doc issue" }, // 중복
        { severity: "info", file: "README.md", message: "Different message" },
      ];

      const result = deduplicateFindings(findings);

      expect(result).toHaveLength(2);
    });
  });

  describe("mergeSplitReviewResults", () => {
    it("should merge SplitReviewResult with split info", () => {
      const splitResults: SplitReviewResult[] = [
        {
          roundName: "Split 1",
          verdict: "PASS",
          findings: [{ severity: "info", message: "Clean code" }],
          summary: "First part looks good",
          durationMs: 100,
          splitInfo: {
            totalSplits: 3,
            currentSplit: 0,
            splitBy: "file",
          },
        },
        {
          roundName: "Split 2",
          verdict: "FAIL",
          findings: [{ severity: "error", message: "Bug found" }],
          summary: "Second part has issues",
          durationMs: 150,
          splitInfo: {
            totalSplits: 3,
            currentSplit: 1,
            splitBy: "file",
          },
        },
      ];

      const result = mergeSplitReviewResults(splitResults, "File-based Review");

      expect(result.roundName).toBe("File-based Review");
      expect(result.verdict).toBe("FAIL");
      expect(result.findings).toHaveLength(2);
      expect(result.durationMs).toBe(250);
      expect(result.summary).toContain("Split review (3 splits by file)");
      expect(result.summary).toContain("Merged review from 2 splits");
    });

    it("should work without split info", () => {
      const splitResults: SplitReviewResult[] = [
        {
          roundName: "Split 1",
          verdict: "PASS",
          findings: [],
          summary: "Clean",
          durationMs: 50,
        },
      ];

      const result = mergeSplitReviewResults(splitResults);

      expect(result.roundName).toBe("Split Review");
      expect(result.verdict).toBe("PASS");
      expect(result.summary).not.toContain("Split review (");
    });

    it("should handle empty split results", () => {
      const result = mergeSplitReviewResults([]);

      expect(result.roundName).toBe("Split Review");
      expect(result.verdict).toBe("PASS");
      expect(result.findings).toHaveLength(0);
      expect(result.summary).toBe("No review results to merge.");
    });
  });
});