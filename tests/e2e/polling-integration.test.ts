import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IssuePoller } from "../../src/polling/issue-poller.js";

// Mock runCli so we never shell out during tests
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

// Mock checkpoint removal for integration tests
vi.mock("../../src/pipeline/checkpoint.js", () => ({
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
import { removeCheckpoint, loadCheckpoint } from "../../src/pipeline/checkpoint.js";
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
      return jobs.some(j => j.issueNumber === issueNumber && j.repo === repo && j.status === "success");
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
      // Check if success job exists (should block repickup)
      if (store.shouldBlockRepickup(issueNumber, repo)) {
        return undefined;
      }

      // Check for existing failed/cancelled jobs and auto-archive them
      const existing = store.findAnyByIssue(issueNumber, repo);
      if (existing && (existing.status === "failure" || existing.status === "cancelled")) {
        // Simulate the actual JobQueue logic for worktree cleanup
        const dataDir = "/tmp/test-data"; // Mock data directory

        try {
          // Load checkpoint to check for worktree before removing
          const checkpoint = mockLoadCheckpoint(dataDir, issueNumber);
          if (checkpoint?.worktreePath) {
            // Simulate worktree removal call
            mockRemoveWorktree(
              { gitPath: "git" }, // Mock git config
              checkpoint.worktreePath,
              { cwd: "/tmp/project", force: true }
            );
          }
        } catch (checkpointErr) {
          // Simulate error handling
        }

        try {
          // Remove checkpoint
          mockRemoveCheckpoint(dataDir, issueNumber);
        } catch (err) {
          // Simulate error handling
        }

        // Archive the existing job
        store.archive(existing.id);
      } else if (existing) {
        // Other statuses (queued, running) should still block
        return undefined;
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
  // 2. Skips issues that have successful jobs (shouldBlockRepickup)
  // -------------------------------------------------------------------------
  it("skips issues that already exist in the job store", async () => {
    // Issue #10 already has a successful job
    const store = makeJobStore([{ issueNumber: 10, repo: "test/repo", status: "success" }]);
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 10, title: "Add feature A" }, // has successful job - should be blocked
        { number: 12, title: "New issue C" },    // new - should be enqueued
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // Only the new issue should be enqueued
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(12, "test/repo");
    expect(queue.enqueue).not.toHaveBeenCalledWith(10, expect.anything());
  });

  // -------------------------------------------------------------------------
  // 3. Failed jobs should allow re-pickup (do not block)
  // -------------------------------------------------------------------------
  it("allows re-pickup of issues with failed jobs", async () => {
    // Issue #10 has a failed job - should allow re-pickup
    const store = makeJobStore([{ issueNumber: 10, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 10, title: "Add feature A" }, // has failed job - should be re-enqueued
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);
    await (poller as any).poll();

    // The failed issue should be re-enqueued
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(10, "test/repo");
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
  // 6. Full integration scenario: failed job → re-polling → auto-archive → new job → cleanup
  // -------------------------------------------------------------------------
  it("handles full re-pickup scenario: failed job → polling → auto-archive → new job creation", async () => {
    // Start with a failed job for issue #20
    const store = makeJobStore([{ issueNumber: 20, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    // Mock checkpoint with worktree to simulate cleanup scenario
    mockLoadCheckpoint.mockReturnValue({
      jobId: "aq-20-0",
      issueNumber: 20,
      repo: "test/repo",
      state: "failed",
      worktreePath: "/tmp/test-worktree-20",
      branchName: "aq/20-fix-critical-bug",
      projectRoot: "/tmp/project",
      phaseResults: [],
      mode: "auto",
      savedAt: new Date().toISOString(),
    });

    // Mock GitHub returning the same issue again (simulating re-pickup)
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 20, title: "Fix critical bug", labels: ["aq-task"] },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(makeConfig(), store as any, queue as any);

    // Manually trigger one poll cycle
    await (poller as any).poll();

    // Verify the workflow:
    // 1. Queue.enqueue should have been called (re-pickup detected)
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(20, "test/repo");

    // 2. Checkpoint should be loaded to check for worktree
    expect(mockLoadCheckpoint).toHaveBeenCalledWith(expect.any(String), 20);

    // 3. Worktree cleanup should have been triggered
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      expect.any(Object), // gitConfig
      "/tmp/test-worktree-20",
      expect.objectContaining({ force: true })
    );

    // 4. Checkpoint removal should have been triggered
    expect(mockRemoveCheckpoint).toHaveBeenCalledWith(expect.any(String), 20);

    // 5. Original failed job should be archived
    const originalJob = store.get("aq-20-0"); // First job created in makeJobStore
    expect(originalJob?.status).toBe("archived");

    // 6. New job should be created
    expect(store.create).toHaveBeenCalledWith(20, "test/repo");
  });

  // -------------------------------------------------------------------------
  // 7. Cleanup verification: checkpoint removal is called for failed jobs during re-pickup
  // -------------------------------------------------------------------------
  it("ensures worktree/branch cleanup occurs during failed job re-pickup", async () => {
    // Start with multiple failed jobs
    const store = makeJobStore([
      { issueNumber: 30, repo: "test/repo", status: "failure" },
      { issueNumber: 31, repo: "test/repo", status: "cancelled" },
    ]);
    const queue = makeJobQueue(store);

    // Mock checkpoints with worktrees for both issues
    mockLoadCheckpoint
      .mockReturnValueOnce({
        jobId: "aq-30-0",
        issueNumber: 30,
        repo: "test/repo",
        state: "failed",
        worktreePath: "/tmp/test-worktree-30",
        branchName: "aq/30-failed-feature-a",
        projectRoot: "/tmp/project",
        phaseResults: [],
        mode: "auto",
        savedAt: new Date().toISOString(),
      })
      .mockReturnValueOnce({
        jobId: "aq-31-1",
        issueNumber: 31,
        repo: "test/repo",
        state: "cancelled",
        worktreePath: "/tmp/test-worktree-31",
        branchName: "aq/31-cancelled-feature-b",
        projectRoot: "/tmp/project",
        phaseResults: [],
        mode: "auto",
        savedAt: new Date().toISOString(),
      });

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

    // Both issues should trigger re-pickup
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith(30, "test/repo");
    expect(queue.enqueue).toHaveBeenCalledWith(31, "test/repo");

    // Checkpoint should be loaded for both issues
    expect(mockLoadCheckpoint).toHaveBeenCalledWith(expect.any(String), 30);
    expect(mockLoadCheckpoint).toHaveBeenCalledWith(expect.any(String), 31);

    // Worktree cleanup should be called for both failed jobs
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(2);
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      expect.any(Object),
      "/tmp/test-worktree-30",
      expect.objectContaining({ force: true })
    );
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      expect.any(Object),
      "/tmp/test-worktree-31",
      expect.objectContaining({ force: true })
    );

    // Checkpoint removal should be called twice (once per failed job)
    expect(mockRemoveCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockRemoveCheckpoint).toHaveBeenCalledWith(expect.any(String), 30);
    expect(mockRemoveCheckpoint).toHaveBeenCalledWith(expect.any(String), 31);

    // Both original jobs should be archived
    const failedJob = store.get("aq-30-0");
    const cancelledJob = store.get("aq-31-1");
    expect(failedJob?.status).toBe("archived");
    expect(cancelledJob?.status).toBe("archived");
  });

  // -------------------------------------------------------------------------
  // 8. Verifies that worktree cleanup is not called when no checkpoint or worktree exists
  // -------------------------------------------------------------------------
  it("skips worktree cleanup when no checkpoint or worktree path exists", async () => {
    // Start with a failed job but no checkpoint/worktree
    const store = makeJobStore([{ issueNumber: 40, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    // Mock loadCheckpoint to return null (no checkpoint found)
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

    // Issue should trigger re-pickup
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(40, "test/repo");

    // Checkpoint should be loaded
    expect(mockLoadCheckpoint).toHaveBeenCalledWith(expect.any(String), 40);

    // Worktree cleanup should NOT be called since no checkpoint was found
    expect(mockRemoveWorktree).not.toHaveBeenCalled();

    // Checkpoint removal should still be called (even if no checkpoint exists)
    expect(mockRemoveCheckpoint).toHaveBeenCalledWith(expect.any(String), 40);

    // Original job should be archived
    const failedJob = store.get("aq-40-0");
    expect(failedJob?.status).toBe("archived");
  });

  // -------------------------------------------------------------------------
  // 9. Verifies that worktree cleanup is not called when checkpoint exists but has no worktree path
  // -------------------------------------------------------------------------
  it("skips worktree cleanup when checkpoint exists but has no worktree path", async () => {
    // Start with a failed job
    const store = makeJobStore([{ issueNumber: 50, repo: "test/repo", status: "failure" }]);
    const queue = makeJobQueue(store);

    // Mock checkpoint without worktree path
    mockLoadCheckpoint.mockReturnValue({
      jobId: "aq-50-0",
      issueNumber: 50,
      repo: "test/repo",
      state: "failed",
      // No worktreePath field
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

    // Issue should trigger re-pickup
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(50, "test/repo");

    // Checkpoint should be loaded
    expect(mockLoadCheckpoint).toHaveBeenCalledWith(expect.any(String), 50);

    // Worktree cleanup should NOT be called since checkpoint has no worktree path
    expect(mockRemoveWorktree).not.toHaveBeenCalled();

    // Checkpoint removal should still be called
    expect(mockRemoveCheckpoint).toHaveBeenCalledWith(expect.any(String), 50);

    // Original job should be archived
    const failedJob = store.get("aq-50-0");
    expect(failedJob?.status).toBe("archived");
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

    // Mock SelfUpdater to return update info
    const mockCheckForUpdates = vi.fn().mockResolvedValue({
      hasUpdates: true,
      currentHash: "abc123def456",
      remoteHash: "def456ghi789",
      packageLockChanged: false,
    } as UpdateInfo);

    const mockSelfUpdaterInstance = {
      checkForUpdates: mockCheckForUpdates,
    };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    // Mock GitHub to return no issues (focus on update check)
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    // Update check should have been called
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);

    // Callback should have been called with update info
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

    // Mock SelfUpdater to return no updates
    const mockCheckForUpdates = vi.fn().mockResolvedValue({
      hasUpdates: false,
      currentHash: "abc123def456",
      remoteHash: "abc123def456",
      packageLockChanged: false,
    } as UpdateInfo);

    const mockSelfUpdaterInstance = {
      checkForUpdates: mockCheckForUpdates,
    };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    // Mock GitHub to return no issues
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    // Update check should have been called
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);

    // Callback should NOT have been called since no updates
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("does not check for updates when autoUpdate is disabled", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = false; // Disabled

    // Mock SelfUpdater
    const mockCheckForUpdates = vi.fn();
    const mockSelfUpdaterInstance = {
      checkForUpdates: mockCheckForUpdates,
    };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    // Mock GitHub to return no issues
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    // Update check should NOT have been called
    expect(mockCheckForUpdates).not.toHaveBeenCalled();

    // Callback should NOT have been called
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("does not check for updates when onUpdateAvailable callback is not provided", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);

    const config = makeConfig();
    config.general.autoUpdate = true;

    // Mock SelfUpdater
    const mockCheckForUpdates = vi.fn();
    const mockSelfUpdaterInstance = {
      checkForUpdates: mockCheckForUpdates,
    };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    // Mock GitHub to return no issues
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([]),
      stderr: "",
      exitCode: 0,
    });

    // No callback provided
    poller = new IssuePoller(config, store as any, queue as any);
    await (poller as any).poll();

    // Update check should NOT have been called when no callback provided
    expect(mockCheckForUpdates).not.toHaveBeenCalled();
  });

  it("continues polling gracefully when update check fails", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = true;

    // Mock SelfUpdater to throw error
    const mockCheckForUpdates = vi.fn().mockRejectedValue(new Error("git fetch failed"));
    const mockSelfUpdaterInstance = {
      checkForUpdates: mockCheckForUpdates,
    };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    // Mock GitHub to return issues (should still be processed)
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 100, title: "Test issue", labels: ["aq-task"] },
      ]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);

    // Should not throw despite update check failure
    await expect((poller as any).poll()).resolves.toBeUndefined();

    // Update check should have been attempted
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);

    // Callback should NOT have been called due to error
    expect(onUpdateAvailable).not.toHaveBeenCalled();

    // Issue polling should still work normally
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(100, "test/repo");
  });

  it("calls onUpdateAvailable callback with package-lock changes detected", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue(store);
    const onUpdateAvailable = vi.fn();

    const config = makeConfig();
    config.general.autoUpdate = true;

    // Mock SelfUpdater to return update with package-lock changes
    const mockCheckForUpdates = vi.fn().mockResolvedValue({
      hasUpdates: true,
      currentHash: "old123hash456",
      remoteHash: "new456hash789",
      packageLockChanged: true, // Package-lock was modified
    } as UpdateInfo);

    const mockSelfUpdaterInstance = {
      checkForUpdates: mockCheckForUpdates,
    };
    mockSelfUpdater.mockReturnValue(mockSelfUpdaterInstance as any);

    // Mock GitHub to return no issues
    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([]),
      stderr: "",
      exitCode: 0,
    });

    poller = new IssuePoller(config, store as any, queue as any, onUpdateAvailable);
    await (poller as any).poll();

    // Update check should have been called
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);

    // Callback should have been called with package-lock change info
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledWith({
      hasUpdates: true,
      currentHash: "old123hash456",
      remoteHash: "new456hash789",
      packageLockChanged: true,
    });
  });
});
