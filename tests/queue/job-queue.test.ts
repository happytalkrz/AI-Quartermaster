import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobQueue, JobHandler } from "../../src/queue/job-queue.js";
import { JobStore } from "../../src/queue/job-store.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock the checkpoint module
vi.mock("../../src/pipeline/checkpoint.js", () => ({
  removeCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(),
}));

// Mock the worktree manager module
vi.mock("../../src/git/worktree-manager.js", () => ({
  removeWorktree: vi.fn(),
}));

// Mock the branch manager module
vi.mock("../../src/git/branch-manager.js", () => ({
  deleteRemoteBranch: vi.fn(),
}));

// Mock the config loader module
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

describe("JobQueue", () => {
  let dataDir: string;
  let store: JobStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `aq-queue-test-${Date.now()}`);
    mkdirSync(dataDir, { recursive: true });
    store = new JobStore(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Helper to get and clear mocked functions
  async function getMocks() {
    const { removeCheckpoint, loadCheckpoint } = await import("../../src/pipeline/checkpoint.js");
    const { removeWorktree } = await import("../../src/git/worktree-manager.js");
    const { deleteRemoteBranch } = await import("../../src/git/branch-manager.js");
    const { loadConfig } = await import("../../src/config/loader.js");

    return {
      removeCheckpoint: vi.mocked(removeCheckpoint),
      loadCheckpoint: vi.mocked(loadCheckpoint),
      removeWorktree: vi.mocked(removeWorktree),
      deleteRemoteBranch: vi.mocked(deleteRemoteBranch),
      loadConfig: vi.mocked(loadConfig),
    };
  }

  it("should enqueue and execute a job", async () => {
    const handler: JobHandler = vi.fn().mockResolvedValue({ prUrl: "https://pr/1" });
    const queue = new JobQueue(store, 2, handler);

    const job = queue.enqueue(42, "test/repo");
    expect(job).toBeDefined();
    expect(job!.status).toBe("queued");

    // Wait for async execution
    await new Promise(r => setTimeout(r, 50));

    expect(handler).toHaveBeenCalled();
    const updated = store.get(job!.id);
    expect(updated?.status).toBe("success");
    expect(updated?.prUrl).toBe("https://pr/1");
  });

  it("should respect concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;

    const handler: JobHandler = vi.fn().mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 50));
      running--;
      return {};
    });

    const queue = new JobQueue(store, 2, handler);
    queue.enqueue(1, "test/repo");
    queue.enqueue(2, "test/repo2");
    queue.enqueue(3, "test/repo3");

    await new Promise(r => setTimeout(r, 500));

    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("should prevent duplicate jobs for same issue", () => {
    const handler: JobHandler = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const queue = new JobQueue(store, 2, handler);

    const job1 = queue.enqueue(42, "test/repo");
    const job2 = queue.enqueue(42, "test/repo");

    expect(job1).toBeDefined();
    expect(job2).toBeUndefined();
  });

  it("should auto-archive failed job and create new job on re-enqueue", async () => {
    const { removeCheckpoint } = await import("../../src/pipeline/checkpoint.js");
    const removeCheckpointSpy = vi.mocked(removeCheckpoint);

    const handler: JobHandler = vi.fn()
      .mockRejectedValueOnce(new Error("initial failure"))
      .mockResolvedValueOnce({ prUrl: "https://pr/new-success" });

    const queue = new JobQueue(store, 1, handler);

    // Create initial failed job
    const initialJob = queue.enqueue(123, "test/repo");
    await new Promise(r => setTimeout(r, 50));
    const failedJob = store.get(initialJob!.id);
    expect(failedJob?.status).toBe("failure");

    // Re-enqueue same issue - should auto-archive failed job and create new one
    const newJob = queue.enqueue(123, "test/repo");
    expect(newJob).toBeDefined();
    expect(newJob?.id).not.toBe(initialJob?.id);

    // Verify checkpoint was removed
    expect(removeCheckpointSpy).toHaveBeenCalledWith(
      expect.stringContaining("data"),
      123
    );

    // Verify original job was archived
    const archivedJob = store.get(initialJob!.id);
    expect(archivedJob?.status).toBe("archived");

    // Wait for new job to complete successfully
    await new Promise(r => setTimeout(r, 50));
    const completedNewJob = store.get(newJob!.id);
    expect(completedNewJob?.status).toBe("success");
    expect(completedNewJob?.prUrl).toBe("https://pr/new-success");
  });

  it("should auto-archive cancelled job and create new job on re-enqueue", async () => {
    const { removeCheckpoint } = await import("../../src/pipeline/checkpoint.js");
    const removeCheckpointSpy = vi.mocked(removeCheckpoint);

    const handler: JobHandler = vi.fn().mockResolvedValue({ prUrl: "https://pr/after-cancel" });
    const queue = new JobQueue(store, 1, handler);

    // Create and immediately cancel a job
    const initialJob = queue.enqueue(456, "test/repo");
    queue.cancel(initialJob!.id);
    const cancelledJob = store.get(initialJob!.id);
    expect(cancelledJob?.status).toBe("cancelled");

    // Re-enqueue same issue - should auto-archive cancelled job and create new one
    const newJob = queue.enqueue(456, "test/repo");
    expect(newJob).toBeDefined();
    expect(newJob?.id).not.toBe(initialJob?.id);

    // Verify checkpoint was removed
    expect(removeCheckpointSpy).toHaveBeenCalledWith(
      expect.stringContaining("data"),
      456
    );

    // Verify original job was archived
    const archivedJob = store.get(initialJob!.id);
    expect(archivedJob?.status).toBe("archived");

    // Wait for new job to complete
    await new Promise(r => setTimeout(r, 50));
    const completedNewJob = store.get(newJob!.id);
    expect(completedNewJob?.status).toBe("success");
  });

  it("should prevent re-enqueue when successful job exists", async () => {
    const handler: JobHandler = vi.fn().mockResolvedValue({ prUrl: "https://pr/success" });
    const queue = new JobQueue(store, 1, handler);

    // Create successful job
    const successJob = queue.enqueue(789, "test/repo");
    await new Promise(r => setTimeout(r, 50));
    const completed = store.get(successJob!.id);
    expect(completed?.status).toBe("success");

    // Try to re-enqueue same issue - should be blocked
    const blockedJob = queue.enqueue(789, "test/repo");
    expect(blockedJob).toBeUndefined();
  });

  it("should cancel a pending job", () => {
    const handler: JobHandler = vi.fn().mockImplementation(() => new Promise(() => {}));
    const queue = new JobQueue(store, 0, handler); // concurrency 0 so nothing runs

    // Manually add to test cancel
    const job = store.create(42, "test/repo");
    // We need a queue that doesn't auto-process
    queue.cancel(job.id);
    // Since concurrency is 0, the job is in pending... actually the enqueue adds to pending
    // Let's test via enqueue
    const queue2 = new JobQueue(store, 1, handler);
    const j = queue2.enqueue(99, "test/repo2");
    // cancel immediately
    const result = queue2.cancel(j!.id);
    expect(result).toBe(true);
    const updated = store.get(j!.id);
    expect(updated?.status).toBe("cancelled");
  });

  it("should track queue status", () => {
    const handler: JobHandler = vi.fn().mockImplementation(() => new Promise(() => {}));
    const queue = new JobQueue(store, 3, handler);

    const status = queue.getStatus();
    expect(status.concurrency).toBe(3);
    expect(status.pending).toBe(0);
    expect(status.running).toBe(0);
  });

  it("should handle job handler failure", async () => {
    const handler: JobHandler = vi.fn().mockRejectedValue(new Error("boom"));
    const queue = new JobQueue(store, 1, handler);

    const job = queue.enqueue(42, "test/repo");
    await new Promise(r => setTimeout(r, 50));

    const updated = store.get(job!.id);
    expect(updated?.status).toBe("failure");
    expect(updated?.error).toContain("boom");
  });

  describe("retryJob integration tests", () => {
    it("should delete checkpoint and restart pipeline on retry", async () => {
      // Mock checkpoint operations
      const { removeCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const removeCheckpointSpy = vi.mocked(removeCheckpoint);

      // Create a failed job first
      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("initial failure"))
        .mockResolvedValueOnce({ prUrl: "https://pr/retry-success" });

      const queue = new JobQueue(store, 1, handler);

      // Enqueue initial job that will fail
      const initialJob = queue.enqueue(123, "test/repo");
      expect(initialJob?.status).toBe("queued");

      // Wait for initial job to fail
      await new Promise(r => setTimeout(r, 50));
      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");
      expect(failedJob?.error).toContain("initial failure");

      // Retry the failed job
      const retryJob = queue.retryJob(initialJob!.id);
      expect(retryJob).toBeDefined();
      expect(retryJob?.isRetry).toBe(true);
      expect(retryJob?.issueNumber).toBe(123);
      expect(retryJob?.repo).toBe("test/repo");

      // Verify checkpoint was removed
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        123
      );

      // Verify original job was archived
      const archivedJob = store.get(initialJob!.id);
      expect(archivedJob?.status).toBe("archived");

      // Wait for retry job to complete
      await new Promise(r => setTimeout(r, 50));
      const completedRetryJob = store.get(retryJob!.id);
      expect(completedRetryJob?.status).toBe("success");
      expect(completedRetryJob?.prUrl).toBe("https://pr/retry-success");
    });

    it("should prevent retry of job that already has PR", async () => {
      // Create a failed job with PR URL
      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test error"));
      const queue = new JobQueue(store, 1, handler);

      const job = queue.enqueue(456, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      // Manually set PR URL to simulate job that failed after PR creation
      store.update(job!.id, { prUrl: "https://pr/existing" });

      // Try to retry - should fix status instead of retrying
      const retryResult = queue.retryJob(job!.id);
      expect(retryResult).toBeUndefined();

      // Verify job status was fixed to success
      const updatedJob = store.get(job!.id);
      expect(updatedJob?.status).toBe("success");
      expect(updatedJob?.error).toBeUndefined();
      expect(updatedJob?.prUrl).toBe("https://pr/existing");
    });

    it("should handle retry failure and remain in failed state", async () => {
      const { removeCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const removeCheckpointSpy = vi.mocked(removeCheckpoint);

      // Handler that always fails
      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockRejectedValueOnce(new Error("retry failure"));

      const queue = new JobQueue(store, 1, handler);

      // Create initial failed job
      const initialJob = queue.enqueue(789, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");

      // Retry the job
      const retryJob = queue.retryJob(initialJob!.id);
      expect(retryJob).toBeDefined();
      expect(retryJob?.isRetry).toBe(true);

      // Verify checkpoint removal was called
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        789
      );

      // Wait for retry job to fail again
      await new Promise(r => setTimeout(r, 50));
      const retryFailedJob = store.get(retryJob!.id);
      expect(retryFailedJob?.status).toBe("failure");
      expect(retryFailedJob?.error).toContain("retry failure");

      // Verify original job is still archived
      const archivedJob = store.get(initialJob!.id);
      expect(archivedJob?.status).toBe("archived");
    });

    it("should not retry jobs with logs indicating PR creation", async () => {
      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test error"));
      const queue = new JobQueue(store, 1, handler);

      const job = queue.enqueue(999, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      // Manually add PR-related logs to simulate job that created PR but failed later
      store.update(job!.id, {
        logs: [
          "Starting phase 1...",
          "PR: https://github.com/test/repo/pull/123",
          "Later failure occurred"
        ]
      });

      // Try to retry - should fix status instead of retrying
      const retryResult = queue.retryJob(job!.id);
      expect(retryResult).toBeUndefined();

      // Verify job status was fixed to success
      const updatedJob = store.get(job!.id);
      expect(updatedJob?.status).toBe("success");
      expect(updatedJob?.error).toBeUndefined();
    });
  });

  describe("Worktree cleanup on failure job re-enqueue", () => {
    let removeCheckpointSpy: any;
    let loadCheckpointSpy: any;
    let removeWorktreeSpy: any;
    let loadConfigSpy: any;

    beforeEach(async () => {
      const { removeCheckpoint, loadCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const { removeWorktree } = await import("../../src/git/worktree-manager.js");
      const { loadConfig } = await import("../../src/config/loader.js");

      removeCheckpointSpy = vi.mocked(removeCheckpoint);
      loadCheckpointSpy = vi.mocked(loadCheckpoint);
      removeWorktreeSpy = vi.mocked(removeWorktree);
      loadConfigSpy = vi.mocked(loadConfig);

      // Default mock implementations
      loadCheckpointSpy.mockReturnValue(null);
      loadConfigSpy.mockReturnValue({ git: { gitPath: "git" } });
      removeWorktreeSpy.mockResolvedValue(undefined);
    });

    it("should clean up worktree when re-enqueuing failed job with checkpoint worktreePath", async () => {
      const mockWorktreePath = "/test/worktree/path/issue-123-test-branch";
      loadCheckpointSpy.mockReturnValue({
        worktreePath: mockWorktreePath,
        issueNumber: 123,
        repo: "test/repo",
        branchName: "aq/123-test-branch"
      });

      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("pipeline failure"))
        .mockResolvedValueOnce({ prUrl: "https://pr/retry-success" });

      const queue = new JobQueue(store, 1, handler);

      // Create initial failed job
      const initialJob = queue.enqueue(123, "test/repo");
      await new Promise(r => setTimeout(r, 50));
      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");

      // Clear previous calls before re-enqueueing
      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      removeCheckpointSpy.mockClear();

      // Re-enqueue same issue - should trigger worktree cleanup
      const newJob = queue.enqueue(123, "test/repo");
      expect(newJob).toBeDefined();
      expect(newJob?.id).not.toBe(initialJob?.id);

      // Verify checkpoint loading was called
      expect(loadCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        123
      );

      // Verify worktree removal was called with correct path
      expect(removeWorktreeSpy).toHaveBeenCalledWith(
        expect.any(Object), // GitConfig
        mockWorktreePath,
        expect.objectContaining({
          cwd: expect.any(String),
          force: true
        })
      );

      // Verify checkpoint cleanup was called
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        123
      );

      // Verify original job was archived
      const archivedJob = store.get(initialJob!.id);
      expect(archivedJob?.status).toBe("archived");
    });

    it("should skip worktree cleanup when checkpoint has no worktreePath", async () => {
      loadCheckpointSpy.mockReturnValue({
        issueNumber: 456,
        repo: "test/repo",
        branchName: "aq/456-test-branch"
      });

      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("pipeline failure"))
        .mockResolvedValueOnce({ prUrl: "https://pr/retry-success" });

      const queue = new JobQueue(store, 1, handler);

      const initialJob = queue.enqueue(456, "test/repo");
      await new Promise(r => setTimeout(r, 50));
      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");

      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      removeCheckpointSpy.mockClear();

      // Re-enqueue same issue
      const newJob = queue.enqueue(456, "test/repo");
      expect(newJob).toBeDefined();

      // Verify checkpoint loading was called
      expect(loadCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        456
      );

      // Verify worktree removal was NOT called
      expect(removeWorktreeSpy).not.toHaveBeenCalled();

      // Verify checkpoint cleanup was still called
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        456
      );
    });

    it("should continue when worktree cleanup fails during re-enqueue", async () => {
      const mockWorktreePath = "/test/worktree/path/issue-789-test-branch";
      loadCheckpointSpy.mockReturnValue({
        worktreePath: mockWorktreePath,
        issueNumber: 789,
        repo: "test/repo",
        branchName: "aq/789-test-branch"
      });
      removeWorktreeSpy.mockRejectedValue(new Error("Failed to remove worktree"));

      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("pipeline failure"))
        .mockResolvedValueOnce({ prUrl: "https://pr/retry-success" });

      const queue = new JobQueue(store, 1, handler);

      // Create initial failed job
      const initialJob = queue.enqueue(789, "test/repo");
      await new Promise(r => setTimeout(r, 50));
      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");

      // Clear previous calls
      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      removeCheckpointSpy.mockClear();

      // Re-enqueue same issue - should continue despite worktree cleanup failure
      const newJob = queue.enqueue(789, "test/repo");
      expect(newJob).toBeDefined();
      expect(newJob?.id).not.toBe(initialJob?.id);

      // Verify worktree removal was attempted
      expect(removeWorktreeSpy).toHaveBeenCalledWith(
        expect.any(Object),
        mockWorktreePath,
        expect.objectContaining({ force: true })
      );

      // Verify checkpoint cleanup was still called despite worktree cleanup failure
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        789
      );

      // Verify original job was still archived
      const archivedJob = store.get(initialJob!.id);
      expect(archivedJob?.status).toBe("archived");

      // Wait for new job to complete successfully
      await new Promise(r => setTimeout(r, 50));
      const completedNewJob = store.get(newJob!.id);
      expect(completedNewJob?.status).toBe("success");
    });
  });

  describe("Phase 5: Full integration scenario tests", () => {
    it("should handle complete pipeline restart scenario: failed job → re-enqueue → cleanup → new execution", async () => {
      const { removeCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const removeCheckpointSpy = vi.mocked(removeCheckpoint);

      let executionCount = 0;
      const handler: JobHandler = vi.fn().mockImplementation(async () => {
        executionCount++;
        if (executionCount === 1) {
          throw new Error("Simulated pipeline failure");
        } else {
          return { prUrl: `https://pr/restart-success-${executionCount}` };
        }
      });

      const queue = new JobQueue(store, 1, handler);

      // Initial job that fails
      const initialJob = queue.enqueue(555, "test/repo");
      expect(initialJob?.status).toBe("queued");

      // Wait for initial failure
      await new Promise(r => setTimeout(r, 50));
      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");
      expect(failedJob?.error).toContain("Simulated pipeline failure");

      // Simulate re-enqueue (as would happen from polling)
      const newJob = queue.enqueue(555, "test/repo");
      expect(newJob).toBeDefined();
      expect(newJob?.id).not.toBe(initialJob?.id);

      // Verify checkpoint cleanup was triggered
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        555
      );

      // Verify failed job was archived
      const archivedJob = store.get(initialJob!.id);
      expect(archivedJob?.status).toBe("archived");

      // Wait for new job to complete successfully
      await new Promise(r => setTimeout(r, 50));
      const completedNewJob = store.get(newJob!.id);
      expect(completedNewJob?.status).toBe("success");
      expect(completedNewJob?.prUrl).toBe("https://pr/restart-success-2");
      expect(executionCount).toBe(2);
    });

    it("should prevent multiple simultaneous re-enqueues for same issue", async () => {
      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockResolvedValue({ prUrl: "https://pr/second-success" });

      const queue = new JobQueue(store, 1, handler);

      // Create failed job
      const failedJob = queue.enqueue(666, "test/repo");
      await new Promise(r => setTimeout(r, 50));
      expect(store.get(failedJob!.id)?.status).toBe("failure");

      // Try to enqueue multiple times simultaneously (simulating multiple polling hits)
      const results = await Promise.all([
        Promise.resolve(queue.enqueue(666, "test/repo")),
        Promise.resolve(queue.enqueue(666, "test/repo")),
        Promise.resolve(queue.enqueue(666, "test/repo")),
      ]);

      // Only one should succeed
      const successful = results.filter(r => r !== undefined);
      expect(successful).toHaveLength(1);

      // Original job should be archived
      expect(store.get(failedJob!.id)?.status).toBe("archived");

      // Wait for the successful job to complete
      await new Promise(r => setTimeout(r, 50));
      const newJob = store.get(successful[0]!.id);
      expect(newJob?.status).toBe("success");
    });

    it("should handle cascading dependency failures and cleanup", async () => {
      const { removeCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const removeCheckpointSpy = vi.mocked(removeCheckpoint);

      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("dependency failure"))
        .mockResolvedValue({ prUrl: "https://pr/dep-retry-success" });

      const queue = new JobQueue(store, 2, handler);

      // Enqueue dependency (issue 100) and dependent (issue 101)
      const depJob = queue.enqueue(100, "test/repo");
      const dependentJob = queue.enqueue(101, "test/repo", [100]); // depends on issue 100

      // Wait for dependency to fail
      await new Promise(r => setTimeout(r, 100));
      expect(store.get(depJob!.id)?.status).toBe("failure");

      // Wait a bit more for dependent to be processed
      await new Promise(r => setTimeout(r, 100));
      const dependentState = store.get(dependentJob!.id);
      expect(dependentState?.status).toBe("failure");
      expect(dependentState?.error).toContain("의존 이슈 #100");

      // Re-enqueue dependency (simulating re-polling)
      const newDepJob = queue.enqueue(100, "test/repo");
      expect(newDepJob).toBeDefined();

      // Verify cleanup occurred
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        100
      );

      // Original dependency job should be archived
      expect(store.get(depJob!.id)?.status).toBe("archived");

      // Wait for new dependency to succeed
      await new Promise(r => setTimeout(r, 50));
      const completedDepJob = store.get(newDepJob!.id);
      expect(completedDepJob?.status).toBe("success");

      // Now dependent can be re-enqueued successfully
      const newDependentJob = queue.enqueue(101, "test/repo", [100]);
      expect(newDependentJob).toBeDefined();

      await new Promise(r => setTimeout(r, 50));
      const completedDependentJob = store.get(newDependentJob!.id);
      expect(completedDependentJob?.status).toBe("success");
    });
  });

  describe("cleanupFailedJobArtifacts", () => {
    let removeCheckpointSpy: any;
    let loadCheckpointSpy: any;
    let removeWorktreeSpy: any;
    let deleteRemoteBranchSpy: any;
    let loadConfigSpy: any;

    beforeEach(async () => {
      const mocks = await getMocks();
      removeCheckpointSpy = mocks.removeCheckpoint;
      loadCheckpointSpy = mocks.loadCheckpoint;
      removeWorktreeSpy = mocks.removeWorktree;
      deleteRemoteBranchSpy = mocks.deleteRemoteBranch;
      loadConfigSpy = mocks.loadConfig;

      // Default mock implementations
      loadCheckpointSpy.mockReturnValue(null);
      loadConfigSpy.mockReturnValue({ git: { gitPath: "git", remoteAlias: "origin" } });
      removeWorktreeSpy.mockResolvedValue(undefined);
      deleteRemoteBranchSpy.mockResolvedValue(undefined);
    });

    it("should cleanup all artifacts when checkpoint exists with worktreePath and branchName", async () => {
      const mockCheckpoint = {
        worktreePath: "/test/worktree/path/issue-123-test-branch",
        branchName: "aq/123-test-branch",
        issueNumber: 123,
        repo: "test/repo"
      };
      loadCheckpointSpy.mockReturnValue(mockCheckpoint);

      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test failure"));
      const queue = new JobQueue(store, 1, handler);

      // Create and fail a job to trigger cleanup
      const job = queue.enqueue(123, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      // Clear previous calls and re-enqueue to trigger cleanup
      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      deleteRemoteBranchSpy.mockClear();
      removeCheckpointSpy.mockClear();

      // Restore mock return values after clear
      removeWorktreeSpy.mockResolvedValue(undefined);
      deleteRemoteBranchSpy.mockResolvedValue(undefined);

      // Re-enqueue should trigger cleanupFailedJobArtifacts
      queue.enqueue(123, "test/repo");

      // Verify all cleanup steps were called
      expect(loadCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        123
      );
      expect(removeWorktreeSpy).toHaveBeenCalledWith(
        expect.any(Object),
        mockCheckpoint.worktreePath,
        expect.objectContaining({ force: true })
      );
      expect(deleteRemoteBranchSpy).toHaveBeenCalledWith(
        expect.any(Object),
        mockCheckpoint.branchName,
        expect.objectContaining({ cwd: expect.any(String) })
      );
      expect(removeCheckpointSpy).toHaveBeenCalledWith(
        expect.stringContaining("data"),
        123
      );
    });

    it("should skip worktree cleanup when checkpoint has no worktreePath", async () => {
      const mockCheckpoint = {
        branchName: "aq/456-test-branch",
        issueNumber: 456,
        repo: "test/repo"
      };
      loadCheckpointSpy.mockReturnValue(mockCheckpoint);

      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test failure"));
      const queue = new JobQueue(store, 1, handler);

      const job = queue.enqueue(456, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      deleteRemoteBranchSpy.mockClear();
      removeCheckpointSpy.mockClear();

      removeWorktreeSpy.mockResolvedValue(undefined);
      deleteRemoteBranchSpy.mockResolvedValue(undefined);

      queue.enqueue(456, "test/repo");

      expect(removeWorktreeSpy).not.toHaveBeenCalled();
      expect(deleteRemoteBranchSpy).toHaveBeenCalled();
      expect(removeCheckpointSpy).toHaveBeenCalled();
    });

    it("should skip branch deletion when checkpoint has no branchName", async () => {
      const mockCheckpoint = {
        worktreePath: "/test/worktree/path/issue-789-test-branch",
        issueNumber: 789,
        repo: "test/repo"
      };
      loadCheckpointSpy.mockReturnValue(mockCheckpoint);

      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test failure"));
      const queue = new JobQueue(store, 1, handler);

      const job = queue.enqueue(789, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      deleteRemoteBranchSpy.mockClear();
      removeCheckpointSpy.mockClear();

      removeWorktreeSpy.mockResolvedValue(undefined);
      deleteRemoteBranchSpy.mockResolvedValue(undefined);

      queue.enqueue(789, "test/repo");

      expect(removeWorktreeSpy).toHaveBeenCalled();
      expect(deleteRemoteBranchSpy).not.toHaveBeenCalled();
      expect(removeCheckpointSpy).toHaveBeenCalled();
    });

    it("should continue cleanup when worktree removal fails", async () => {
      const mockCheckpoint = {
        worktreePath: "/test/worktree/path/issue-111-test-branch",
        branchName: "aq/111-test-branch",
        issueNumber: 111,
        repo: "test/repo"
      };
      loadCheckpointSpy.mockReturnValue(mockCheckpoint);
      removeWorktreeSpy.mockRejectedValue(new Error("Failed to remove worktree"));

      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test failure"));
      const queue = new JobQueue(store, 1, handler);

      const job = queue.enqueue(111, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      deleteRemoteBranchSpy.mockClear();
      removeCheckpointSpy.mockClear();

      removeWorktreeSpy.mockRejectedValue(new Error("Failed to remove worktree"));
      deleteRemoteBranchSpy.mockResolvedValue(undefined);

      queue.enqueue(111, "test/repo");

      // Should continue despite worktree removal failure
      expect(removeWorktreeSpy).toHaveBeenCalled();
      expect(deleteRemoteBranchSpy).toHaveBeenCalled();
      expect(removeCheckpointSpy).toHaveBeenCalled();
    });

    it("should continue cleanup when branch deletion fails", async () => {
      const mockCheckpoint = {
        worktreePath: "/test/worktree/path/issue-222-test-branch",
        branchName: "aq/222-test-branch",
        issueNumber: 222,
        repo: "test/repo"
      };
      loadCheckpointSpy.mockReturnValue(mockCheckpoint);
      deleteRemoteBranchSpy.mockRejectedValue(new Error("Failed to delete remote branch"));

      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test failure"));
      const queue = new JobQueue(store, 1, handler);

      const job = queue.enqueue(222, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      deleteRemoteBranchSpy.mockClear();
      removeCheckpointSpy.mockClear();

      removeWorktreeSpy.mockResolvedValue(undefined);
      deleteRemoteBranchSpy.mockRejectedValue(new Error("Failed to delete remote branch"));

      queue.enqueue(222, "test/repo");

      // Should continue despite branch deletion failure
      expect(removeWorktreeSpy).toHaveBeenCalled();
      expect(deleteRemoteBranchSpy).toHaveBeenCalled();
      expect(removeCheckpointSpy).toHaveBeenCalled();
    });

    it("should attempt checkpoint cleanup even when no checkpoint exists", async () => {
      loadCheckpointSpy.mockReturnValue(null);

      const handler: JobHandler = vi.fn().mockRejectedValue(new Error("test failure"));
      const queue = new JobQueue(store, 1, handler);

      const job = queue.enqueue(333, "test/repo");
      await new Promise(r => setTimeout(r, 50));

      loadCheckpointSpy.mockClear();
      removeWorktreeSpy.mockClear();
      deleteRemoteBranchSpy.mockClear();
      removeCheckpointSpy.mockClear();

      queue.enqueue(333, "test/repo");

      expect(loadCheckpointSpy).toHaveBeenCalled();
      expect(removeWorktreeSpy).not.toHaveBeenCalled();
      expect(deleteRemoteBranchSpy).not.toHaveBeenCalled();
      expect(removeCheckpointSpy).toHaveBeenCalled();
    });
  });

  describe("setConcurrency", () => {
    it("should update concurrency and trigger processing", async () => {
      let resolveCount = 0;
      const handler: JobHandler = vi.fn().mockImplementation(async () => {
        resolveCount++;
        await new Promise(r => setTimeout(r, 50));
        return {};
      });

      const queue = new JobQueue(store, 1, handler);

      // Enqueue 3 jobs with concurrency=1
      queue.enqueue(1, "test/repo");
      queue.enqueue(2, "test/repo2");
      queue.enqueue(3, "test/repo3");

      // Wait a bit, only 1 should be running
      await new Promise(r => setTimeout(r, 30));
      expect(queue.getStatus().running).toBe(1);
      expect(queue.getStatus().pending).toBe(2);

      // Increase concurrency to 3
      queue.setConcurrency(3);
      expect(queue.getStatus().concurrency).toBe(3);

      // Wait for all to start processing
      await new Promise(r => setTimeout(r, 30));
      expect(queue.getStatus().running).toBe(2); // remaining 2 should now be running
      expect(queue.getStatus().pending).toBe(0);

      // Wait for all to complete
      await new Promise(r => setTimeout(r, 100));
      expect(resolveCount).toBe(3);
    });

    it("should validate concurrency value", () => {
      const handler: JobHandler = vi.fn();
      const queue = new JobQueue(store, 1, handler);

      expect(() => queue.setConcurrency(0)).toThrow("Concurrency must be a positive integer");
      expect(() => queue.setConcurrency(-1)).toThrow("Concurrency must be a positive integer");
      expect(() => queue.setConcurrency(1.5)).toThrow("Concurrency must be a positive integer");

      // Should not throw for valid values
      expect(() => queue.setConcurrency(1)).not.toThrow();
      expect(() => queue.setConcurrency(5)).not.toThrow();
    });

    it("should reduce concurrency without affecting running jobs", async () => {
      let running = 0;
      let maxRunning = 0;
      const handler: JobHandler = vi.fn().mockImplementation(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(r => setTimeout(r, 100));
        running--;
        return {};
      });

      const queue = new JobQueue(store, 3, handler);

      // Enqueue 3 jobs
      queue.enqueue(1, "test/repo");
      queue.enqueue(2, "test/repo2");
      queue.enqueue(3, "test/repo3");

      // Wait for all to start
      await new Promise(r => setTimeout(r, 50));
      expect(queue.getStatus().running).toBe(3);

      // Reduce concurrency - running jobs should continue
      queue.setConcurrency(1);
      expect(queue.getStatus().concurrency).toBe(1);
      expect(queue.getStatus().running).toBe(3); // still 3 running

      // Wait for completion
      await new Promise(r => setTimeout(r, 150));
      expect(maxRunning).toBe(3); // max was still 3
    });
  });
});
