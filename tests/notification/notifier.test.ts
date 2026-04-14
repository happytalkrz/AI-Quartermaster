import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  notifyIssue,
  notifySuccess,
  notifyFailure,
  notifyPlanRetryContext
} from "../../src/notification/notifier.js";
import { runCli } from "../../src/utils/cli-runner.js";
import type { PlanRetryContext, ContextualizationInfo } from "../../src/types/pipeline.js";

const mockRunCli = vi.mocked(runCli);

describe("notifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("notifyIssue", () => {
    it("should post comment successfully", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Comment created successfully",
        stderr: "",
        exitCode: 0,
      });

      await notifyIssue("owner/repo", 123, "Test comment");

      expect(mockRunCli).toHaveBeenCalledWith(
        "gh",
        ["issue", "comment", "123", "--repo", "owner/repo", "--body", "Test comment"],
        { timeout: 30000 }
      );
    });

    it("should handle comment failure gracefully", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "",
        stderr: "GitHub API error",
        exitCode: 1,
      });

      // Should not throw error, only log warning
      await notifyIssue("owner/repo", 456, "Test comment");

      expect(mockRunCli).toHaveBeenCalledWith(
        "gh",
        ["issue", "comment", "456", "--repo", "owner/repo", "--body", "Test comment"],
        { timeout: 30000 }
      );
    });

    it("should use custom gh path when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyIssue("owner/repo", 789, "Test comment", { ghPath: "/custom/gh" });

      expect(mockRunCli).toHaveBeenCalledWith(
        "/custom/gh",
        ["issue", "comment", "789", "--repo", "owner/repo", "--body", "Test comment"],
        { timeout: 30000 }
      );
    });

    it("should handle dry run mode", async () => {
      await notifyIssue("owner/repo", 999, "Test comment", { dryRun: true });

      // Should not call runCli in dry run mode
      expect(mockRunCli).not.toHaveBeenCalled();
    });

    it("should truncate long messages in dry run log", async () => {
      const longMessage = "a".repeat(200);

      await notifyIssue("owner/repo", 111, longMessage, { dryRun: true });

      expect(mockRunCli).not.toHaveBeenCalled();
    });
  });

  describe("notifySuccess", () => {
    it("should create success notification with PR URL", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifySuccess("owner/repo", 123, "https://github.com/owner/repo/pull/456");

      expect(mockRunCli).toHaveBeenCalledWith(
        "gh",
        ["issue", "comment", "123", "--repo", "owner/repo", "--body",
         "## AI Quartermaster - PR 생성 완료\n\nDraft PR이 생성되었습니다: https://github.com/owner/repo/pull/456\n\n리뷰 후 머지해 주세요."],
        { timeout: 30000 }
      );
    });

    it("should pass through options to notifyIssue", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifySuccess("owner/repo", 123, "https://example.com/pr", {
        ghPath: "/usr/bin/gh",
        dryRun: false
      });

      expect(mockRunCli).toHaveBeenCalledWith(
        "/usr/bin/gh",
        expect.arrayContaining(["issue", "comment", "123"]),
        { timeout: 30000 }
      );
    });

    it("should include instanceLabel in message header when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifySuccess("owner/repo", 123, "https://github.com/owner/repo/pull/456", {
        instanceLabel: "prod-1"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("## AI Quartermaster [prod-1] - PR 생성 완료");
    });
  });

  describe("notifyFailure", () => {
    it("should create failure notification with basic error", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Build failed");

      const expectedMessage = `## AI Quartermaster - 파이프라인 실패

자동 구현에 실패했습니다.

**에러**: Build failed

수동 확인이 필요합니다.`;

      expect(mockRunCli).toHaveBeenCalledWith(
        "gh",
        ["issue", "comment", "123", "--repo", "owner/repo", "--body", expectedMessage],
        { timeout: 30000 }
      );
    });

    it("should include error category when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Type error", {
        errorCategory: "TS_ERROR"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("**유형**: `TS_ERROR`");
    });

    it("should include last output when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      const longOutput = "line1\n".repeat(100) + "last important line";

      await notifyFailure("owner/repo", 123, "Build failed", {
        lastOutput: longOutput
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("<details><summary>마지막 출력 (최대 50줄)</summary>");
      expect(body).toContain("last important line");
    });

    it("should include rollback info when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Deploy failed", {
        rollbackInfo: "Rolled back to commit abc123"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("**롤백**: Rolled back to commit abc123");
    });

    it("should include instanceLabel in message header when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Build failed", {
        instanceLabel: "staging-2"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("## AI Quartermaster [staging-2] - 파이프라인 실패");
    });

    it("should truncate long error messages", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      const longError = "Error: ".repeat(100);

      await notifyFailure("owner/repo", 123, longError);

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body.length).toBeLessThan(longError.length + 200); // Message should be truncated
    });

    it("should show MAX_TURNS_EXCEEDED insight when errorCategory is MAX_TURNS_EXCEEDED", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Too many turns", {
        errorCategory: "MAX_TURNS_EXCEEDED"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("이슈 분할");
      expect(body).toContain("maxTurns");
      expect(body).not.toContain("수동 확인이 필요합니다");
    });

    it("should show TIMEOUT insight when errorCategory is TIMEOUT", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Phase timed out", {
        errorCategory: "TIMEOUT"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("타임아웃");
      expect(body).toContain("이슈 분할");
      expect(body).not.toContain("수동 확인이 필요합니다");
    });

    it("should show default insight for other error categories", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Type error", {
        errorCategory: "TS_ERROR"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("수동 확인이 필요합니다");
    });

    it("should show default insight when no errorCategory provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyFailure("owner/repo", 123, "Unknown error");

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("수동 확인이 필요합니다");
    });
  });

  describe("notifyPlanRetryContext", () => {
    const mockRetryContext: PlanRetryContext = {
      currentAttempt: 1,
      maxRetries: 3,
      canRetry: true,
      lastFailureAt: "2024-01-01T10:00:00Z",
      generationHistory: [
        {
          attempt: 1,
          success: false,
          errorCategory: "PLAN_VALIDATION",
          durationMs: 5000,
        },
        {
          attempt: 2,
          success: false,
          errorCategory: "TS_ERROR",
          durationMs: 3000,
        }
      ]
    };

    it("should create retry context notification with basic retry info", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyPlanRetryContext("owner/repo", 123, mockRetryContext);

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];

      expect(body).toContain("## AI Quartermaster - Plan 재시도 및 구체화");
      expect(body).toContain("현재 시도: 2/3");
      expect(body).toContain("재시도 가능: 예");
      expect(body).toContain("마지막 실패 시점: 2024-01-01T10:00:00Z");
    });

    it("should include generation history table", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyPlanRetryContext("owner/repo", 123, mockRetryContext);

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];

      expect(body).toContain("**이전 시도 히스토리**");
      expect(body).toContain("| 시도 | 성공 여부 | 에러 범주 | 지속 시간 |");
      expect(body).toContain("| 1 | ❌ | PLAN_VALIDATION | 5000ms |");
      expect(body).toContain("| 2 | ❌ | TS_ERROR | 3000ms |");
    });

    it("should include contextualization info when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      const mockContextInfo: ContextualizationInfo = {
        functionSignatures: {
          "src/utils/helper.ts": ["function parseData(input: string): Result"]
        },
        importRelations: {
          "src/main.ts": {
            imports: ["./utils/helper.js"],
            exports: ["main"]
          }
        },
        typeDefinitions: {
          "src/types.ts": ["interface Result { success: boolean; data: any; }"]
        }
      };

      await notifyPlanRetryContext("owner/repo", 123, mockRetryContext, mockContextInfo);

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];

      expect(body).toContain("## 추가된 컨텍스트 정보");
      expect(body).toContain("🔧 함수 시그니처");
      expect(body).toContain("**src/utils/helper.ts**:");
      expect(body).toContain("function parseData(input: string): Result");
      expect(body).toContain("📦 Import 관계");
      expect(body).toContain("- Imports: ./utils/helper.js");
      expect(body).toContain("📋 타입 정의");
      expect(body).toContain("interface Result { success: boolean; data: any; }");
    });

    it("should handle empty contextualization sections", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      const emptyContextInfo: ContextualizationInfo = {
        functionSignatures: {},
        importRelations: {},
        typeDefinitions: {}
      };

      await notifyPlanRetryContext("owner/repo", 123, mockRetryContext, emptyContextInfo);

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];

      expect(body).toContain("## 추가된 컨텍스트 정보");
      // Empty sections should not create content
      expect(body).not.toContain("🔧 함수 시그니처");
      expect(body).not.toContain("📦 Import 관계");
      expect(body).not.toContain("📋 타입 정의");
    });

    it("should work without lastFailureAt", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      const contextWithoutFailureTime = {
        ...mockRetryContext,
        lastFailureAt: undefined
      };

      await notifyPlanRetryContext("owner/repo", 123, contextWithoutFailureTime);

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).not.toContain("마지막 실패 시점:");
    });

    it("should include instanceLabel in message header when provided", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      await notifyPlanRetryContext("owner/repo", 123, mockRetryContext, undefined, {
        instanceLabel: "dev-box"
      });

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).toContain("## AI Quartermaster [dev-box] - Plan 재시도 및 구체화");
    });

    it("should work with empty generation history", async () => {
      mockRunCli.mockResolvedValue({
        stdout: "Success",
        stderr: "",
        exitCode: 0,
      });

      const contextWithoutHistory = {
        ...mockRetryContext,
        generationHistory: []
      };

      await notifyPlanRetryContext("owner/repo", 123, contextWithoutHistory);

      const [, , , , , , body] = mockRunCli.mock.calls[0][1] as string[];
      expect(body).not.toContain("**이전 시도 히스토리**");
    });
  });
});