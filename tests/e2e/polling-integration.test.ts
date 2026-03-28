import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IssuePoller } from "../../src/polling/issue-poller.js";

// Mock runCli so we never shell out during tests
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

import { runCli } from "../../src/utils/cli-runner.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AQConfig } from "../../src/types/config.js";
import type { Job } from "../../src/queue/job-store.js";

const mockRunCli = vi.mocked(runCli);

// ---------------------------------------------------------------------------
// Lightweight in-memory doubles for JobStore and JobQueue
// ---------------------------------------------------------------------------

function makeJobStore(existingJobs: Array<{ issueNumber: number; repo: string }> = []) {
  const jobs = existingJobs.map((j, i) => ({
    id: `aq-${j.issueNumber}-${i}`,
    issueNumber: j.issueNumber,
    repo: j.repo,
    status: "queued" as const,
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
  };
}

function makeJobQueue() {
  return {
    enqueue: vi.fn(),
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
    const queue = makeJobQueue();

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
  // 2. Duplicate issues are skipped (already in job store)
  // -------------------------------------------------------------------------
  it("skips issues that already exist in the job store", async () => {
    // Issue #10 is already queued
    const store = makeJobStore([{ issueNumber: 10, repo: "test/repo" }]);
    const queue = makeJobQueue();

    mockRunCli.mockResolvedValue({
      stdout: makeGhIssueListResponse([
        { number: 10, title: "Add feature A" }, // already exists
        { number: 12, title: "New issue C" },    // new
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
  // 3. Empty issue list produces no enqueues
  // -------------------------------------------------------------------------
  it("does nothing when gh returns an empty issue list", async () => {
    const store = makeJobStore();
    const queue = makeJobQueue();

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
    const queue = makeJobQueue();

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
    const queue = makeJobQueue();

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
});
