import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IssuePoller } from "../../src/polling/issue-poller.js";

// Mock runCli so we never shell out during tests
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

// Mock checkpoint removal for integration tests
vi.mock("../../src/pipeline/errors/checkpoint.js", () => ({
  removeCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(),
}));

// Mock worktree management for integration tests
vi.mock("../../src/git/worktree-manager.js", () => ({
  removeWorktree: vi.fn(),
}));

// Mock SelfUpdater for integration tests
vi.mock("../../src/update/self-updater.js", () => ({
  SelfUpdater: vi.fn(),
}));

import { runCli } from "../../src/utils/cli-runner.js";
import { removeCheckpoint, loadCheckpoint } from "../../src/pipeline/errors/checkpoint.js";
import { removeWorktree } from "../../src/git/worktree-manager.js";
import { SelfUpdater } from "../../src/update/self-updater.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AQConfig } from "../../src/types/config.js";
import type { Job } from "../../src/queue/job-store.js";
import type { UpdateInfo } from "../../src/update/self-updater.js";

const mockRunCli = vi.mocked(runCli);
const mockRemoveCheckpoint = vi.mocked(removeCheckpoint);
const mockLoadCheckpoint = vi.mocked(loadCheckpoint);
const mockRemoveWorktree = vi.mocked(removeWorktree);
const mockSelfUpdater = vi.mocked(SelfUpdater);

// ---------------------------------------------------------------------------
// Lightweight in-memory doubles for JobStore and JobQueue
// ---------------------------------------------------------------------------

function makeJobStore(existingJobs: Array<{ issueNumber: number; repo: string; status?: string }> = []) {
  const jobs = existingJobs.map((j, i) => ({
    id: `aq-${j.issueNumber}-${i}`,
    issueNumber: j.issueNumber,
    repo: j.repo,
    status: (j.status || "queued") as const,
    createdAt: new Date().toISOString(),
  }));

  return {
    findByIssue: vi.fn((issueNumber: number, repo: string): Job | undefined => {
      return jobs.find(
        j =>
          j.issueNumber === issueNumber &&
          j.repo === repo &&
          (j.status === "queued" || j.status === "running"),
      );
    }),
    findAnyByIssue: vi.fn((issueNumber: number, repo: string): Job | undefined => {
      return jobs.find(j => j.issueNumber === issueNumber && j.repo === repo && j.status !== "archived");
    }),
    shouldBlockRepickup: vi.fn((issueNumber: number, repo: string): boolean => {
      // success는 재라벨 재처리를 허용하기 위해 차단하지 않음 — queued/running만 차단
      return jobs.some(
        j => j.issueNumber === issueNumber && j.repo === repo &&
          (j.status === "queued" || j.status === "running"),
      );
    }),
    findFailedJobsForRetry: vi.fn((): Job[] => {
      const now = Date.now();
      const RETRY_DELAY_MS = 10 * 60 * 1000; // 10분 대기 후 재시도

      return jobs.filter(job => {
        // failed 상태이고 retry가 아닌 job만
        if (job.status !== "failure" || job.isRetry === true) {
          return false;
        }

        // 최근 실패한 job은 제외 (10분 대기)
        const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
        return completedAt > 0 && (now - completedAt) > RETRY_DELAY_MS;
      });
    }),
    create: vi.fn((issueNumber: number, repo: string): Job => {
      const job: Job = {
        id: `aq-${issueNumber}-${Date.now()}`,
        issueNumber,
        repo,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      jobs.push(job);
      return job;
    }),
    archive: vi.fn((id: string): boolean => {
      const job = jobs.find(j => j.id === id);
      if (job) {
        job.status = "archived" as const;
        return true;
      }
      return false;
    }),
    get: vi.fn((id: string): Job | undefined => {
      return jobs.find(j => j.id === id);
    }),
  };
}

function makeJobQueue(store: ReturnType<typeof makeJobStore>) {
  return {
    enqueue: vi.fn((issueNumber: number, repo: string): Job | undefined => {
      const existing = store.findAnyByIssue(issueNumber, repo);
      if (existing) {
        if (existing.status === "success") {
          // 재라벨 시 success job auto-archive (checkpoint 정리 불필요)
          store.archive(existing.id);
        } else if (existing.status === "failure" || existing.status === "cancelled") {
          // failed/cancelled: checkpoint 정리 후 archive
          const dataDir = "/tmp/test-data";

          try {
            const checkpoint = mockLoadCheckpoint(dataDir, issueNumber);
            if (checkpoint?.worktreePath) {
              mockRemoveWorktree(
                { gitPath: "git" },
                checkpoint.worktreePath,
                { cwd: "/tmp/project", force: true }
              );
            }
          } catch (_checkpointErr) {
            // error handling
          }

          try {
            mockRemoveCheckpoint(dataDir, issueNumber);
          } catch (_err) {
            // error handling
          }

          store.archive(existing.id);
        } else {
          // queued/running: 차단
          return undefined;
        }
      }

      return store.create(issueNumber, repo);
    }),
  };
}

// ---------------------------------------------------------------------------
// Config helper
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AQConfig> = {}): AQConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.pollingIntervalMs = 50; // fast for tests
  config.general.instanceOwners = ["test-user"]; // poll() 차단 방지용 기본값
  config.safety.allowedLabels = ["aq-task"];
  config.projects = [
    {
      repo: "test/repo",
      path: "/tmp/project",
      baseBranch: "master",
    },
  ];
  return Object.assign(config, overrides);
}

function makeGhIssueListResponse(issues: Array<{ number: number; title: string; labels?: string[] }>) {
  return JSON.stringify(
    issues.map(i => ({
      number: i.number,
      title: i.title,
      labels: (i.labels ?? ["aq-task"]).map(name => ({ name })),
    })),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: polling integration", () => {
  let poller: IssuePoller;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    mockLoadCheckpoint.mockReturnValue(null); // Default: no checkpoint found
    mockRemoveWorktree.mockResolvedValue(undefined); // Default: successful removal

    // Setup SelfUpdater mock instance
    const mockSelfUpdaterInstance = {
      checkForUpdates: vi.fn(),
    };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);
  });

  afterEach(() => {
    poller?.stop();
  });

  // -------------------------------------------------------------------------
  // 1. Detects new issues with trigger label
  // -------------------------------------------------------------------------
  it("detects new issues with trigger label and enqueues them", async () => {
    const store = makeJobStore(); // empty store — no existing jobs
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 10, title: "Add feature A", labels: ["aq-task"] },
        { number: 11, title: "Fix regression B", labels: ["aq-task"] },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);

    // Manually trigger one poll cycle by calling the private method via cast
    await (poller as any).poll();

    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith(10, "test/repo");
    expect(queue.enqueue).toHaveBeenCalledWith(11, "test/repo");
  });

  // -------------------------------------------------------------------------
  // 2. Skips issues with active (queued/running) jobs — shouldBlockRepickup
  // -------------------------------------------------------------------------
  it("skips issues with queued or running jobs (active processing blocks re-pickup)", async () => {
    // Issue #10 already has a queued job (active processing — should block)
    const store = makeJobStore([{ issueNumber: 10, repo: "test/repo", status: "queued" }]);
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 10, title: "Add feature A" }, // has queued job - should be blocked
        { number: 12, title: "New issue C" },    // new - should be enqueued
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // Only the new issue should be enqueued (queued/running blocks re-pickup)
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(12, "test/repo");
    expect(queue.enqueue).not.toHaveBeenCalledWith(10, expect.anything());
  });

  // -------------------------------------------------------------------------
  // 2b. Success jobs block re-pickup from pollProjectLabel (스팸 방지)
  // -------------------------------------------------------------------------
  it("skips re-pickup of success jobs in pollProjectLabel (spam prevention)", async () => {
    // Issue #10 has a success job — pollProjectLabel should skip it to prevent spam
    const store = makeJobStore([{ issueNumber: 10, repo: "test/repo", status: "success" }]);
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 10, title: "Add feature A" }, // has success job - should be skipped
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // pollProjectLabel should NOT re-enqueue - success job blocks re-pickup
    expect(queue.enqueue).not.toHaveBeenCalledWith(10, "test/repo");

    // Original success job should remain unchanged (not archived by poller)
    const originalJob = store.get("aq-10-0");
    expect(originalJob?.status).toBe("success");
  });

  // -------------------------------------------------------------------------
  // 3. Failed jobs block re-pickup from pollProjectLabel (스팸 방지)
  // -------------------------------------------------------------------------
  it("skips re-pickup of issues with failed jobs in pollProjectLabel (spam prevention)", async () => {
    // Issue #10 has a failed job — pollProjectLabel should skip it to prevent spam
    // (retry is handled by pollFailedJobs separately with 10-minute delay)
    const store = makeJobStore([{ issueNumber: 10, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 10, title: "Add feature A" }, // has failed job - should be skipped
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // pollProjectLabel should NOT re-enqueue - failure job blocks re-pickup
    expect(queue.enqueue).not.toHaveBeenCalledWith(10, "test/repo");
  });

  // -------------------------------------------------------------------------
  // 4. Empty issue list produces no enqueues
  // -------------------------------------------------------------------------
  it("does nothing when gh returns an empty issue list", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. gh CLI error — poll cycle does not throw, enqueue is not called
  // -------------------------------------------------------------------------
  it("handles gh CLI failure gracefully without enqueuing", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "gh: authentication required",
      exitCode: 1,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);

    // Should not throw
    await expect((poller as any).poll()).resolves.toBeUndefined();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Multiple projects — each project+label combination is polled
  // -------------------------------------------------------------------------
  it("polls every project configured in config.projects", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);

    const config = makeConfig();
    config.projects = [
      { repo: "test/repo-a", path: "/tmp/a", baseBranch: "master" },
      { repo: "test/repo-b", path: "/tmp/b", baseBranch: "main" },
    ];

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(config, store as any, queue as any);
    await (poller as any).poll();

    // One runCli call per project×label combination + one PR list call per project
    expect(mockRunCli).toHaveBeenCalledTimes(4);

    const reposPolled = mockRunCli.mock.calls.map(call => {
      const args = call[1] as string[];
      const repoIdx = args.indexOf("--repo");
      return repoIdx >= 0 ? args[repoIdx + 1] : undefined;
    });
    expect(reposPolled).toContain("test/repo-a");
    expect(reposPolled).toContain("test/repo-b");
  });

  // -------------------------------------------------------------------------
  // 6. pollProjectLabel은 failure job 있는 이슈를 스킵한다 (스팸 방지)
  // -------------------------------------------------------------------------
  it("skips failed job issues in pollProjectLabel (no auto-archive, no new job from poller)", async () => {
    // Start with a failed job for issue #20
    const store = makeJobStore([{ issueNumber: 20, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    // Mock GitHub returning the same issue again
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 20, title: "Fix critical bug", labels: ["aq-task"] },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // pollProjectLabel should NOT enqueue - failure job blocks re-pickup
    expect(queue.enqueue).not.toHaveBeenCalledWith(20, "test/repo");

    // No cleanup should be triggered from pollProjectLabel
    expect(mockLoadCheckpoint).not.toHaveBeenCalled();
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockRemoveCheckpoint).not.toHaveBeenCalled();

    // Original failed job should remain unchanged
    const originalJob = store.get("aq-20-0");
    expect(originalJob?.status).toBe("failure");
  });

  // -------------------------------------------------------------------------
  // 7. pollProjectLabel은 failure/cancelled job 있는 이슈를 모두 스킵한다
  // -------------------------------------------------------------------------
  it("skips all issues with failure or cancelled jobs in pollProjectLabel", async () => {
    // Start with multiple failed/cancelled jobs
    const store = makeJobStore([
      { issueNumber: 30, repo: "test/repo", status: "failure" },
      { issueNumber: 31, repo: "test/repo", status: "cancelled" },
    ]);
    const queue = makeJobQueue(store);

    // Mock GitHub returning both issues again
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 30, title: "Failed feature A" },
        { number: 31, title: "Cancelled feature B" },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // Neither issue should be re-enqueued from pollProjectLabel
    expect(queue.enqueue).not.toHaveBeenCalledWith(30, "test/repo");
    expect(queue.enqueue).not.toHaveBeenCalledWith(31, "test/repo");

    // No cleanup triggered from pollProjectLabel
    expect(mockLoadCheckpoint).not.toHaveBeenCalled();
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockRemoveCheckpoint).not.toHaveBeenCalled();

    // Original jobs should remain unchanged
    const failedJob = store.get("aq-30-0");
    const cancelledJob = store.get("aq-31-1");
    expect(failedJob?.status).toBe("failure");
    expect(cancelledJob?.status).toBe("cancelled");
  });

  // -------------------------------------------------------------------------
  // 8. failure job 있는 이슈는 pollProjectLabel에서 스킵됨 (cleanup 없음)
  // -------------------------------------------------------------------------
  it("does not trigger checkpoint or worktree cleanup from pollProjectLabel for failed jobs", async () => {
    // Start with a failed job
    const store = makeJobStore([{ issueNumber: 40, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    mockLoadCheckpoint.mockReturnValue(null);

    // Mock GitHub returning the issue again
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 40, title: "Simple failed job" },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // Issue should be SKIPPED - no re-pickup from pollProjectLabel
    expect(queue.enqueue).not.toHaveBeenCalledWith(40, "test/repo");

    // No cleanup triggered
    expect(mockLoadCheckpoint).not.toHaveBeenCalled();
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockRemoveCheckpoint).not.toHaveBeenCalled();

    // Original job should remain as failure
    const failedJob = store.get("aq-40-0");
    expect(failedJob?.status).toBe("failure");
  });

  // -------------------------------------------------------------------------
  // 9. failure job 있는 이슈는 worktree 유무와 관계없이 스킵됨
  // -------------------------------------------------------------------------
  it("skips failed job issue regardless of checkpoint state", async () => {
    // Start with a failed job
    const store = makeJobStore([{ issueNumber: 50, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    // Even if checkpoint exists, pollProjectLabel should not trigger cleanup
    mockLoadCheckpoint.mockReturnValue({
      jobId: "aq-50-0",
      issueNumber: 50,
      repo: "test/repo",
      state: "failed",
      branchName: "aq/50-no-worktree",
      projectRoot: "/tmp/project",
      phaseResults: [],
      mode: "auto",
      savedAt: new Date().toISOString(),
    });

    // Mock GitHub returning the issue again
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 50, title: "Failed job without worktree" },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // Issue should be SKIPPED - no re-pickup from pollProjectLabel
    expect(queue.enqueue).not.toHaveBeenCalledWith(50, "test/repo");

    // pollProjectLabel does not touch checkpoint/worktree
    expect(mockLoadCheckpoint).not.toHaveBeenCalled();
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockRemoveCheckpoint).not.toHaveBeenCalled();

    // Original job should remain as failure
    const failedJob = store.get("aq-50-0");
    expect(failedJob?.status).toBe("failure");
  });

  // -------------------------------------------------------------------------
  // 10. Update detection and callback invocation tests
  // -------------------------------------------------------------------------
  it("detects updates and calls onUpdateAvailable callback when autoUpdate is enabled", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = true;

    const mockCheckForUpdates = vi.fn().mockResolvedValue({
      hasUpdates: true,
      currentHash: "abc123def456",
      remoteHash: "def456ghi789",
      packageLockChanged: false,
    } as UpdateInfo);

    const mockSelfUpdaterInstance = { checkForUpdates: mockCheckForUpdates };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledWith({
      hasUpdates: true,
      currentHash: "abc123def456",
      remoteHash: "def456ghi789",
      packageLockChanged: false,
    });
  });

  it("does not call onUpdateAvailable callback when no updates are available", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = true;

    const mockCheckForUpdates = vi.fn().mockResolvedValue({
      hasUpdates: false,
      currentHash: "abc123def456",
      remoteHash: "abc123def456",
      packageLockChanged: false,
    } as UpdateInfo);

    const mockSelfUpdaterInstance = { checkForUpdates: mockCheckForUpdates };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("does not check for updates when autoUpdate is disabled", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = false;

    const mockCheckForUpdates = vi.fn();
    const mockSelfUpdaterInstance = { checkForUpdates: mockCheckForUpdates };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    expect(mockCheckForUpdates).not.toHaveBeenCalled();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("does not check for updates when onUpdateAvailable callback is not provided", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);

    const config = makeConfig();
    config.general.autoUpdate = true;

    const mockCheckForUpdates = vi.fn();
    const mockSelfUpdaterInstance = { checkForUpdates: mockCheckForUpdates };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(config, store as any, queue as any);
    await (poller as any).poll();

    expect(mockCheckForUpdates).not.toHaveBeenCalled();
  });

  it("continues polling gracefully when update check fails", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = true;

    const mockCheckForUpdates = vi.fn().mockRejectedValue(new Error("git fetch failed"));
    const mockSelfUpdaterInstance = { checkForUpdates: mockCheckForUpdates };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 100, title: "Test issue", labels: ["aq-task"] },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);

    await expect((poller as any).poll()).resolves.toBeUndefined();
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(100, "test/repo");
  });

  it("calls onUpdateAvailable callback with package-lock changes detected", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = true;

    const mockCheckForUpdates = vi.fn().mockResolvedValue({
      hasUpdates: true,
      currentHash: "old123hash456",
      remoteHash: "new456hash789",
      packageLockChanged: true,
    } as UpdateInfo);

    const mockSelfUpdaterInstance = { checkForUpdates: mockCheckForUpdates };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledWith({
      hasUpdates: true,
      currentHash: "old123hash456",
      remoteHash: "new456hash789",
      packageLockChanged: true,
    });
  });

  // -------------------------------------------------------------------------
  // 16. Failed job polling: detects failed jobs and re-enqueues them
  // -------------------------------------------------------------------------
  it("detects failed jobs during polling and re-enqueues them", async () => {
    const oldFailureTime = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const store = makeJobStore([
      { issueNumber: 60, repo: "test/repo", status: "failure" }
    ]);

    const failedJob = store.get("aq-60-0");
    if (failedJob) {
      failedJob.completedAt = oldFailureTime;
    }

    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    expect(queue.enqueue).toHaveBeenCalledWith(60, "test/repo", undefined, true);
  });

  // -------------------------------------------------------------------------
  // 17. Failed job polling: skips retry jobs that failed
  // -------------------------------------------------------------------------
  it("does not re-enqueue failed retry jobs", async () => {
    const oldFailureTime = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const store = makeJobStore([
      { issueNumber: 70, repo: "test/repo", status: "failure" }
    ]);

    const failedRetryJob = store.get("aq-70-0");
    if (failedRetryJob) {
      failedRetryJob.isRetry = true;
      failedRetryJob.completedAt = oldFailureTime;
    }

    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 18. Failed job polling: skips recently failed jobs
  // -------------------------------------------------------------------------
  it("does not re-enqueue recently failed jobs", async () => {
    const recentFailureTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const store = makeJobStore([
      { issueNumber: 80, repo: "test/repo", status: "failure" }
    ]);

    const failedJob = store.get("aq-80-0");
    if (failedJob) {
      failedJob.completedAt = recentFailureTime;
    }

    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 19. Failed job polling: handles multiple failed jobs
  // -------------------------------------------------------------------------
  it("handles multiple failed jobs during polling", async () => {
    const oldFailureTime = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const store = makeJobStore([
      { issueNumber: 90, repo: "test/repo", status: "failure" },
      { issueNumber: 91, repo: "test/repo", status: "failure" },
      { issueNumber: 92, repo: "test/repo", status: "failure" }
    ]);

    const jobs = ["aq-90-0", "aq-91-1", "aq-92-2"];
    jobs.forEach(jobId => {
      const job = store.get(jobId);
      if (job) {
        job.completedAt = oldFailureTime;
      }
    });

    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    expect(queue.enqueue).toHaveBeenCalledTimes(3);
    expect(queue.enqueue).toHaveBeenCalledWith(90, "test/repo", undefined, true);
    expect(queue.enqueue).toHaveBeenCalledWith(91, "test/repo", undefined, true);
    expect(queue.enqueue).toHaveBeenCalledWith(92, "test/repo", undefined, true);
  });

  // -------------------------------------------------------------------------
  // 20. Failed job polling: no failed jobs to process
  // -------------------------------------------------------------------------
  it("handles empty failed jobs list gracefully", async () => {
    const store = makeJobStore([
      { issueNumber: 100, repo: "test/repo", status: "success" },
      { issueNumber: 101, repo: "test/repo", status: "running" }
    ]);

    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({ stdout: makeGhIssueListResponse([]), stderr: "", exitCode: 0 });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
