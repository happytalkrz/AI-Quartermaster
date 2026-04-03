import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/github/pr-creator.js", () => ({
  checkPrConflict: vi.fn(),
  commentOnIssue: vi.fn(),
  listOpenPrs: vi.fn(),
}));

import { IssuePoller } from "../../src/polling/issue-poller.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { checkPrConflict, commentOnIssue, listOpenPrs } from "../../src/github/pr-creator.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AQConfig } from "../../src/types/config.js";

const mockRunCli = vi.mocked(runCli);
const mockCheckPrConflict = vi.mocked(checkPrConflict);
const mockCommentOnIssue = vi.mocked(commentOnIssue);
const mockListOpenPrs = vi.mocked(listOpenPrs);

// Mock job store and queue
const mockStore = {
  shouldBlockRepickup: vi.fn(),
};

const mockQueue = {
  enqueue: vi.fn(),
};

function makeConfig(overrides: Partial<AQConfig> = {}): AQConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.pollingIntervalMs = 50; // fast for tests
  config.projects = [
    {
      repo: "test/repo",
      path: "/tmp/project",
      baseBranch: "master",
    },
  ];
  return Object.assign(config, overrides);
}

describe("IssuePoller - PR 충돌 체크 통합", () => {
  let poller: IssuePoller;
  let config: AQConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = makeConfig();
    poller = new IssuePoller(config, mockStore as any, mockQueue as any);

    // Default mock implementations
    mockRunCli.mockResolvedValue({ stdout: "[]", stderr: "", exitCode: 0 });
    mockListOpenPrs.mockResolvedValue([]);
    mockCheckPrConflict.mockResolvedValue(null);
    mockCommentOnIssue.mockResolvedValue(true);
  });

  describe("checkProjectPrConflicts", () => {
    it("should skip when no open PRs exist", async () => {
      mockListOpenPrs.mockResolvedValue([]);

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo", { ghPath: "gh" });
      expect(mockCheckPrConflict).not.toHaveBeenCalled();
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should skip when listOpenPrs returns null", async () => {
      mockListOpenPrs.mockResolvedValue(null);

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo", { ghPath: "gh" });
      expect(mockCheckPrConflict).not.toHaveBeenCalled();
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should check all open PRs for conflicts", async () => {
      const openPrs = [
        { number: 123, title: "[#456] Fix auth bug" },
        { number: 124, title: "[#789] Add new feature" },
      ];
      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockResolvedValue(null); // no conflicts

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockCheckPrConflict).toHaveBeenCalledTimes(2);
      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh" });
      expect(mockCheckPrConflict).toHaveBeenCalledWith(124, "test/repo", { ghPath: "gh" });
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should comment on issue when PR has DIRTY conflict", async () => {
      const openPrs = [{ number: 123, title: "[#456] Fix auth bug" }];
      const conflictInfo = {
        prNumber: 123,
        repo: "test/repo",
        conflictFiles: ["src/auth.ts", "src/login.ts"],
        detectedAt: "2026-04-03T12:00:00.000Z",
        mergeStatus: "DIRTY" as const,
      };

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockResolvedValue(conflictInfo);
      mockCommentOnIssue.mockResolvedValue(true);

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh" });
      expect(mockCommentOnIssue).toHaveBeenCalledWith(
        456,
        "test/repo",
        expect.stringContaining("🚨 **PR #123 머지 충돌 감지**"),
        { ghPath: "gh" }
      );

      // Check conflict message content
      const [, , message] = mockCommentOnIssue.mock.calls[0];
      expect(message).toContain("상태**: DIRTY");
      expect(message).toContain("감지 시간**: 2026-04-03T12:00:00.000Z");
      expect(message).toContain("- `src/auth.ts`");
      expect(message).toContain("- `src/login.ts`");
      expect(message).toContain("베이스 브랜치의 변경으로 인해");
      expect(message).toContain("_자동 생성된 알림 — AQM PR 모니터링_");
    });

    it("should handle missing issue number in PR title", async () => {
      const openPrs = [{ number: 123, title: "Fix auth bug without issue number" }];
      const conflictInfo = {
        prNumber: 123,
        repo: "test/repo",
        conflictFiles: ["src/auth.ts"],
        detectedAt: "2026-04-03T12:00:00.000Z",
        mergeStatus: "DIRTY" as const,
      };

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockResolvedValue(conflictInfo);

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh" });
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should handle comment failure gracefully", async () => {
      const openPrs = [{ number: 123, title: "[#456] Fix auth bug" }];
      const conflictInfo = {
        prNumber: 123,
        repo: "test/repo",
        conflictFiles: ["src/auth.ts"],
        detectedAt: "2026-04-03T12:00:00.000Z",
        mergeStatus: "DIRTY" as const,
      };

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockResolvedValue(conflictInfo);
      mockCommentOnIssue.mockResolvedValue(false); // comment failure

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh" });
      expect(mockCommentOnIssue).toHaveBeenCalledWith(
        456,
        "test/repo",
        expect.stringContaining("🚨 **PR #123 머지 충돌 감지**"),
        { ghPath: "gh" }
      );
    });

    it("should skip already notified PRs", async () => {
      const openPrs = [{ number: 123, title: "[#456] Fix auth bug" }];
      const conflictInfo = {
        prNumber: 123,
        repo: "test/repo",
        conflictFiles: ["src/auth.ts"],
        detectedAt: "2026-04-03T12:00:00.000Z",
        mergeStatus: "DIRTY" as const,
      };

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockResolvedValue(conflictInfo);
      mockCommentOnIssue.mockResolvedValue(true);

      // First call - should notify
      await (poller as any).checkProjectPrConflicts("test/repo", "gh");
      expect(mockCommentOnIssue).toHaveBeenCalledTimes(1);

      // Reset mock calls
      mockCheckPrConflict.mockClear();
      mockCommentOnIssue.mockClear();

      // Second call - should skip notification (already notified)
      await (poller as any).checkProjectPrConflicts("test/repo", "gh");
      expect(mockCheckPrConflict).not.toHaveBeenCalled(); // skipped due to notification cache
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should handle checkPrConflict failure gracefully", async () => {
      const openPrs = [{ number: 123, title: "[#456] Fix auth bug" }];

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockRejectedValue(new Error("gh command failed"));

      // Should not throw
      await expect((poller as any).checkProjectPrConflicts("test/repo", "gh")).resolves.toBeUndefined();

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh" });
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should handle listOpenPrs failure gracefully", async () => {
      mockListOpenPrs.mockRejectedValue(new Error("Network error"));

      // Should not throw
      await expect((poller as any).checkProjectPrConflicts("test/repo", "gh")).resolves.toBeUndefined();

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo", { ghPath: "gh" });
      expect(mockCheckPrConflict).not.toHaveBeenCalled();
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should build correct conflict message with multiple files", async () => {
      const openPrs = [{ number: 789, title: "[#999] Major refactor" }];
      const conflictInfo = {
        prNumber: 789,
        repo: "test/repo",
        conflictFiles: ["src/utils/helper.ts", "src/components/Button.tsx", "tests/integration.test.ts"],
        detectedAt: "2026-04-03T15:30:45.123Z",
        mergeStatus: "DIRTY" as const,
      };

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockResolvedValue(conflictInfo);
      mockCommentOnIssue.mockResolvedValue(true);

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockCommentOnIssue).toHaveBeenCalledWith(
        999,
        "test/repo",
        expect.stringContaining("🚨 **PR #789 머지 충돌 감지**"),
        { ghPath: "gh" }
      );

      const [, , message] = mockCommentOnIssue.mock.calls[0];
      expect(message).toContain("- `src/utils/helper.ts`");
      expect(message).toContain("- `src/components/Button.tsx`");
      expect(message).toContain("- `tests/integration.test.ts`");
      expect(message).toContain("2026-04-03T15:30:45.123Z");
    });

    it("should build correct conflict message with no conflict files", async () => {
      const openPrs = [{ number: 456, title: "[#789] Simple fix" }];
      const conflictInfo = {
        prNumber: 456,
        repo: "test/repo",
        conflictFiles: [],
        detectedAt: "2026-04-03T10:15:30.000Z",
        mergeStatus: "BEHIND" as const,
      };

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockResolvedValue(conflictInfo);
      mockCommentOnIssue.mockResolvedValue(true);

      await (poller as any).checkProjectPrConflicts("test/repo", "gh");

      expect(mockCommentOnIssue).toHaveBeenCalledWith(
        789,
        "test/repo",
        expect.stringContaining("🚨 **PR #456 머지 충돌 감지**"),
        { ghPath: "gh" }
      );

      const [, , message] = mockCommentOnIssue.mock.calls[0];
      expect(message).toContain("**상태**: BEHIND");
      expect(message).not.toContain("**충돌 파일(들)**:");
    });
  });

  describe("poll integration with PR conflict checks", () => {
    beforeEach(() => {
      // Mock issue polling to return empty results
      mockRunCli.mockResolvedValue({ stdout: "[]", stderr: "", exitCode: 0 });
    });

    it("should call checkProjectPrConflicts for each project during poll", async () => {
      const multiProjectConfig = makeConfig({
        projects: [
          { repo: "test/repo-a", path: "/tmp/a", baseBranch: "master" },
          { repo: "test/repo-b", path: "/tmp/b", baseBranch: "main" },
        ],
      });

      poller = new IssuePoller(multiProjectConfig, mockStore as any, mockQueue as any);
      mockListOpenPrs.mockResolvedValue([]);

      await (poller as any).poll();

      expect(mockListOpenPrs).toHaveBeenCalledTimes(2);
      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo-a", { ghPath: "gh" });
      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo-b", { ghPath: "gh" });
    });

    it("should handle mixed success and failure in PR conflict checks", async () => {
      const multiProjectConfig = makeConfig({
        projects: [
          { repo: "test/repo-success", path: "/tmp/success", baseBranch: "master" },
          { repo: "test/repo-failure", path: "/tmp/failure", baseBranch: "main" },
        ],
      });

      poller = new IssuePoller(multiProjectConfig, mockStore as any, mockQueue as any);

      mockListOpenPrs
        .mockResolvedValueOnce([{ number: 100, title: "[#200] Success case" }])
        .mockRejectedValueOnce(new Error("Failure case"));

      mockCheckPrConflict.mockResolvedValue(null);

      // Should not throw despite one failure
      await expect((poller as any).poll()).resolves.toBeUndefined();

      expect(mockListOpenPrs).toHaveBeenCalledTimes(2);
      expect(mockCheckPrConflict).toHaveBeenCalledTimes(1); // Only called for successful repo
    });
  });
});