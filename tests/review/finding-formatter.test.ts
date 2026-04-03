import { describe, it, expect } from "vitest";
import { formatAnalystFinding, formatReviewFinding, formatFindings } from "../../src/review/finding-formatter.js";
import type { AnalystFinding, ReviewFinding } from "../../src/types/review.js";

describe("finding-formatter", () => {
  describe("formatAnalystFinding", () => {
    it("should format basic AnalystFinding with all fields", () => {
      const finding: AnalystFinding = {
        type: "missing",
        requirement: "User authentication",
        implementation: "Login form component",
        severity: "error",
        message: "Authentication system not implemented",
        suggestion: "Implement OAuth 2.0 flow"
      };

      const result = formatAnalystFinding(finding);

      expect(result).toContain("🚨 ERROR");
      expect(result).toContain("Authentication system not implemented");
      expect(result).toContain("**Type**: missing");
      expect(result).toContain("**Requirement**: User authentication");
      expect(result).toContain("**Implementation**: Login form component");
      expect(result).toContain("**Suggestion**: Implement OAuth 2.0 flow");
    });

    it("should format AnalystFinding without optional fields", () => {
      const finding: AnalystFinding = {
        type: "excess",
        requirement: "Simple UI",
        severity: "warning",
        message: "Unnecessary complex component"
      };

      const result = formatAnalystFinding(finding);

      expect(result).toContain("⚠️ WARNING");
      expect(result).toContain("Unnecessary complex component");
      expect(result).toContain("**Type**: excess");
      expect(result).toContain("**Requirement**: Simple UI");
      expect(result).not.toContain("**Implementation**");
      expect(result).not.toContain("**Suggestion**");
    });

    it("should handle info severity", () => {
      const finding: AnalystFinding = {
        type: "mismatch",
        requirement: "Code style",
        severity: "info",
        message: "Minor style inconsistency"
      };

      const result = formatAnalystFinding(finding);
      expect(result).toContain("ℹ️ INFO");
    });
  });

  describe("formatReviewFinding", () => {
    it("should format basic ReviewFinding with all fields", () => {
      const finding: ReviewFinding = {
        severity: "error",
        file: "src/components/Button.tsx",
        line: 42,
        message: "Missing prop validation",
        suggestion: "Add PropTypes or TypeScript interface"
      };

      const result = formatReviewFinding(finding);

      expect(result).toContain("🚨 ERROR");
      expect(result).toContain("Missing prop validation");
      expect(result).toContain("**Location**: src/components/Button.tsx:42");
      expect(result).toContain("**Suggestion**: Add PropTypes or TypeScript interface");
    });

    it("should format ReviewFinding without optional fields", () => {
      const finding: ReviewFinding = {
        severity: "warning",
        message: "Consider refactoring this function"
      };

      const result = formatReviewFinding(finding);

      expect(result).toContain("⚠️ WARNING");
      expect(result).toContain("Consider refactoring this function");
      expect(result).not.toContain("**Location**");
      expect(result).not.toContain("**Suggestion**");
    });

    it("should format file without line number", () => {
      const finding: ReviewFinding = {
        severity: "info",
        file: "README.md",
        message: "Documentation could be improved"
      };

      const result = formatReviewFinding(finding);
      expect(result).toContain("**Location**: README.md");
      expect(result).not.toContain("README.md:");
    });
  });

  describe("formatFindings", () => {
    it("should format empty findings array", () => {
      const result = formatFindings([]);
      expect(result).toBe("No findings to report.");
    });

    it("should format mixed findings with numbering", () => {
      const analystFinding: AnalystFinding = {
        type: "missing",
        requirement: "Error handling",
        severity: "error",
        message: "No error boundaries"
      };

      const reviewFinding: ReviewFinding = {
        severity: "warning",
        file: "src/utils/helper.ts",
        line: 10,
        message: "Unused variable"
      };

      const result = formatFindings([analystFinding, reviewFinding]);

      expect(result).toContain("## Finding 1");
      expect(result).toContain("## Finding 2");
      expect(result).toContain("No error boundaries");
      expect(result).toContain("Unused variable");
      expect(result).toContain("**Type**: missing");
      expect(result).toContain("**Location**: src/utils/helper.ts:10");
    });

    it("should format single finding", () => {
      const finding: ReviewFinding = {
        severity: "info",
        message: "Consider adding tests"
      };

      const result = formatFindings([finding]);

      expect(result).toContain("## Finding 1");
      expect(result).toContain("ℹ️ INFO");
      expect(result).toContain("Consider adding tests");
    });
  });
});