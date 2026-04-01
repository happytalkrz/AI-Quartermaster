import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobQueue, JobHandler } from "../../src/queue/job-queue.js";
import { JobStore } from "../../src/queue/job-store.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock the checkpoint module
vi.mock("../../src/pipeline/checkpoint.js", () => ({
  removeCheckpoint: vi.fn(),
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
});
