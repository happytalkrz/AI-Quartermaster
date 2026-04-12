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
  addSkipEvent: vi.fn(),
};

const mockQueue = {
  enqueue: vi.fn(),
};

function makeConfig(overrides: Partial<AQConfig> = {}): AQConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.pollingIntervalMs = 50; // fast for tests
  config.general.instanceOwners = ["test-user"]; // poll() 차단 방지용 기본값
  config.projects = [
    {
      repo: "test/repo",
      path: "/tmp/project",
      baseBranch: "master",
    },
  ];
  // general은 shallow merge로 처리 (Object.assign이 general 전체를 덮어쓰는 것을 방지)
  const { general: generalOverride, ...rest } = overrides;
  if (generalOverride) {
    Object.assign(config.general, generalOverride);
  }
  return Object.assign(config, rest);
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

    it("should track listOpenPrs failures and pause project after threshold", async () => {
      const pausingQueue = {
        enqueue: vi.fn(),
        pauseProject: vi.fn(),
        isProjectPaused: vi.fn().mockReturnValue(false),
        getProjectStatus: vi.fn().mockReturnValue(null),
      };
      const pauseConfig = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main", pauseThreshold: 2 }
        ]
      });
      const pausingPoller = new IssuePoller(pauseConfig, mockStore as any, pausingQueue as any);

      mockListOpenPrs.mockRejectedValue(new Error("Network error"));

      // First failure — not yet at threshold
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);
      expect(pausingQueue.pauseProject).not.toHaveBeenCalled();

      // Second failure — should trigger pause
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);
      expect(pausingQueue.pauseProject).toHaveBeenCalledWith("test/repo", 30 * 60 * 1000);
    });

    it("should track checkPrConflict failures and pause project after threshold", async () => {
      const pausingQueue = {
        enqueue: vi.fn(),
        pauseProject: vi.fn(),
        isProjectPaused: vi.fn().mockReturnValue(false),
        getProjectStatus: vi.fn().mockReturnValue(null),
      };
      const pauseConfig = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main", pauseThreshold: 2 }
        ]
      });
      const pausingPoller = new IssuePoller(pauseConfig, mockStore as any, pausingQueue as any);

      mockListOpenPrs.mockResolvedValue([{ number: 123, title: "[#456] test" }]);
      mockCheckPrConflict.mockRejectedValue(new Error("API error"));

      // First failure
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);
      expect(pausingQueue.pauseProject).not.toHaveBeenCalled();

      // Second failure — should trigger pause
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);
      expect(pausingQueue.pauseProject).toHaveBeenCalledWith("test/repo", 30 * 60 * 1000);
    });

    it("should reset error count on successful PR conflict check after failures", async () => {
      const pausingQueue = {
        enqueue: vi.fn(),
        pauseProject: vi.fn(),
        isProjectPaused: vi.fn().mockReturnValue(false),
        getProjectStatus: vi.fn().mockReturnValue(null),
      };
      const pauseConfig = makeConfig({
        projects: [
          { repo: "test/repo", path: "/tmp", baseBranch: "main", pauseThreshold: 3 }
        ]
      });
      const pausingPoller = new IssuePoller(pauseConfig, mockStore as any, pausingQueue as any);

      // Two failures
      mockListOpenPrs.mockRejectedValueOnce(new Error("Error 1"));
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      mockListOpenPrs.mockRejectedValueOnce(new Error("Error 2"));
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(pausingQueue.pauseProject).not.toHaveBeenCalled();

      // Success with actual PRs (no conflicts) should reset error count
      mockListOpenPrs.mockResolvedValueOnce([{ number: 123, title: "[#456] test" }]);
      mockCheckPrConflict.mockResolvedValueOnce(null);
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      // Another failure should start counting from 1 (no pause at threshold=3)
      mockListOpenPrs.mockRejectedValueOnce(new Error("Error after success"));
      await (pausingPoller as any).checkProjectPrConflicts("test/repo", "gh", 30000);

      expect(pausingQueue.pauseProject).not.toHaveBeenCalled();
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

    it("should pass project-specific timeout to checkProjectPrConflicts during poll", async () => {
      const configWithTimeout = makeConfig();
      configWithTimeout.projects[0].commands = {
        ghCli: { timeout: 60000, path: "gh" }
      };

      poller = new IssuePoller(configWithTimeout, mockStore as any, mockQueue as any);
      mockListOpenPrs.mockResolvedValue([]);

      await (poller as any).poll();

      expect(mockListOpenPrs).toHaveBeenCalledWith("test/repo", { ghPath: "gh", timeout: 60000 });
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
      mockStore.findAnyByIssue.mockReturnValue(null);

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
      mockStore.findAnyByIssue.mockReturnValue(null);

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

  describe("findAnyByIssue 기반 중복 디스패치 방지", () => {
    it("findAnyByIssue가 job을 반환하면 이슈를 스킵해야 한다", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // findAnyByIssue: 123은 running job 존재, 124는 없음
      mockStore.findAnyByIssue.mockImplementation((issueNumber: number) =>
        issueNumber === 123 ? { id: "job-123", status: "running", issueNumber: 123, repo: "test/repo" } : null
      );

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([
          { number: 123, title: "Blocked issue", state: "open" },
          { number: 124, title: "New issue", state: "open" }
        ]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);

      // findAnyByIssue는 모든 이슈에 대해 호출되어야 함
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(123, "test/repo");
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(124, "test/repo");

      // job이 없는 이슈만 enqueue
      expect(mockQueue.enqueue).toHaveBeenCalledWith(124, "test/repo", undefined, undefined, undefined, undefined, expect.any(String));
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(123, "test/repo", undefined, undefined, undefined, undefined, expect.any(String));
    });

    it("queued/running/success 등 모든 비-archived 상태 job이 있으면 스킵해야 한다", async () => {
      const config = makeConfig();

      // queued 상태 차단
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);
      mockStore.findAnyByIssue.mockReturnValueOnce({
        id: "job-100", status: "queued", issueNumber: 100, repo: "test/repo"
      });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([{ number: 100, title: "Queued job", state: "open" }]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(100, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(100, "test/repo");

      // running 상태 차단
      vi.clearAllMocks();
      mockStore.findAnyByIssue.mockReturnValueOnce({
        id: "job-101", status: "running", issueNumber: 101, repo: "test/repo"
      });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([{ number: 101, title: "Running job", state: "open" }]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(101, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(101, "test/repo");

      // success 상태도 차단 (핵심 변경: 이전에는 shouldBlockRepickup이 success를 허용했음)
      vi.clearAllMocks();
      mockStore.findAnyByIssue.mockReturnValueOnce({
        id: "job-102", status: "success", issueNumber: 102, repo: "test/repo"
      });

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify([{ number: 102, title: "Success job", state: "open" }]),
        stderr: "",
        exitCode: 0
      });

      await (poller as any).pollProjectLabel("test/repo", "aqm:ready", "gh", 30000);
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(102, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(102, "test/repo");
    });

    it("findAnyByIssue가 null을 반환하면 이슈를 enqueue해야 한다", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

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

      // findAnyByIssue는 모든 이슈에 대해 호출되어야 함
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(200, "test/repo");
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(201, "test/repo");

      // 모든 이슈가 enqueue되어야 함
      expect(mockQueue.enqueue).toHaveBeenCalledWith(200, "test/repo", undefined, undefined, undefined, undefined, expect.any(String));
      expect(mockQueue.enqueue).toHaveBeenCalledWith(201, "test/repo", undefined, undefined, undefined, undefined, expect.any(String));
    });

    it("혼합 시나리오: job 있는 이슈는 스킵, 없는 이슈는 enqueue", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // 300: running job 존재(차단), 301: 없음(허용), 302: queued job 존재(차단)
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

      // findAnyByIssue는 모든 이슈에 대해 호출되어야 함
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(300, "test/repo");
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(301, "test/repo");
      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(302, "test/repo");

      // 301만 enqueue
      expect(mockQueue.enqueue).toHaveBeenCalledWith(301, "test/repo", undefined, undefined, undefined, undefined, expect.any(String));
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(300, "test/repo", undefined, undefined, undefined, undefined, expect.any(String));
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(302, "test/repo", undefined, undefined, undefined, undefined, expect.any(String));
    });

    it("success 상태 job이 있는 이슈도 재enqueue하지 않아야 한다 (스팸 방지)", async () => {
      const config = makeConfig();
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

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

      expect(mockStore.findAnyByIssue).toHaveBeenCalledWith(400, "test/repo");
      expect(mockQueue.enqueue).not.toHaveBeenCalledWith(400, "test/repo");
    });
  });

  describe("instanceLabel 설정 기반 라벨 필터링", () => {
    it("instanceLabel 설정 시 해당 라벨만으로 폴링해야 한다", async () => {
      const config = makeConfig({
        general: {
          instanceLabel: "aqm",
        },
        safety: {
          allowedLabels: ["bug", "feature"],
        },
      });
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);
      mockStore.shouldBlockRepickup.mockReturnValue(false);
      mockRunCli.mockResolvedValue({ stdout: "[]", stderr: "", exitCode: 0 });
      mockListOpenPrs.mockResolvedValue([]);

      await (poller as any).poll();

      const labelArgs = mockRunCli.mock.calls.map(
        (call) => call[1][call[1].indexOf("--label") + 1]
      );
      expect(labelArgs).toContain("aqm");
      expect(labelArgs).not.toContain("bug");
      expect(labelArgs).not.toContain("feature");
    });

    it("instanceLabel 미설정 시 allowedLabels로 폴링해야 한다", async () => {
      const config = makeConfig({
        general: {
          instanceLabel: undefined,
        },
        safety: {
          allowedLabels: ["bug", "feature"],
        },
      } as any);
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);
      mockStore.shouldBlockRepickup.mockReturnValue(false);
      mockRunCli.mockResolvedValue({ stdout: "[]", stderr: "", exitCode: 0 });
      mockListOpenPrs.mockResolvedValue([]);

      await (poller as any).poll();

      const labelArgs = mockRunCli.mock.calls.map(
        (call) => call[1][call[1].indexOf("--label") + 1]
      );
      expect(labelArgs).toContain("bug");
      expect(labelArgs).toContain("feature");
      expect(labelArgs).not.toContain("aqm");
    });
  });

  describe("instanceOwners 미설정 시 폴링 차단", () => {
    it("instanceOwners가 빈 배열이면 poll()이 조기 종료되고 이슈 조회를 하지 않는다", async () => {
      const config = makeConfig();
      config.general.instanceOwners = [];
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      await (poller as any).poll();

      expect(mockRunCli).not.toHaveBeenCalled();
      expect(mockListOpenPrs).not.toHaveBeenCalled();
    });

    it("instanceOwners가 빈 배열이면 경고 로그를 최초 1회만 출력한다", async () => {
      const config = makeConfig();
      config.general.instanceOwners = [];
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // poll()을 3번 호출해도 경고는 1번만 발생해야 함
      await (poller as any).poll();
      await (poller as any).poll();
      await (poller as any).poll();

      // hasWarnedNoOwners 플래그가 true로 세팅되어 있어야 함
      expect((poller as any).hasWarnedNoOwners).toBe(true);
      // 이슈 조회는 한 번도 호출되지 않아야 함
      expect(mockRunCli).not.toHaveBeenCalled();
    });

    it("instanceOwners가 설정되면 정상 폴링이 진행된다", async () => {
      const config = makeConfig();
      config.general.instanceOwners = ["user1"];
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);
      mockStore.shouldBlockRepickup.mockReturnValue(false);
      mockListOpenPrs.mockResolvedValue([]);
      mockRunCli.mockResolvedValue({ stdout: "[]", stderr: "", exitCode: 0 });

      await (poller as any).poll();

      expect(mockRunCli).toHaveBeenCalled();
    });

    it("instanceOwners가 설정되면 hasWarnedNoOwners 플래그가 초기화된다", async () => {
      const config = makeConfig();
      config.general.instanceOwners = [];
      poller = new IssuePoller(config, mockStore as any, mockQueue as any);

      // 먼저 빈 owners로 경고 발생
      await (poller as any).poll();
      expect((poller as any).hasWarnedNoOwners).toBe(true);

      // owners를 설정하면 플래그가 리셋되어야 함
      config.general.instanceOwners = ["user1"];
      mockStore.shouldBlockRepickup.mockReturnValue(false);
      mockListOpenPrs.mockResolvedValue([]);
      mockRunCli.mockResolvedValue({ stdout: "[]", stderr: "", exitCode: 0 });

      await (poller as any).poll();
      expect((poller as any).hasWarnedNoOwners).toBe(false);
    });
  });
});