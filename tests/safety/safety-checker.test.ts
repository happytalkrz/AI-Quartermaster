import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateIssue,
  validatePlan,
  validateBeforePush,
  type SafetyContext,
} from "../../src/safety/safety-checker.js";
import { SafetyViolationError } from "../../src/types/errors.js";
import type { GitHubIssue } from "../../src/github/issue-fetcher.js";
import type { Plan } from "../../src/types/pipeline.js";

vi.mock("../../src/safety/label-filter.js", () => ({
  isAllowedLabel: vi.fn(),
}));

vi.mock("../../src/safety/phase-limit-guard.js", () => ({
  checkPhaseLimit: vi.fn(),
}));

vi.mock("../../src/safety/base-branch-guard.js", () => ({
  assertNotOnBaseBranch: vi.fn(),
}));

vi.mock("../../src/git/diff-collector.js", () => ({
  collectDiff: vi.fn(),
}));

vi.mock("../../src/safety/sensitive-path-guard.js", () => ({
  checkSensitivePaths: vi.fn(),
}));

vi.mock("../../src/safety/change-limit-guard.js", () => ({
  checkChangeLimits: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { isAllowedLabel } from "../../src/safety/label-filter.js";
import { checkPhaseLimit } from "../../src/safety/phase-limit-guard.js";
import { assertNotOnBaseBranch } from "../../src/safety/base-branch-guard.js";
import { collectDiff } from "../../src/git/diff-collector.js";
import { checkSensitivePaths } from "../../src/safety/sensitive-path-guard.js";
import { checkChangeLimits } from "../../src/safety/change-limit-guard.js";

const mockIsAllowedLabel = vi.mocked(isAllowedLabel);
const mockCheckPhaseLimit = vi.mocked(checkPhaseLimit);
const mockAssertNotOnBaseBranch = vi.mocked(assertNotOnBaseBranch);
const mockCollectDiff = vi.mocked(collectDiff);
const mockCheckSensitivePaths = vi.mocked(checkSensitivePaths);
const mockCheckChangeLimits = vi.mocked(checkChangeLimits);

describe("safety-checker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateIssue", () => {
    it("should pass when issue has allowed labels", () => {
      const issue: GitHubIssue = {
        number: 123,
        title: "Test issue",
        body: "Test body",
        labels: ["enhancement", "bug"],
        assignee: null,
        state: "open",
        createdAt: "2026-04-04T00:00:00Z",
        updatedAt: "2026-04-04T00:00:00Z",
      };

      const safetyConfig = {
        allowedLabels: ["enhancement", "bug", "feature"],
        sensitivePaths: [],
        maxPhases: 5,
        maxFileChanges: 100,
        maxInsertions: 1000,
        maxDeletions: 500,
        stopConditions: [],
        timeoutMs: 300000,
      };

      mockIsAllowedLabel.mockReturnValue(true);

      expect(() => validateIssue(issue, safetyConfig)).not.toThrow();

      expect(mockIsAllowedLabel).toHaveBeenCalledWith(
        ["enhancement", "bug"],
        ["enhancement", "bug", "feature"],
        undefined
      );
    });

    it("should throw SafetyViolationError when issue has disallowed labels", () => {
      const issue: GitHubIssue = {
        number: 123,
        title: "Test issue",
        body: "Test body",
        labels: ["invalid-label"],
        assignee: null,
        state: "open",
        createdAt: "2026-04-04T00:00:00Z",
        updatedAt: "2026-04-04T00:00:00Z",
      };

      const safetyConfig = {
        allowedLabels: ["enhancement", "bug"],
        sensitivePaths: [],
        maxPhases: 5,
        maxFileChanges: 100,
        maxInsertions: 1000,
        maxDeletions: 500,
        stopConditions: [],
        timeoutMs: 300000,
      };

      mockIsAllowedLabel.mockReturnValue(false);

      expect(() => validateIssue(issue, safetyConfig)).toThrow(SafetyViolationError);

      try {
        validateIssue(issue, safetyConfig);
      } catch (error: any) {
        expect(error.guard).toBe("LabelFilter");
        expect(error.message).toContain("Issue labels [invalid-label]");
        expect(error.message).toContain("do not match allowed labels");
      }
    });
  });

  describe("validatePlan", () => {
    it("should pass when plan has allowed number of phases", () => {
      const plan: Plan = {
        title: "Test plan",
        description: "Test description",
        phases: [
          { description: "Phase 1", commands: [] },
          { description: "Phase 2", commands: [] },
        ],
      };

      const safetyConfig = {
        allowedLabels: [],
        sensitivePaths: [],
        maxPhases: 5,
        maxFileChanges: 100,
        maxInsertions: 1000,
        maxDeletions: 500,
        stopConditions: [],
        timeoutMs: 300000,
      };

      mockCheckPhaseLimit.mockImplementation(() => {}); // No throw

      expect(() => validatePlan(plan, safetyConfig)).not.toThrow();

      expect(mockCheckPhaseLimit).toHaveBeenCalledWith(2, 5);
    });

    it("should throw error when plan exceeds phase limit", () => {
      const plan: Plan = {
        title: "Test plan",
        description: "Test description",
        phases: Array(6).fill({ description: "Phase", commands: [] }),
      };

      const safetyConfig = {
        allowedLabels: [],
        sensitivePaths: [],
        maxPhases: 5,
        maxFileChanges: 100,
        maxInsertions: 1000,
        maxDeletions: 500,
        stopConditions: [],
        timeoutMs: 300000,
      };

      mockCheckPhaseLimit.mockImplementation(() => {
        throw new SafetyViolationError("PhaseLimitGuard", "Too many phases");
      });

      expect(() => validatePlan(plan, safetyConfig)).toThrow(SafetyViolationError);
    });
  });

  describe("validateBeforePush", () => {
    const mockSafetyContext: SafetyContext = {
      safetyConfig: {
        allowedLabels: [],
        sensitivePaths: ["**/*.env", "**/*.pem"],
        maxPhases: 5,
        maxFileChanges: 10,
        maxInsertions: 100,
        maxDeletions: 50,
        stopConditions: [],
        timeoutMs: 300000,
      },
      gitConfig: {
        gitPath: "git",
        defaultBranch: "main",
      },
      cwd: "/test/repo",
      baseBranch: "main",
    };

    it("should pass all safety checks", async () => {
      mockAssertNotOnBaseBranch.mockResolvedValue(undefined);
      mockCollectDiff.mockResolvedValue({
        filesChanged: 5,
        insertions: 50,
        deletions: 20,
        changedFiles: ["src/app.ts", "tests/app.test.ts"],
      });
      mockCheckSensitivePaths.mockImplementation(() => {}); // No throw
      mockCheckChangeLimits.mockImplementation(() => {}); // No throw

      await expect(validateBeforePush(mockSafetyContext)).resolves.not.toThrow();

      expect(mockAssertNotOnBaseBranch).toHaveBeenCalledWith("main", {
        cwd: "/test/repo",
        gitPath: "git",
      });
      expect(mockCollectDiff).toHaveBeenCalledWith(
        mockSafetyContext.gitConfig,
        "main",
        { cwd: "/test/repo" }
      );
      expect(mockCheckSensitivePaths).toHaveBeenCalledWith(
        ["src/app.ts", "tests/app.test.ts"],
        ["**/*.env", "**/*.pem"],
        { issueBody: undefined, labels: undefined }
      );
      expect(mockCheckChangeLimits).toHaveBeenCalledWith(
        { filesChanged: 5, insertions: 50, deletions: 20 },
        { maxFileChanges: 10, maxInsertions: 100, maxDeletions: 50 }
      );
    });

    it("should fail when on base branch", async () => {
      mockAssertNotOnBaseBranch.mockRejectedValue(
        new SafetyViolationError("BaseBranchGuard", "On base branch")
      );

      await expect(validateBeforePush(mockSafetyContext)).rejects.toThrow(
        SafetyViolationError
      );
    });

    it("should fail when sensitive paths are modified", async () => {
      mockAssertNotOnBaseBranch.mockResolvedValue(undefined);
      mockCollectDiff.mockResolvedValue({
        filesChanged: 2,
        insertions: 10,
        deletions: 5,
        changedFiles: [".env", "src/app.ts"],
      });
      mockCheckSensitivePaths.mockImplementation(() => {
        throw new SafetyViolationError("SensitivePathGuard", "Sensitive file modified");
      });

      await expect(validateBeforePush(mockSafetyContext)).rejects.toThrow(
        SafetyViolationError
      );
    });

    it("should warn but not fail when change limits are exceeded", async () => {
      mockAssertNotOnBaseBranch.mockResolvedValue(undefined);
      mockCollectDiff.mockResolvedValue({
        filesChanged: 15, // Exceeds limit
        insertions: 200, // Exceeds limit
        deletions: 100, // Exceeds limit
        changedFiles: ["src/app.ts"],
      });
      mockCheckSensitivePaths.mockImplementation(() => {}); // No throw
      mockCheckChangeLimits.mockImplementation(() => {
        throw new SafetyViolationError("ChangeLimitGuard", "Too many changes");
      });

      // Should not throw, only warn
      await expect(validateBeforePush(mockSafetyContext)).resolves.not.toThrow();

      expect(mockCheckChangeLimits).toHaveBeenCalled();
    });

    it("should re-throw non-SafetyViolationError from change limits", async () => {
      mockAssertNotOnBaseBranch.mockResolvedValue(undefined);
      mockCollectDiff.mockResolvedValue({
        filesChanged: 5,
        insertions: 50,
        deletions: 20,
        changedFiles: ["src/app.ts"],
      });
      mockCheckSensitivePaths.mockImplementation(() => {}); // No throw
      mockCheckChangeLimits.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      await expect(validateBeforePush(mockSafetyContext)).rejects.toThrow(
        "Unexpected error"
      );
    });

    it("should handle git diff collection failure", async () => {
      mockAssertNotOnBaseBranch.mockResolvedValue(undefined);
      mockCollectDiff.mockRejectedValue(new Error("Git diff failed"));

      await expect(validateBeforePush(mockSafetyContext)).rejects.toThrow(
        "Git diff failed"
      );
    });
  });
});