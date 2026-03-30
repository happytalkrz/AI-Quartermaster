import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobQueue, JobHandler } from "../../src/queue/job-queue.js";
import { JobStore, Job } from "../../src/queue/job-store.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
    const cancelled = queue.cancel(job.id);
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
});
