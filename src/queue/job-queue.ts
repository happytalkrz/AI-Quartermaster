import { getLogger } from "../utils/logger.js";
import { errorMessage } from "../types/errors.js";
import { JobStore, Job } from "./job-store.js";
import { areDependenciesMet } from "./dependency-resolver.js";

const logger = getLogger();

export type JobHandler = (job: Job) => Promise<{ prUrl?: string; error?: string }>;

const STUCK_CHECK_INTERVAL_MS = 60 * 1000; // check every minute

export class JobQueue {
  private pending: string[] = [];  // job IDs
  private running: Set<string> = new Set();
  private store: JobStore;
  private concurrency: number;
  private handler: JobHandler;
  private cancelled: Set<string> = new Set();
  private stuckChecker: ReturnType<typeof setInterval> | undefined;
  private stuckTimeoutMs: number;
  private shuttingDown: boolean = false;
  private stuckAborted: Set<string> = new Set();

  constructor(store: JobStore, concurrency: number, handler: JobHandler, stuckTimeoutMs: number = 600000) {
    this.store = store;
    this.concurrency = concurrency;
    this.handler = handler;
    this.stuckTimeoutMs = stuckTimeoutMs;

    // Periodically check for stuck jobs
    this.stuckChecker = setInterval(() => this.checkStuckJobs(), STUCK_CHECK_INTERVAL_MS);
  }

  private checkStuckJobs(): void {
    const now = Date.now();
    for (const jobId of this.running) {
      const job = this.store.get(jobId);
      if (!job) continue;
      const lastUpdate = job.lastUpdatedAt ?? job.startedAt ?? job.createdAt;
      const elapsed = now - new Date(lastUpdate).getTime();
      if (elapsed > this.stuckTimeoutMs) {
        logger.error(`Job ${jobId} stuck for ${Math.round(elapsed / 60000)}min — marking as failed`);
        this.store.update(jobId, {
          status: "failure",
          completedAt: new Date().toISOString(),
          error: `작업이 ${Math.round(elapsed / 60000)}분간 응답 없어 자동 종료됨`,
        });
        this.stuckAborted.add(jobId);
        this.running.delete(jobId);
        this.processNext();
      }
    }
  }

  /**
   * Marks a job as stuck-aborted so executeJob can detect it after the handler returns.
   */
  abortJob(jobId: string): boolean {
    if (this.running.has(jobId)) {
      this.stuckAborted.add(jobId);
      return true;
    }
    return false;
  }

  /**
   * Stops accepting new jobs and waits for all running jobs to finish.
   * Resolves when running set is empty or timeoutMs elapses.
   */
  shutdown(timeoutMs: number = 30000): Promise<void> {
    this.shuttingDown = true;
    if (this.stuckChecker !== undefined) {
      clearInterval(this.stuckChecker);
      this.stuckChecker = undefined;
    }
    if (this.running.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (this.running.size === 0) {
          clearInterval(check);
          resolve();
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          clearInterval(check);
          logger.warn(`Shutdown timeout: ${this.running.size} job(s) still running after ${timeoutMs / 1000}s`);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Recovers jobs that were queued or running when the server stopped.
   * Running jobs are reset to queued and re-enqueued.
   */
  recover(): number {
    const jobs = this.store.list();
    let recovered = 0;

    for (const job of jobs) {
      if (job.status === "running") {
        // Was running when server died — reset to queued
        this.store.update(job.id, { status: "queued", startedAt: undefined });
        this.pending.push(job.id);
        recovered++;
        logger.info(`Job recovered (was running): ${job.id}`);
      } else if (job.status === "queued") {
        this.pending.push(job.id);
        recovered++;
        logger.info(`Job recovered (was queued): ${job.id}`);
      }
    }

    if (recovered > 0) {
      logger.info(`Recovered ${recovered} job(s) from previous session`);
      this.processNext();
    }

    return recovered;
  }

  /**
   * Enqueues a new job. Returns the job or undefined if duplicate.
   */
  enqueue(issueNumber: number, repo: string, dependencies?: number[]): Job | undefined {
    if (this.shuttingDown) {
      logger.warn(`Job for issue #${issueNumber} (${repo}) rejected — queue is shutting down`);
      return undefined;
    }

    // Check for duplicate
    const existing = this.store.findByIssue(issueNumber, repo);
    if (existing) {
      logger.warn(`Job for issue #${issueNumber} (${repo}) already exists: ${existing.id}`);
      return undefined;
    }

    const job = this.store.create(issueNumber, repo, dependencies);
    // Snapshot before processNext() may mutate cache entry
    const snapshot = { ...job };
    this.pending.push(job.id);
    logger.info(`Job enqueued: ${job.id} (pending: ${this.pending.length}, running: ${this.running.size})`);

    // Try to process next
    this.processNext();

    return snapshot;
  }

  /**
   * Cancels a job by ID.
   */
  cancel(jobId: string): boolean {
    // Remove from pending
    const pendingIdx = this.pending.indexOf(jobId);
    if (pendingIdx >= 0) {
      this.pending.splice(pendingIdx, 1);
      this.store.update(jobId, { status: "cancelled", completedAt: new Date().toISOString() });
      logger.info(`Job cancelled (was pending): ${jobId}`);
      return true;
    }

    // Mark running job for cancellation
    if (this.running.has(jobId)) {
      this.cancelled.add(jobId);
      this.store.update(jobId, { status: "cancelled", completedAt: new Date().toISOString() });
      logger.info(`Job cancelled (was running): ${jobId}`);
      return true;
    }

    return false;
  }

  /**
   * Returns queue status.
   */
  getStatus(): { pending: number; running: number; concurrency: number } {
    return {
      pending: this.pending.length,
      running: this.running.size,
      concurrency: this.concurrency,
    };
  }

  private async processNext(): Promise<void> {
    // Collect job IDs that are skipped due to unmet dependencies (put back at end)
    const deferred: string[] = [];

    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const jobId = this.pending.shift()!;

      if (this.cancelled.has(jobId)) {
        this.cancelled.delete(jobId);
        continue;
      }

      const job = this.store.get(jobId);
      if (!job) {
        continue;
      }

      // Check dependency readiness
      if (job.dependencies && job.dependencies.length > 0) {
        const { met, pending } = areDependenciesMet(job.dependencies, job.repo, this.store);
        if (!met) {
          logger.info(`Job ${jobId} waiting for dependencies: #${pending.join(", #")}`);
          deferred.push(jobId);
          continue;
        }
      }

      this.running.add(jobId);
      this.store.update(jobId, { status: "running", startedAt: new Date().toISOString() });

      logger.info(`Job started: ${jobId}`);

      // Run async - don't await, let it run in background
      this.executeJob(job).catch(err => {
        logger.error(`Job ${jobId} unexpected error: ${err}`);
      });
    }

    // Re-append deferred jobs so they are retried on the next processNext() call
    for (const jobId of deferred) {
      this.pending.push(jobId);
    }
  }

  private async executeJob(job: Job): Promise<void> {
    try {
      const result = await this.handler(job);

      if (this.stuckAborted.has(job.id)) {
        this.stuckAborted.delete(job.id);
        // Already marked failed by checkStuckJobs
      } else if (this.cancelled.has(job.id)) {
        this.cancelled.delete(job.id);
        // Already marked cancelled
      } else if (result.error) {
        this.store.update(job.id, {
          status: "failure",
          completedAt: new Date().toISOString(),
          error: result.error,
        });
      } else {
        this.store.update(job.id, {
          status: "success",
          completedAt: new Date().toISOString(),
          prUrl: result.prUrl,
        });
      }
    } catch (error) {
      this.store.update(job.id, {
        status: "failure",
        completedAt: new Date().toISOString(),
        error: errorMessage(error),
      });
    } finally {
      this.running.delete(job.id);
      // Process next in queue
      this.processNext();
    }
  }
}
