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
  findFailedJobsForRetry: vi.fn().mockReturnValue([]),
  findAnyByIssue: vi.fn(),
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

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo", { ghPath: "gh", timeout: 30000 });
      expect(mockCheckPrConflict).not.toHaveBeenCalled();
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should skip when listOpenPrs returns null", async () => {
      mockListOpenPrs.mockResolvedValue(null);

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo", { ghPath: "gh", timeout: 30000 });
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

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(mockCheckPrConflict).toHaveBeenCalledTimes(2);
      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh", timeout: 30000 });
      expect(mockCheckPrConflict).toHaveBeenCalledWith(124, "test/repo", { ghPath: "gh", timeout: 30000 });
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

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh", timeout: 30000 });
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

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh", timeout: 30000 });
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

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh", timeout: 30000 });
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
      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);
      expect(mockCommentOnIssue).toHaveBeenCalledTimes(1);

      // Reset mock calls
      mockCheckPrConflict.mockClear();
      mockCommentOnIssue.mockClear();

      // Second call - should skip notification (already notified)
      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);
      expect(mockCheckPrConflict).not.toHaveBeenCalled(); // skipped due to notification cache
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should handle checkPrConflict failure gracefully", async () => {
      const openPrs = [{ number: 123, title: "[#456] Fix auth bug" }];

      mockListOpenPrs.mockResolvedValue(openPrs);
      mockCheckPrConflict.mockRejectedValue(new Error("gh command failed"));

      // Should not throw
      await expect((poller as any).checkProjectPrConflicts("test/repo", "gh", 30000)).resolves.toBeUndefined();

      expect(mockCheckPrConflict).toHaveBeenCalledWith(123, "test/repo", { ghPath: "gh", timeout: 30000 });
      expect(mockCommentOnIssue).not.toHaveBeenCalled();
    });

    it("should handle listOpenPrs failure gracefully", async () => {
      mockListOpenPrs.mockRejectedValue(new Error("Network error"));

      // Should not throw
      await expect((poller as any).checkProjectPrConflicts("test/repo", "gh", 30000)).resolves.toBeUndefined();

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo", { ghPath: "gh", timeout: 30000 });
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

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

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

      await (poller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

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
      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo-a", { ghPath: "gh", timeout: 30000 });
      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo-b", { ghPath: "gh", timeout: 30000 });
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

  describe("Project error tracking and polling pause", () => {
    let mockQueue: any;

    beforeEach(() => {
      mockQueue = {
        enqueue: vi.fn(),
        isProjectPaused: vi.fn().mockReturnValue(false),
        getProjectStatus: vi.fn().mockReturnValue(null),
        pauseProject: vi.fn(),
      };
    });

    it("should track polling failures and pause project after threshold", async () => {
      const config = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main", pauseThreshold: 2, pauseDurationMs: 60000 }
        ]
      });
      poller = new IssuePoller(config, mockStore as any, mockQueue);

      // First failure
      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Network error", exitCode: 1 });
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      expect(mockQueue.pauseProject).not.toHaveBeenCalled();

      // Second failure - should trigger pause
      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Network error", exitCode: 1 });
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      expect(mockQueue.pauseProject).toHaveBeenCalledWith("test/repo", 60000);
    });

    it("should reset error count on successful polling", async () => {
      const config = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main", pauseThreshold: 3 }
        ]
      });
      poller = new IssuePoller(config, mockStore as any, mockQueue);

      // Two failures
      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Error 1", exitCode: 1 });
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Error 2", exitCode: 1 });
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      expect(mockQueue.pauseProject).not.toHaveBeenCalled();

      // Success should reset count
      mockRunCli.mockResolvedValueOnce({ stdout: "[]", stderr: "", exitCode: 0 });
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      // Another failure should start counting from 1 again (not trigger pause)
      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Error after success", exitCode: 1 });
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      expect(mockQueue.pauseProject).not.toHaveBeenCalled();
    });

    it("should use default pause settings when project config is missing", async () => {
      const config = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main" } // no pauseThreshold or pauseDurationMs
        ]
      });
      poller = new IssuePoller(config, mockStore as any, mockQueue);

      // Three failures with default threshold (3)
      for (let i = 0; i < 3; i++) {
        mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Error", exitCode: 1 });
        await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);
      }

      // Should pause with default duration (30 minutes = 30 * 60 * 1000 ms)
      expect(mockQueue.pauseProject).toHaveBeenCalledWith("test/repo", 30 * 60 * 1000);
    });

    it("should handle runtime errors during polling", async () => {
      const config = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main", pauseThreshold: 2 }
        ]
      });
      poller = new IssuePoller(config, mockStore as any, mockQueue);

      // Runtime error (not exit code error)
      mockRunCli.mockRejectedValueOnce(new Error("Connection timeout"));
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      // Another runtime error should trigger pause
      mockRunCli.mockRejectedValueOnce(new Error("DNS resolution failed"));
      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      expect(mockQueue.pauseProject).toHaveBeenCalledWith("test/repo", 30 * 60 * 1000);
    });

    it("should skip paused projects during poll", async () => {
      const config = makeConfig({
        projects: [
          { repo: "test/repo1", path: "/tmp1", baseBranch: "main" },
          { repo: "test/repo2", path: "/tmp2", baseBranch: "main" }
        ],
        safety: {
          allowedLabels: ["aqm:ready", "enhancement", "bug"]
        }
      });

      // Mock repo1 as paused, repo2 as active
      mockQueue.isProjectPaused.mockImplementation((repo: string) => repo === "test/repo1");
      mockQueue.getProjectStatus.mockImplementation((repo: string) =>
        repo === "test/repo1"
          ? { consecutiveFailures: 3, pausedUntil: Date.now() + 60000, lastFailureAt: Date.now() }
          : null
      );

      poller = new IssuePoller(config, mockStore as any, mockQueue);
      mockStore.shouldBlockRepickup.mockReturnValue(false);

      await (poller as any).poll();

      // Should only poll active projects
      expect(mockRunCli).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["--repo", "test/repo2"]),
        expect.any(Object)
      );

      expect(mockRunCli).not.toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["--repo", "test/repo1"]),
        expect.any(Object)
      );

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo2", expect.any(Object));
      expect(mockListOpenPrs).not.toHaveBeenCalledWith("test/repo1", expect.any(Object));
    });

    it("should handle mixed paused and active projects", async () => {
      const config = makeConfig({
        projects: [
          { repo: "test/active1", path: "/tmp1", baseBranch: "main" },
          { repo: "test/paused", path: "/tmp2", baseBranch: "main" },
          { repo: "test/active2", path: "/tmp3", baseBranch: "main" }
        ],
        safety: {
          allowedLabels: ["aqm:ready", "enhancement", "bug"]
        }
      });

      mockQueue.isProjectPaused.mockImplementation((repo: string) => repo === "test/paused");
      mockQueue.getProjectStatus.mockImplementation((repo: string) =>
        repo === "test/paused"
          ? { consecutiveFailures: 3, pausedUntil: Date.now() + 30000, lastFailureAt: Date.now() }
          : null
      );

      poller = new IssuePoller(config, mockStore as any, mockQueue);
      mockStore.shouldBlockRepickup.mockReturnValue(false);

      await (poller as any).poll();

      // Should poll only active projects
      const callCount = mockRunCli.mock.calls.length;
      const reposCalled = mockRunCli.mock.calls
        .map(call => call[1].find((arg, i) => call[1][i-1] === "--repo"))
        .filter(Boolean);

      expect(reposCalled).toContain("test/active1");
      expect(reposCalled).toContain("test/active2");
      expect(reposCalled).not.toContain("test/paused");
    });

    it("should gracefully handle queue methods not available in test mode", async () => {
      const limitedQueue = {
        enqueue: vi.fn(),
        // Missing isProjectPaused and pauseProject methods
      };

      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, limitedQueue as any);

      // Should not throw when queue methods are missing
      mockRunCli.mockResolvedValue({ stdout: "", stderr: "Error", exitCode: 1 });

      await expect((poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000))
        .resolves.not.toThrow();

      // poll should also handle missing methods
      await expect((poller as any).poll()).resolves.not.toThrow();
    });

    it("should reset error count after 1 hour of no failures", async () => {
      const config = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main", pauseThreshold: 3 }
        ]
      });
      poller = new IssuePoller(config, mockStore as any, mockQueue);

      // Mock Date.now to control time
      const originalDateNow = Date.now;
      let mockTime = 1000000;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      try {
        // Two failures
        mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Error 1", exitCode: 1 });
        await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

        mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Error 2", exitCode: 1 });
        await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

        // Advance time by more than 1 hour
        mockTime += 61 * 60 * 1000; // 61 minutes

        // Third failure should start counting from 1 (not trigger pause)
        mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "Error after timeout", exitCode: 1 });
        await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

        expect(mockQueue.pauseProject).not.toHaveBeenCalled();
      } finally {
        vi.spyOn(Date, 'now').mockImplementation(originalDateNow);
      }
    });
  });

  describe("shouldBlockRepickup integration", () => {
    it("should skip issues blocked by shouldBlockRepickup", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // Mock shouldBlockRepickup to return true for specific issue
      mockStore.shouldBlockRepickup.mockImplementation((issueNumber: number) =>
        issueNumber === 123
      );

      // Mock findAnyByIssue to return a running job for blocked issue
      mockStore.findAnyByIssue.mockImplementation((issueNumber: number) =>
        issueNumber === 123 ? { id: "job-123", status: "running", issueNumber: 123, repo: "test/repo" } : null
      );

      // Mock issues response
      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([
          { number: 123, title: "Blocked issue", state: "open" },
          { number: 124, title: "New issue", state: "open" }
        ]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      // Verify shouldBlockRepickup was called for both issues
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(123, "test/repo");
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(124, "test/repo");

      // Verify only non-blocked issue was enqueued
      expect(mockQueue.enqueue).toHaveBeenCalledWith(124, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(123, "test/repo");
    });

    it("should handle different blocking job statuses", async () => {
      const config = makeConfig();

      // Test queued status blocking
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);
      mockStore.shouldBlockRepickup.mockReturnValueOnce(true);
      mockStore.findAnyByIssue.mockReturnValueOnce({
        id: "job-100", status: "queued", issueNumber: 100, repo: "test/repo"
      });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([{ number: 100, title: "Queued job", state: "open" }]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(100, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(100, "test/repo");

      // Reset and test running status blocking
      vi.clearAllMocks();
      mockStore.shouldBlockRepickup.mockReturnValueOnce(true);
      mockStore.findAnyByIssue.mockReturnValueOnce({
        id: "job-101", status: "running", issueNumber: 101, repo: "test/repo"
      });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([{ number: 101, title: "Running job", state: "open" }]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(101, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(101, "test/repo");

      // Reset and test success status blocking
      vi.clearAllMocks();
      mockStore.shouldBlockRepickup.mockReturnValueOnce(true);
      mockStore.findAnyByIssue.mockReturnValueOnce({
        id: "job-102", status: "success", issueNumber: 102, repo: "test/repo"
      });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([{ number: 102, title: "Success job", state: "open" }]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(102, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(102, "test/repo");
    });

    it("should enqueue available issues when shouldBlockRepickup returns false", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // Mock shouldBlockRepickup to allow all issues
      mockStore.shouldBlockRepickup.mockReturnValue(false);
      mockStore.findAnyByIssue.mockReturnValue(null);

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([
          { number: 200, title: "Available task 1", state: "open" },
          { number: 201, title: "Available task 2", state: "open" }
        ]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      // Verify shouldBlockRepickup was called for all issues
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(200, "test/repo");
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(201, "test/repo");

      // Verify all issues were enqueued
      expect(mockQueue.enqueue).toHaveBeenCalledWith(200, "test/repo");
      expect(mockQueue.enqueue).toHaveBeenCalledWith(201, "test/repo");
    });

    it("should handle mixed blocked and available issues correctly", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // Mock mixed scenarios: block 300 and 302, allow 301
      mockStore.shouldBlockRepickup
        .mockReturnValueOnce(true)  // issue 300 blocked
        .mockReturnValueOnce(false) // issue 301 available
        .mockReturnValueOnce(true); // issue 302 blocked

      mockStore.findAnyByIssue
        .mockReturnValueOnce({ id: "job-300", status: "running", issueNumber: 300, repo: "test/repo" })
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ id: "job-302", status: "queued", issueNumber: 302, repo: "test/repo" });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([
          { number: 300, title: "Blocked by running", state: "open" },
          { number: 301, title: "Available task", state: "open" },
          { number: 302, title: "Blocked by queued", state: "open" }
        ]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      // Verify shouldBlockRepickup was called for all issues
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(300, "test/repo");
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(301, "test/repo");
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(302, "test/repo");

      // Verify only available issue was enqueued
      expect(mockQueue.enqueue).toHaveBeenCalledWith(301, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(300, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(302, "test/repo");

      // Verify findAnyByIssue was called for blocked issues to get job details
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(300, "test/repo");
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(302, "test/repo");
    });

    it("should correctly integrate shouldBlockRepickup with existing job lookup", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // Mock shouldBlockRepickup to return true and verify findAnyByIssue integration
      mockStore.shouldBlockRepickup.mockReturnValue(true);
      mockStore.findAnyByIssue.mockReturnValue({
        id: "job-400",
        status: "success",
        issueNumber: 400,
        repo: "test/repo",
        completedAt: new Date().toISOString()
      });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([{ number: 400, title: "Completed task", state: "open" }]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      // Verify the integration flow: shouldBlockRepickup -> findAnyByIssue for job details
      expect(mockStore.shouldBlockRepickup).toHaveBeenCalledWith(400, "test/repo");
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(400, "test/repo");

      // Verify issue was not enqueued due to blocking
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(400, "test/repo");
    });
  });
});