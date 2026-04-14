import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// vi.mock — must appear before any imports that depend on these modules
// ---------------------------------------------------------------------------

vi.mock("../../src/pipeline/errors/checkpoint.js", () => ({
  removeCheckpoint: vi.fn(),
  loadCheckpoint: vi.fn(),
}));

vi.mock("../../src/git/worktree-manager.js", () => ({
  removeWorktree: vi.fn(),
}));

vi.mock("../../src/git/branch-manager.js", () => ({
  deleteRemoteBranch: vi.fn(),
}));

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  resolveRetryBudget,
  retryBudgetExhaustedReason,
  DEFAULT_PHASE_MAX_RETRIES,
  DEFAULT_PLAN_MAX_RETRIES,
  DEFAULT_REVIEW_MAX_RETRIES,
  DEFAULT_VALIDATION_MAX_RETRIES,
  DEFAULT_CI_FIX_MAX_RETRIES,
} from "../../src/pipeline/execution/retry-config.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { AQDatabase } from "../../src/store/database.js";
import { JobQueue, type JobHandler } from "../../src/queue/job-queue.js";
import { JobStore } from "../../src/queue/job-store.js";
import { ConfigWatcher, type ConfigChangeEvent } from "../../src/config/config-watcher.js";
import { loadConfig } from "../../src/config/loader.js";

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Scenario 1: Retry Budget Exhaustion (#694)
// ---------------------------------------------------------------------------

describe("Integration: retry budget exhaustion", () => {
  describe("resolveRetryBudget — config-driven limits", () => {
    it("phase stage uses config.safety.maxRetries when set", () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.safety.maxRetries = 5;
      expect(resolveRetryBudget(config, "phase")).toBe(5);
    });

    it("phase stage falls back to DEFAULT_PHASE_MAX_RETRIES when config is undefined", () => {
      expect(resolveRetryBudget(undefined, "phase")).toBe(DEFAULT_PHASE_MAX_RETRIES);
    });

    it("plan stage always uses DEFAULT_PLAN_MAX_RETRIES regardless of config", () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.safety.maxRetries = 10;
      expect(resolveRetryBudget(config, "plan")).toBe(DEFAULT_PLAN_MAX_RETRIES);
    });

    it("review stage uses config.safety.maxRetries when set", () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.safety.maxRetries = 1;
      expect(resolveRetryBudget(config, "review")).toBe(1);
    });

    it("review stage falls back to DEFAULT_REVIEW_MAX_RETRIES when config is undefined", () => {
      expect(resolveRetryBudget(undefined, "review")).toBe(DEFAULT_REVIEW_MAX_RETRIES);
    });

    it("validation stage uses config.safety.maxRetries when set", () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.safety.maxRetries = 2;
      expect(resolveRetryBudget(config, "validation")).toBe(2);
    });

    it("validation stage falls back to DEFAULT_VALIDATION_MAX_RETRIES when config is undefined", () => {
      expect(resolveRetryBudget(undefined, "validation")).toBe(DEFAULT_VALIDATION_MAX_RETRIES);
    });

    it("ci-fix stage uses config.safety.maxRetries when set", () => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.safety.maxRetries = 4;
      expect(resolveRetryBudget(config, "ci-fix")).toBe(4);
    });

    it("ci-fix stage falls back to DEFAULT_CI_FIX_MAX_RETRIES when config is undefined", () => {
      expect(resolveRetryBudget(undefined, "ci-fix")).toBe(DEFAULT_CI_FIX_MAX_RETRIES);
    });
  });

  describe("retryBudgetExhaustedReason — error message format", () => {
    it("includes RETRY_BUDGET_EXHAUSTED marker", () => {
      const reason = retryBudgetExhaustedReason("phase", 3);
      expect(reason).toContain("[RETRY_BUDGET_EXHAUSTED]");
    });

    it("includes stage name in the message", () => {
      const reason = retryBudgetExhaustedReason("phase", 3);
      expect(reason).toContain("phase");
    });

    it("includes attempt count in the message", () => {
      const reason = retryBudgetExhaustedReason("validation", 2);
      expect(reason).toContain("2");
    });

    it("message mentions API token exhaustion prevention", () => {
      const reason = retryBudgetExhaustedReason("ci-fix", 3);
      expect(reason).toContain("API token");
    });

    it("maxRetries=0 produces a valid exhausted message", () => {
      const reason = retryBudgetExhaustedReason("plan", 0);
      expect(reason).toContain("[RETRY_BUDGET_EXHAUSTED]");
      expect(reason).toContain("0");
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: SQLite3 Preflight (#690)
// ---------------------------------------------------------------------------

describe("Integration: sqlite3 preflight", () => {
  let tempDir: string;
  let db: AQDatabase | undefined;

  beforeEach(() => {
    tempDir = makeTempDir("aq-db-preflight");
  });

  afterEach(() => {
    try {
      db?.close();
    } catch {
      // ignore
    }
    removeTempDir(tempDir);
  });

  it("initializes successfully with a valid temp directory", () => {
    const dbPath = join(tempDir, "test.db");
    db = new AQDatabase(dbPath);
    expect(db).toBeInstanceOf(AQDatabase);
  });

  it("creates schema and accepts job creation after init", () => {
    const dbPath = join(tempDir, "test.db");
    db = new AQDatabase(dbPath);

    const now = new Date().toISOString();
    db.createJob({
      id: "job-001",
      issueNumber: 42,
      repo: "test/repo",
      status: "queued",
      createdAt: now,
    });

    const found = db.getJob("job-001");
    expect(found).toBeDefined();
    expect(found!.issueNumber).toBe(42);
    expect(found!.repo).toBe("test/repo");
    expect(found!.status).toBe("queued");
  });

  it("returns undefined for a non-existent job", () => {
    const dbPath = join(tempDir, "test.db");
    db = new AQDatabase(dbPath);
    expect(db.getJob("does-not-exist")).toBeUndefined();
  });

  it("supports job status updates after creation", () => {
    const dbPath = join(tempDir, "test.db");
    db = new AQDatabase(dbPath);

    const now = new Date().toISOString();
    db.createJob({
      id: "job-002",
      issueNumber: 10,
      repo: "org/proj",
      status: "queued",
      createdAt: now,
    });

    db.updateJob("job-002", {
      status: "running",
      startedAt: now,
    });

    const updated = db.getJob("job-002");
    expect(updated!.status).toBe("running");
  });

  it("throws when DB directory cannot be created (permission-denied path)", () => {
    // Use a path under a non-existent root to force mkdirSync failure on read-only FS.
    // On Linux, /proc is read-only so subdirectory creation will fail.
    const badPath = "/proc/aq-nonexistent-dir/test.db";
    expect(() => new AQDatabase(badPath)).toThrow();
  });

  it("countJobs returns 0 on a freshly initialized database", () => {
    const dbPath = join(tempDir, "empty.db");
    db = new AQDatabase(dbPath);
    expect(db.countJobs()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Graceful Shutdown (#696)
// ---------------------------------------------------------------------------

describe("Integration: graceful shutdown", () => {
  let tempDir: string;
  let store: JobStore;
  let queue: JobQueue | undefined;

  beforeEach(() => {
    tempDir = makeTempDir("aq-shutdown");
    store = new JobStore(tempDir);
  });

  afterEach(async () => {
    if (queue) {
      await queue.shutdown(500).catch(() => undefined);
      queue = undefined;
    }
    try {
      store.close();
    } catch {
      // ignore
    }
    removeTempDir(tempDir);
    vi.clearAllMocks();
  });

  it("shutdown resolves immediately when no jobs are running", async () => {
    const handler: JobHandler = vi.fn().mockResolvedValue({ prUrl: "https://pr/1" });
    queue = new JobQueue(store, 2, handler);

    const start = Date.now();
    await queue.shutdown(5000);
    const elapsed = Date.now() - start;

    // Should resolve well under the timeout
    expect(elapsed).toBeLessThan(500);
  });

  it("shuttingDown flag prevents new jobs from being processed after shutdown starts", async () => {
    let resolveHandler!: () => void;
    const handlerStarted = new Promise<void>((res) => {
      resolveHandler = res;
    });
    const handlerFinish = new Promise<void>((res) => {
      resolveHandler = res;
    });

    let handlerCallCount = 0;
    const handler: JobHandler = vi.fn().mockImplementation(async () => {
      handlerCallCount++;
      // Block until test releases
      await handlerFinish;
      return { prUrl: "https://pr/1" };
    });

    queue = new JobQueue(store, 1, handler);

    // Enqueue one job (it starts running)
    queue.enqueue(1, "test/repo");
    await new Promise(r => setTimeout(r, 30));

    // Start shutdown — should set shuttingDown = true
    const shutdownPromise = queue.shutdown(1000);

    // Enqueuing after shutdown should still return a job object (queue accepts it in store)
    // but the internal shuttingDown flag should be true
    const laterJob = queue.enqueue(2, "test/repo");

    // Allow handler to complete
    resolveHandler();
    await shutdownPromise;

    // Either null (queue refused) or still queued but not processed beyond what was already running
    // The important invariant: no more than 1 concurrent handler was called
    expect(handlerCallCount).toBeLessThanOrEqual(1);
    void laterJob; // suppress unused warning
  });

  it("shutdown resolves after running jobs complete within timeout", async () => {
    let releaseJob!: () => void;
    const jobDone = new Promise<void>((res) => { releaseJob = res; });

    const handler: JobHandler = vi.fn().mockImplementation(async () => {
      await jobDone;
      return { prUrl: "https://pr/done" };
    });

    queue = new JobQueue(store, 2, handler);
    queue.enqueue(100, "test/repo");

    // Give the handler a moment to start
    await new Promise(r => setTimeout(r, 30));

    const shutdownPromise = queue.shutdown(3000);

    // Release the job slightly after shutdown started
    setTimeout(() => releaseJob(), 50);

    await shutdownPromise;
    // If we get here without throwing, shutdown resolved correctly
    expect(true).toBe(true);
  });

  it("shutdown resolves after timeout even if jobs are still running", async () => {
    // Handler that never finishes (simulates stuck job)
    const handler: JobHandler = vi.fn().mockImplementation(
      () => new Promise<{ prUrl: string }>(() => { /* never resolves */ })
    );

    queue = new JobQueue(store, 1, handler);
    queue.enqueue(200, "test/repo");

    await new Promise(r => setTimeout(r, 30));

    const start = Date.now();
    // Very short timeout to force the timeout path
    await queue.shutdown(200);
    const elapsed = Date.now() - start;

    // Should have waited ~200ms (the timeout), not longer than 1s
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Config Hot Reload (#695)
// ---------------------------------------------------------------------------

describe("Integration: config hot reload", () => {
  let tempDir: string;
  let configPath: string;
  let watcher: ConfigWatcher | undefined;
  const mockLoadConfig = vi.mocked(loadConfig);

  beforeEach(() => {
    tempDir = makeTempDir("aq-config-reload");
    configPath = join(tempDir, "config.yml");

    // Write a minimal config.yml so fs.watch can watch it
    writeFileSync(configPath, "general:\n  projectName: test\n");

    // Default mock: return DEFAULT_CONFIG
    mockLoadConfig.mockReturnValue(structuredClone(DEFAULT_CONFIG));
  });

  afterEach(() => {
    watcher?.stopWatching();
    watcher = undefined;
    removeTempDir(tempDir);
    vi.clearAllMocks();
  });

  it("current() returns config loaded via loadConfig", () => {
    watcher = new ConfigWatcher(tempDir);
    const config = watcher.current();
    expect(config).toBeDefined();
    expect(mockLoadConfig).toHaveBeenCalledWith(tempDir);
  });

  it("current() caches the config and does not call loadConfig twice", () => {
    watcher = new ConfigWatcher(tempDir);
    watcher.current();
    watcher.current();
    expect(mockLoadConfig).toHaveBeenCalledTimes(1);
  });

  it("refresh() forces a reload via loadConfig", () => {
    watcher = new ConfigWatcher(tempDir);
    watcher.current(); // primes cache (1 call)
    watcher.refresh(); // forces reload (2nd call)
    expect(mockLoadConfig).toHaveBeenCalledTimes(2);
  });

  it("stopWatching() can be called multiple times without throwing", () => {
    watcher = new ConfigWatcher(tempDir);
    watcher.startWatching();
    expect(() => {
      watcher!.stopWatching();
      watcher!.stopWatching();
    }).not.toThrow();
  });

  it("startWatching() loads initial config into cache", () => {
    watcher = new ConfigWatcher(tempDir);
    watcher.startWatching();
    // loadConfig is called during startWatching for the initial cache
    expect(mockLoadConfig).toHaveBeenCalled();
    watcher.stopWatching();
  });

  it("emits configChanged event when base config file changes", async () => {
    watcher = new ConfigWatcher(tempDir);
    watcher.startWatching();

    const changeEvent = new Promise<ConfigChangeEvent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("configChanged not emitted")), 2000);
      watcher!.once("configChanged", (event: ConfigChangeEvent) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });

    // Trigger a file change
    await new Promise(r => setTimeout(r, 50));
    writeFileSync(configPath, "general:\n  projectName: updated\n");

    const event = await changeEvent;
    expect(event.type).toBe("base");
    expect(event.paths).toContain(configPath);

    watcher.stopWatching();
  });

  it("configChanged event triggers a loadConfig call (cache refresh)", async () => {
    watcher = new ConfigWatcher(tempDir);
    watcher.startWatching();

    const callCountBefore = mockLoadConfig.mock.calls.length;

    const changeEvent = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("configChanged not emitted")), 2000);
      watcher!.once("configChanged", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await new Promise(r => setTimeout(r, 50));
    writeFileSync(configPath, "general:\n  projectName: reload-test\n");

    await changeEvent;

    // loadConfig must have been called again after the change event
    expect(mockLoadConfig.mock.calls.length).toBeGreaterThan(callCountBefore);

    watcher.stopWatching();
  });
});
