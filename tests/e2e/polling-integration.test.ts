import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IssuePoller } from "../../src/polling/issue-poller.js";

// Mock runCli so we never shell out during tests
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

// Mock checkpoint removal for integration tests
vi.mock("../../src/pipeline/checkpoint.js", () => ({
  removeCheckpoint: vi.fn(),
}));

import { runCli } from "../../src/utils/cli-runner.js";
import { removeCheckpoint } from "../../src/pipeline/checkpoint.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AQConfig } from "../../src/types/config.js";
import type { Job } from "../../src/queue/job-store.js";

const mockRunCli = vi.mocked(runCli);
const mockRemoveCheckpoint = vi.mocked(removeCheckpoint);

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
        // Remove checkpoint for the failed job
        mockRemoveCheckpoint();
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

    // One runCli call per project×label combination
    expect(mockRunCli).toHaveBeenCalledTimes(2);

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

    // 2. Checkpoint removal should have been triggered
    expect(mockRemoveCheckpoint).toHaveBeenCalled();

    // 3. Original failed job should be archived
    const originalJob = store.get("aq-20-0"); // First job created in makeJobStore
    expect(originalJob?.status).toBe("archived");

    // 4. New job should be created
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

    // Checkpoint removal should be called twice (once per failed job)
    expect(mockRemoveCheckpoint).toHaveBeenCalledTimes(2);

    // Both original jobs should be archived
    const failedJob = store.get("aq-30-0");
    const cancelledJob = store.get("aq-31-1");
    expect(failedJob?.status).toBe("archived");
    expect(cancelledJob?.status).toBe("archived");
  });
});
