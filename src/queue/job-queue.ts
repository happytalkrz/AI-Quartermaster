import { resolve } from "path";
import { getLogger } from "../utils/logger.js";
import { errorMessage } from "../types/errors.js";
import { JobStore, Job } from "./job-store.js";
import { areDependenciesMet } from "./dependency-resolver.js";
import { removeCheckpoint, loadCheckpoint } from "../pipeline/checkpoint.js";
import { isClaudeProcessAlive, getLastActivityMs } from "../claude/claude-runner.js";
import { removeWorktree } from "../git/worktree-manager.js";
import { deleteRemoteBranch } from "../git/branch-manager.js";
import { loadConfig } from "../config/loader.js";

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
  private isProcessing: boolean = false;
  private needsReprocess: boolean = false;

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
        const processAlive = isClaudeProcessAlive();
        const lastActivityMs = getLastActivityMs();
        const ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000; // 5분 무활동 시 stuck 판정

        if (processAlive && lastActivityMs >= 0 && lastActivityMs < ACTIVITY_THRESHOLD_MS) {
          // Claude process alive + recent stream activity — still working, extend
          logger.info(`Job ${jobId}: ${Math.round(elapsed / 60000)}분 경과, Claude 활동 중 (${Math.round(lastActivityMs / 1000)}초 전) — 대기 연장`);
          this.store.update(jobId, { lastUpdatedAt: new Date().toISOString() });
        } else if (!processAlive && elapsed < this.stuckTimeoutMs * 2) {
          // No Claude process but within 2x timeout — pipeline may be in non-Claude stage (validation, push, PR)
          // Check if job store was recently updated (log/step changes)
          logger.debug(`Job ${jobId}: Claude 프로세스 없음, 파이프라인 단계 진행 중일 수 있음 — 대기 연장`);
          this.store.update(jobId, { lastUpdatedAt: new Date().toISOString() });
        } else if (processAlive && (lastActivityMs < 0 || lastActivityMs >= ACTIVITY_THRESHOLD_MS)) {
          // Process alive but no recent activity — Claude stuck
          logger.error(`Job ${jobId}: ${Math.round(elapsed / 60000)}분 경과, Claude 무응답 ${Math.round((lastActivityMs >= 0 ? lastActivityMs : elapsed) / 60000)}분 — 실패 처리`);
          this.store.update(jobId, {
            status: "failure",
            completedAt: new Date().toISOString(),
            error: `Claude가 ${Math.round((lastActivityMs >= 0 ? lastActivityMs : elapsed) / 60000)}분간 무응답 (프로세스는 살아있으나 활동 없음)`,
          });
          this.stuckAborted.add(jobId);
          this.running.delete(jobId);
          setTimeout(() => this.processNext(), 0);
        } else {
          // No process, exceeded 2x timeout — genuinely stuck
          logger.error(`Job ${jobId}: ${Math.round(elapsed / 60000)}분 경과, 프로세스 없음 — 실패 처리`);
          this.store.update(jobId, {
            status: "failure",
            completedAt: new Date().toISOString(),
            error: `파이프라인이 ${Math.round(elapsed / 60000)}분간 응답 없음`,
          });
          this.stuckAborted.add(jobId);
          this.running.delete(jobId);
          setTimeout(() => this.processNext(), 0);
        }
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
   * Cleanup failed job artifacts including worktree, remote branch, and checkpoint.
   * Each step is attempted independently and failures are logged but don't stop the process.
   */
  private cleanupFailedJobArtifacts(issueNumber: number): void {
    const dataDir = resolve(process.cwd(), "data");
    const projectRoot = process.cwd();

    let checkpoint = null;
    try {
      checkpoint = loadCheckpoint(dataDir, issueNumber);
    } catch (checkpointErr) {
      logger.warn(`Failed to load checkpoint for cleanup of issue #${issueNumber}: ${checkpointErr}`);
    }

    if (checkpoint) {
      const config = loadConfig(projectRoot);

      // Step 1: Remove worktree if exists
      if (checkpoint.worktreePath) {
        logger.info(`Cleaning up worktree: ${checkpoint.worktreePath}`);
        Promise.resolve(removeWorktree(config.git, checkpoint.worktreePath, { cwd: projectRoot, force: true }))
          .catch(worktreeErr => {
            logger.warn(`Failed to remove worktree ${checkpoint.worktreePath}: ${worktreeErr}`);
          });
      }

      // Step 2: Delete remote branch if exists
      if (checkpoint.branchName) {
        logger.info(`Deleting remote branch: ${checkpoint.branchName}`);
        Promise.resolve(deleteRemoteBranch(config.git, checkpoint.branchName, { cwd: projectRoot }))
          .catch(branchErr => {
            logger.warn(`Failed to delete remote branch ${checkpoint.branchName}: ${branchErr}`);
          });
      }
    }

    // Step 3: Always attempt to remove checkpoint regardless of whether we could load it
    try {
      logger.info(`Removing checkpoint for issue #${issueNumber}`);
      removeCheckpoint(dataDir, issueNumber);
    } catch (err) {
      logger.warn(`Failed to remove checkpoint for issue #${issueNumber}: ${err}`);
    }
  }

  /**
   * Enqueues a new job. Returns the job or undefined if duplicate.
   */
  enqueue(issueNumber: number, repo: string, dependencies?: number[], isRetry?: boolean): Job | undefined {
    if (this.shuttingDown) {
      logger.warn(`Job for issue #${issueNumber} (${repo}) rejected — queue is shutting down`);
      return undefined;
    }

    // Check for existing job
    const existing = this.store.findAnyByIssue(issueNumber, repo);
    if (existing) {
      if (existing.status === "success") {
        logger.warn(`Job for issue #${issueNumber} (${repo}) already completed successfully: ${existing.id}`);
        return undefined;
      }

      if (existing.status === "failure" || existing.status === "cancelled") {
        logger.info(`Auto-archiving existing ${existing.status} job ${existing.id} for issue #${issueNumber} (${repo})`);
        this.cleanupFailedJobArtifacts(issueNumber);
        this.store.archive(existing.id);
      } else {
        // queued/running statuses should still block
        logger.warn(`Job for issue #${issueNumber} (${repo}) already exists: ${existing.id} (status: ${existing.status})`);
        return undefined;
      }
    }

    const job = this.store.create(issueNumber, repo, dependencies, isRetry);
    // Snapshot before processNext() may mutate cache entry
    const snapshot = { ...job };
    this.pending.push(job.id);
    logger.info(`Job enqueued: ${job.id} (pending: ${this.pending.length}, running: ${this.running.size})`);

    // Try to process next
    this.processNext();

    return snapshot;
  }

  /**
   * Retries a failed or cancelled job by removing the old one and creating a new one.
   */
  retryJob(jobId: string): Job | undefined {
    const oldJob = this.store.get(jobId);
    if (!oldJob) return undefined;
    if (oldJob.status !== "failure" && oldJob.status !== "cancelled") return undefined;

    // PR이 이미 생성된 job은 재시도 방지 (stuck 오판으로 failure 표시된 경우)
    const logs = oldJob.logs ?? [];
    const hasPR = oldJob.prUrl || logs.some((l: string) => l.includes("PR: https://"));
    if (hasPR) {
      logger.warn(`Job ${jobId} already has a PR — fixing status to success instead of retrying`);
      this.store.update(jobId, { status: "success", error: undefined });
      return undefined;
    }

    const { issueNumber, repo } = oldJob;
    this.cleanupFailedJobArtifacts(issueNumber);
    this.store.archive(jobId);
    return this.enqueue(issueNumber, repo, undefined, true);
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
    // Prevent re-entrancy
    if (this.isProcessing) {
      this.needsReprocess = true;
      return;
    }

    this.isProcessing = true;
    this.needsReprocess = false;

    try {
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
            // Check if any dependency has permanently failed — fail the dependent job immediately
            let depFailed = false;
            for (const depNum of job.dependencies) {
              const depJob = this.store.findAnyByIssue(depNum, job.repo);
              if (depJob && (depJob.status === "failure" || depJob.status === "cancelled")) {
                logger.error(`Job ${jobId} dependency #${depNum} failed — failing dependent job`);
                this.store.update(jobId, {
                  status: "failure",
                  completedAt: new Date().toISOString(),
                  error: `의존 이슈 #${depNum}이(가) 실패하여 실행 불가`,
                });
                depFailed = true;
                break;
              }
            }
            if (!depFailed) {
              logger.info(`Job ${jobId} waiting for dependencies: #${pending.join(", #")}`);
              deferred.push(jobId);
            }
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
    } finally {
      this.isProcessing = false;

      // If another call was made while processing, handle it now
      if (this.needsReprocess) {
        setTimeout(() => this.processNext(), 0);
      }
    }
  }

  private async executeJob(job: Job): Promise<void> {
    try {
      // Check if already aborted before running handler
      if (this.stuckAborted.has(job.id)) {
        this.stuckAborted.delete(job.id);
        return;
      }

      const result = await this.handler(job);

      // Re-check after handler completes — stuck checker may have fired during execution
      if (this.stuckAborted.has(job.id)) {
        this.stuckAborted.delete(job.id);
        logger.warn(`Job ${job.id} handler completed after stuck-abort — ignoring result`);
        return;
      }

      if (this.cancelled.has(job.id)) {
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
      // Process next in queue (defer via setTimeout to avoid deep call stacks)
      setTimeout(() => this.processNext(), 0);
    }
  }
}
