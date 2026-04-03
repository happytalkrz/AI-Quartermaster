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
    it("should clean up worktree when re-enqueuing failed job with checkpoint worktreePath", async () => {
      const { removeCheckpoint, loadCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const { removeWorktree } = await import("../../src/git/worktree-manager.js");
      const { loadConfig } = await import("../../src/config/loader.js");

      const removeCheckpointSpy = vi.mocked(removeCheckpoint);
      const loadCheckpointSpy = vi.mocked(loadCheckpoint);
      const removeWorktreeSpy = vi.mocked(removeWorktree);
      const loadConfigSpy = vi.mocked(loadConfig);

      // Mock loadCheckpoint to return checkpoint with worktreePath
      const mockWorktreePath = "/test/worktree/path/issue-123-test-branch";
      loadCheckpointSpy.mockReturnValue({
        worktreePath: mockWorktreePath,
        issueNumber: 123,
        repo: "test/repo",
        branchName: "aq/123-test-branch"
      });

      // Mock loadConfig to return valid GitConfig
      loadConfigSpy.mockReturnValue({
        git: { gitPath: "git" }
      });

      // Mock removeWorktree to resolve successfully
      removeWorktreeSpy.mockResolvedValue();

      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("pipeline failure"))
        .mockResolvedValueOnce({ prUrl: "https://pr/retry-success" });

      const queue = new JobQueue(store, 1, handler);

      // Create initial failed job
      const initialJob = queue.enqueue(123, "test/repo");
      await new Promise(r => setTimeout(r, 50));
      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");

      // Clear previous calls
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
      const { removeCheckpoint, loadCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const { removeWorktree } = await import("../../src/git/worktree-manager.js");
      const { loadConfig } = await import("../../src/config/loader.js");

      const removeCheckpointSpy = vi.mocked(removeCheckpoint);
      const loadCheckpointSpy = vi.mocked(loadCheckpoint);
      const removeWorktreeSpy = vi.mocked(removeWorktree);
      const loadConfigSpy = vi.mocked(loadConfig);

      // Mock loadCheckpoint to return checkpoint without worktreePath
      loadCheckpointSpy.mockReturnValue({
        issueNumber: 456,
        repo: "test/repo",
        branchName: "aq/456-test-branch"
        // no worktreePath
      });

      const handler: JobHandler = vi.fn()
        .mockRejectedValueOnce(new Error("pipeline failure"))
        .mockResolvedValueOnce({ prUrl: "https://pr/retry-success" });

      const queue = new JobQueue(store, 1, handler);

      // Create initial failed job
      const initialJob = queue.enqueue(456, "test/repo");
      await new Promise(r => setTimeout(r, 50));
      const failedJob = store.get(initialJob!.id);
      expect(failedJob?.status).toBe("failure");

      // Clear previous calls
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
      const { removeCheckpoint, loadCheckpoint } = await import("../../src/pipeline/checkpoint.js");
      const { removeWorktree } = await import("../../src/git/worktree-manager.js");

      const removeCheckpointSpy = vi.mocked(removeCheckpoint);
      const loadCheckpointSpy = vi.mocked(loadCheckpoint);
      const removeWorktreeSpy = vi.mocked(removeWorktree);

      // Mock loadCheckpoint to return checkpoint with worktreePath
      const mockWorktreePath = "/test/worktree/path/issue-789-test-branch";
      loadCheckpointSpy.mockReturnValue({
        worktreePath: mockWorktreePath,
        issueNumber: 789,
        repo: "test/repo",
        branchName: "aq/789-test-branch"
      });

      // Mock removeWorktree to fail
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
});
