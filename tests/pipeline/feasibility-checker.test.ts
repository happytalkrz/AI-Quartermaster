import { describe, it, expect } from "vitest";
import { checkFeasibility, generateSkipComment } from "../../src/pipeline/feasibility-checker.js";
import type { FeasibilityCheckConfig } from "../../src/types/config.js";
import type { GitHubIssue } from "../../src/github/issue-fetcher.js";

const mockConfig: FeasibilityCheckConfig = {
  enabled: true,
  maxRequirements: 5,
  maxFiles: 4,
  blockedKeywords: ["architecture", "refactor", "migration", "breaking change", "major rewrite"],
  skipReasons: [
    "Too many requirements (>5)",
    "Too many files affected (>4)",
    "Architecture change detected",
    "Blocked keyword found"
  ]
};

const createMockIssue = (body: string): GitHubIssue => ({
  number: 123,
  title: "Test Issue",
  body,
  labels: []
});

describe("checkFeasibility", () => {
  describe("when disabled", () => {
    it("should always return feasible", () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      const issue = createMockIssue("This is a complex refactor with many requirements");

      const result = checkFeasibility(issue, disabledConfig);

      expect(result.feasible).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("requirement count check", () => {
    it("should pass with few requirements", () => {
      const issue = createMockIssue(`
## Requirements
- [ ] Add new feature
- [ ] Update documentation
- [ ] Add tests
      `);

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(true);
      expect(result.metrics.requirementCount).toBe(3);
    });

    it("should fail with too many requirements", () => {
      const issue = createMockIssue(`
## Requirements
- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3
- [ ] Requirement 4
- [ ] Requirement 5
- [ ] Requirement 6
- [x] Completed requirement
      `);

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(false);
      expect(result.reason).toContain("Too many requirements");
      expect(result.metrics.requirementCount).toBe(7);
    });

    it("should count different checkbox formats", () => {
      const issue = createMockIssue(`
- [ ] Standard format
* [ ] Bullet format
  - [x] Indented completed
    * [ ] Nested format
      `);

      const result = checkFeasibility(issue, mockConfig);

      expect(result.metrics.requirementCount).toBe(4);
    });
  });

  describe("file count check", () => {
    it("should pass with few files", () => {
      const issue = createMockIssue(`
Need to update:
- \`src/utils/helper.ts\`
- \`tests/helper.test.ts\`
- docs/README.md
      `);

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(true);
      expect(result.metrics.fileCount).toBe(3);
    });

    it("should fail with too many files", () => {
      const issue = createMockIssue(`
Files to change:
- \`src/components/Button.tsx\`
- \`src/components/Input.tsx\`
- \`src/utils/validation.ts\`
- \`src/types/forms.ts\`
- \`tests/components/Button.test.tsx\`
- tests/utils/validation.test.ts
- docs/components.md
      `);

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(false);
      expect(result.reason).toContain("Too many files affected");
      expect(result.metrics.fileCount).toBeGreaterThan(4);
    });

    it("should extract various file path formats", () => {
      const issue = createMockIssue(`
Files mentioned:
- \`src/pipeline/core.ts\` (backticks)
- src/utils/helper.js (no backticks)
- tests/ directory
- config/settings.json
      `);

      const result = checkFeasibility(issue, mockConfig);

      expect(result.metrics.fileCount).toBeGreaterThan(0);
    });
  });

  describe("blocked keywords check", () => {
    it("should pass without blocked keywords", () => {
      const issue = createMockIssue("Simple bug fix for the button component");

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(true);
      expect(result.metrics.blockedKeywords).toHaveLength(0);
    });

    it("should fail with architecture keyword", () => {
      const issue = createMockIssue("Need to redesign the architecture for better performance");

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(false);
      expect(result.reason).toContain("Blocked keywords found");
      expect(result.metrics.blockedKeywords).toContain("architecture");
    });

    it("should fail with refactor keyword", () => {
      const issue = createMockIssue("Major refactor of the authentication system");

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(false);
      expect(result.metrics.blockedKeywords).toContain("refactor");
    });

    it("should detect multiple blocked keywords", () => {
      const issue = createMockIssue("This migration requires a major refactor of our architecture");

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(false);
      expect(result.metrics.blockedKeywords).toEqual(
        expect.arrayContaining(["migration", "refactor", "architecture"])
      );
    });

    it("should be case insensitive", () => {
      const issue = createMockIssue("MAJOR REFACTOR needed for ARCHITECTURE changes");

      const result = checkFeasibility(issue, mockConfig);

      expect(result.feasible).toBe(false);
      expect(result.metrics.blockedKeywords).toEqual(
        expect.arrayContaining(["refactor", "architecture"])
      );
    });
  });
});

describe("generateSkipComment", () => {
  it("should generate proper comment for too many requirements", () => {
    const issue = createMockIssue("Test issue");
    const result = {
      feasible: false,
      reason: "Too many requirements (7 > 5)",
      metrics: {
        requirementCount: 7,
        fileCount: 2,
        blockedKeywords: []
      }
    };

    const comment = generateSkipComment(issue, result, mockConfig.skipReasons);

    expect(comment).toContain("AI Quartermaster - Issue Skipped");
    expect(comment).toContain("Too many requirements (7 > 5)");
    expect(comment).toContain("체크리스트 항목: 7개");
    expect(comment).toContain("영향받는 파일: 2개");
    expect(comment).toContain("더 작은 단위로 분할");
  });

  it("should include blocked keywords in comment", () => {
    const issue = createMockIssue("Test issue");
    const result = {
      feasible: false,
      reason: "Blocked keywords found: architecture, refactor",
      metrics: {
        requirementCount: 3,
        fileCount: 2,
        blockedKeywords: ["architecture", "refactor"]
      }
    };

    const comment = generateSkipComment(issue, result, mockConfig.skipReasons);

    expect(comment).toContain("감지된 복잡도 키워드: architecture, refactor");
  });
});