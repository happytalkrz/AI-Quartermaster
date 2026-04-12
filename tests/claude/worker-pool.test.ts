import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { WorkerPool } from "../../src/claude/worker-pool.js";

describe("WorkerPool constructor", () => {
  it("should create pool with valid maxWorkers", () => {
    const pool = new WorkerPool(3, vi.fn());
    expect(pool.getStatus().maxWorkers).toBe(3);
  });

  it("should throw on zero maxWorkers", () => {
    expect(() => new WorkerPool(0, vi.fn())).toThrow("maxWorkers must be a positive integer");
  });

  it("should throw on negative maxWorkers", () => {
    expect(() => new WorkerPool(-1, vi.fn())).toThrow("maxWorkers must be a positive integer");
  });

  it("should throw on non-integer maxWorkers", () => {
    expect(() => new WorkerPool(1.5, vi.fn())).toThrow("maxWorkers must be a positive integer");
  });
});

describe("WorkerPool submit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute task immediately when worker is available", async () => {
    const handler = vi.fn().mockResolvedValue("result");
    const pool = new WorkerPool(2, handler);

    const result = await pool.submit("input");
    expect(result).toBe("result");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("input", expect.stringMatching(/^worker-\d+$/));
  });

  it("should reject immediately if pool is shutting down", async () => {
    const handler = vi.fn().mockResolvedValue("result");
    const pool = new WorkerPool(1, handler);
    await pool.shutdown();

    await expect(pool.submit("input")).rejects.toThrow("WorkerPool is shutting down");
  });

  it("should propagate task errors to caller", async () => {
    const error = new Error("task failed");
    const handler = vi.fn().mockRejectedValue(error);
    const pool = new WorkerPool(1, handler);

    await expect(pool.submit("input")).rejects.toThrow("task failed");
  });
});

describe("WorkerPool concurrency limit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not exceed maxWorkers concurrent tasks", async () => {
    let concurrency = 0;
    let maxConcurrency = 0;

    const handler = vi.fn().mockImplementation(async () => {
      concurrency++;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      concurrency--;
      return "done";
    });

    const pool = new WorkerPool(2, handler);
    await Promise.all([
      pool.submit("a"),
      pool.submit("b"),
      pool.submit("c"),
      pool.submit("d"),
    ]);

    expect(maxConcurrency).toBeLessThanOrEqual(2);
    expect(handler).toHaveBeenCalledTimes(4);
  }, 5000);

  it("should queue tasks when all workers are busy", async () => {
    const executionOrder: string[] = [];
    const resolvers: Array<() => void> = [];

    const handler = vi.fn().mockImplementation(async (input: string) => {
      await new Promise<void>((resolve) => resolvers.push(resolve));
      executionOrder.push(input);
      return input;
    });

    const pool = new WorkerPool(1, handler);

    const p1 = pool.submit("first");
    const p2 = pool.submit("second");

    // Wait a tick for processing to start
    await new Promise((resolve) => setImmediate(resolve));

    // Only one task should be running
    expect(pool.getStatus().busy).toBe(1);
    expect(pool.getStatus().pending).toBe(1);

    // Resolve first task
    resolvers[0]();
    await p1;

    // Wait for second task to start
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    resolvers[1]();
    await p2;

    expect(executionOrder).toEqual(["first", "second"]);
  }, 5000);

  it("should process all queued tasks after workers become idle", async () => {
    const handler = vi.fn().mockImplementation(async (n: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return n * 2;
    });

    const pool = new WorkerPool(2, handler);
    const results = await Promise.all([
      pool.submit(1),
      pool.submit(2),
      pool.submit(3),
      pool.submit(4),
      pool.submit(5),
    ]);

    expect(results).toEqual([2, 4, 6, 8, 10]);
  }, 5000);
});

describe("WorkerPool getStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return initial status with all zeros", () => {
    const pool = new WorkerPool(3, vi.fn());
    const status = pool.getStatus();
    expect(status).toEqual({ maxWorkers: 3, busy: 0, idle: 0, pending: 0 });
  });

  it("should reflect busy count during task execution", async () => {
    let resolveTask!: () => void;
    const handler = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveTask = () => resolve("done"); })
    );

    const pool = new WorkerPool(2, handler);
    const p = pool.submit("input");

    await new Promise((resolve) => setImmediate(resolve));
    expect(pool.getStatus().busy).toBe(1);

    resolveTask();
    await p;

    await new Promise((resolve) => setImmediate(resolve));
    expect(pool.getStatus().busy).toBe(0);
  });

  it("should reflect pending count when queue is non-empty", async () => {
    const resolvers: Array<() => void> = [];
    const handler = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolvers.push(() => resolve("done")); })
    );

    const pool = new WorkerPool(1, handler);
    const p1 = pool.submit("a");
    const p2 = pool.submit("b");

    await new Promise((resolve) => setImmediate(resolve));

    expect(pool.getStatus().busy).toBe(1);
    expect(pool.getStatus().pending).toBe(1);

    // Resolve first task
    resolvers[0]();
    await p1;

    // Let second task start
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(pool.getStatus().pending).toBe(0);
    expect(pool.getStatus().busy).toBe(1);

    resolvers[1]();
    await p2;
  }, 5000);
});

describe("WorkerPool getWorkers", () => {
  it("should return empty array before any task is submitted", () => {
    const pool = new WorkerPool(2, vi.fn());
    expect(pool.getWorkers()).toEqual([]);
  });

  it("should return created workers after task execution", async () => {
    const handler = vi.fn().mockResolvedValue("done");
    const pool = new WorkerPool(2, handler);

    await pool.submit("a");
    await pool.submit("b");
    // Wait for .finally() to run (sets worker status to idle)
    await new Promise((resolve) => setImmediate(resolve));

    const workers = pool.getWorkers();
    expect(workers.length).toBeGreaterThanOrEqual(1);
    for (const w of workers) {
      expect(w.id).toMatch(/^worker-\d+$/);
      expect(w.status).toBe("idle");
    }
  });

  it("should reuse idle workers instead of creating new ones", async () => {
    const handler = vi.fn().mockResolvedValue("done");
    const pool = new WorkerPool(2, handler);

    await pool.submit("a");
    await pool.submit("b");
    await pool.submit("c");

    // With maxWorkers=2 and sequential tasks, at most 2 workers should be created
    expect(pool.getWorkers().length).toBeLessThanOrEqual(2);
  });
});

describe("WorkerPool setMaxWorkers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should update maxWorkers and trigger pending tasks", async () => {
    let resolveFirst!: () => void;
    const calls: string[] = [];

    const handler = vi.fn().mockImplementation(async (input: string) => {
      if (input === "a") {
        await new Promise<void>((resolve) => { resolveFirst = resolve; });
      }
      calls.push(input);
      return input;
    });

    const pool = new WorkerPool(1, handler);
    const p1 = pool.submit("a");
    const p2 = pool.submit("b");

    await new Promise((resolve) => setImmediate(resolve));
    expect(pool.getStatus().pending).toBe(1);

    // Increase maxWorkers — second task should start immediately
    pool.setMaxWorkers(2);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(pool.getStatus().pending).toBe(0);

    resolveFirst();
    await Promise.all([p1, p2]);
    expect(calls).toContain("a");
    expect(calls).toContain("b");
  }, 5000);

  it("should throw on invalid value", () => {
    const pool = new WorkerPool(2, vi.fn());
    expect(() => pool.setMaxWorkers(0)).toThrow("maxWorkers must be a positive integer");
    expect(() => pool.setMaxWorkers(-3)).toThrow("maxWorkers must be a positive integer");
    expect(() => pool.setMaxWorkers(2.5)).toThrow("maxWorkers must be a positive integer");
  });
});

describe("WorkerPool shutdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should resolve immediately when no tasks are running", async () => {
    const pool = new WorkerPool(2, vi.fn());
    await expect(pool.shutdown()).resolves.toBeUndefined();
  });

  it("should reject queued tasks immediately on shutdown", async () => {
    let resolveFirst!: () => void;
    const handler = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveFirst = () => resolve("done"); })
    );

    const pool = new WorkerPool(1, handler);
    const p1 = pool.submit("blocked");
    const p2 = pool.submit("queued");

    await new Promise((resolve) => setImmediate(resolve));

    const shutdownPromise = pool.shutdown(500);
    await expect(p2).rejects.toThrow("WorkerPool is shutting down");

    resolveFirst();
    await p1;
    await shutdownPromise;
  }, 5000);

  it("should wait for running tasks to complete", async () => {
    let taskFinished = false;
    const handler = vi.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      taskFinished = true;
      return "done";
    });

    const pool = new WorkerPool(1, handler);
    const p = pool.submit("task");

    await new Promise((resolve) => setImmediate(resolve));
    await pool.shutdown(500);
    await p;

    expect(taskFinished).toBe(true);
  }, 5000);

  it("should resolve after timeout if tasks are still running", async () => {
    const handler = vi.fn().mockImplementation(
      () => new Promise<string>(() => { /* never resolves */ })
    );

    const pool = new WorkerPool(1, handler);
    pool.submit("infinite").catch(() => { /* ignore */ });

    await new Promise((resolve) => setImmediate(resolve));

    const start = Date.now();
    await pool.shutdown(100);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(500);
  }, 5000);

  it("should prevent new submissions after shutdown", async () => {
    const pool = new WorkerPool(1, vi.fn().mockResolvedValue("ok"));
    await pool.shutdown();

    await expect(pool.submit("new")).rejects.toThrow("WorkerPool is shutting down");
  });
});

describe("WorkerPool idle shrink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should remove idle worker after idleTimeoutMs", async () => {
    const handler = vi.fn().mockResolvedValue("done");
    const pool = new WorkerPool(2, handler, { idleTimeoutMs: 5000 });

    await pool.submit("input");
    // Flush .catch().finally() microtasks so worker status becomes idle
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getWorkers().length).toBe(1);
    expect(pool.getWorkers()[0].status).toBe("idle");

    await vi.advanceTimersByTimeAsync(5000);

    expect(pool.getWorkers().length).toBe(0);
  });

  it("should not shrink below minWorkers", async () => {
    const handler = vi.fn().mockResolvedValue("done");
    const pool = new WorkerPool(3, handler, { idleTimeoutMs: 1000, minWorkers: 1 });

    // Run 2 tasks concurrently to create 2 workers
    await Promise.all([pool.submit("a"), pool.submit("b")]);
    // Flush .finally() microtasks so both workers become idle with timers set
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getWorkers().length).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);

    expect(pool.getWorkers().length).toBe(1);
  });

  it("should cancel idle timer when worker becomes busy again", async () => {
    let resolveSecond!: () => void;
    const handler = vi.fn()
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveSecond = () => resolve("second"); })
      );
    const pool = new WorkerPool(1, handler, { idleTimeoutMs: 5000 });

    // First task completes → worker becomes idle, idle timer is set
    await pool.submit("first");
    // Flush .finally() microtasks so worker becomes idle with timer set
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getWorkers()[0].status).toBe("idle");
    expect(pool.getWorkers()[0].idleTimer).toBeDefined();

    // Second task submitted → processNext reuses idle worker, clears idle timer synchronously
    const p2 = pool.submit("second");

    expect(pool.getWorkers()[0].status).toBe("busy");
    expect(pool.getWorkers()[0].idleTimer).toBeUndefined();

    // Advance past original idle timeout — timer was cancelled, worker must NOT be shrunk
    await vi.advanceTimersByTimeAsync(5000);
    expect(pool.getWorkers().length).toBe(1);

    resolveSecond();
    await p2;
  });

  it("should clear idle timers on shutdown", async () => {
    const handler = vi.fn().mockResolvedValue("done");
    const pool = new WorkerPool(2, handler, { idleTimeoutMs: 5000 });

    await pool.submit("input");
    // Flush .finally() microtasks so worker becomes idle with timer set
    await vi.advanceTimersByTimeAsync(0);

    const worker = pool.getWorkers()[0];
    expect(worker.idleTimer).toBeDefined();

    await pool.shutdown();

    expect(pool.getWorkers()[0].idleTimer).toBeUndefined();

    // Advancing time should not shrink the worker (timer was cleared on shutdown)
    await vi.advanceTimersByTimeAsync(5000);
    expect(pool.getWorkers().length).toBe(1);
  });
});
