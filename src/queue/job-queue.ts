import { resolve } from "path";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { JobStore, Job as StoreJob } from "./job-store.js";
import { Job, isQueuedJob, isRunningJob, isSuccessJob, isFailureJob, isCancelledJob, isActiveJob } from "../types/pipeline.js";
import { areDependenciesMet } from "./dependency-resolver.js";
import { removeCheckpoint, loadCheckpoint } from "../pipeline/checkpoint.js";
import { isClaudeProcessAlive, getLastActivityMs } from "../claude/claude-runner.js";
import { removeWorktree } from "../git/worktree-manager.js";
import { deleteRemoteBranch } from "../git/branch-manager.js";
import { loadConfig } from "../config/loader.js";
import { ProjectErrorState } from "../types/config.js";
import {
  AQMTask,
  ClaudeTask, ClaudeTaskOptions,
  ValidationTask, ValidationTaskOptions,
  GitTask, GitTaskOptions,
  TaskStatus
} from "../tasks/index.js";

const logger = getLogger();

export type JobHandler = (job: Job) => Promise<{ prUrl?: string; error?: string }>;

/**
 * Job 타입에 따라 적절한 Task를 생성하는 팩토리
 */
class JobTaskFactory {
  /**
   * Job을 기반으로 해당하는 Task 인스턴스를 생성
   */
  static createTask(job: Job): AQMTask {
    const config = loadConfig(process.cwd());

    switch (job.type) {
      case "claude":
        return new ClaudeTask({
          id: `job-${job.id}-claude`,
          prompt: `Issue #${job.issueNumber} 처리 - Claude 실행`,
          config: config.commands.claudeCli,
          metadata: {
            jobId: job.id,
            issueNumber: job.issueNumber,
            repo: job.repo,
          },
        } as ClaudeTaskOptions);

      case "validation":
        return new ValidationTask({
          id: `job-${job.id}-validation`,
          validationType: "typecheck", // 기본값, 실제로는 job에서 결정
          command: "npx",
          args: ["tsc", "--noEmit"],
          metadata: {
            jobId: job.id,
            issueNumber: job.issueNumber,
            repo: job.repo,
          },
        } as ValidationTaskOptions);

      case "git":
        return new GitTask({
          id: `job-${job.id}-git`,
          config: config.git,
          worktreeConfig: config.worktree,
          operation: {
            type: "cleanup", // 기본값, 실제로는 job에서 결정
            issueNumber: job.issueNumber,
            issueTitle: `Issue #${job.issueNumber}`, // 기본값, 실제로는 job에서 결정
          },
          metadata: {
            jobId: job.id,
            issueNumber: job.issueNumber,
            repo: job.repo,
          },
        } as GitTaskOptions);

      default:
        // 기본값으로 Claude 태스크 생성 (하위 호환성)
        return new ClaudeTask({
          id: `job-${job.id}-default`,
          prompt: `Issue #${job.issueNumber} 처리 - 기본 파이프라인 실행`,
          config: config.commands.claudeCli,
          metadata: {
            jobId: job.id,
            issueNumber: job.issueNumber,
            repo: job.repo,
          },
        } as ClaudeTaskOptions);
    }
  }
}

/**
 * StoreJob을 새로운 discriminated union Job 타입으로 변환
 */
function convertStoreJobToJob(storeJob: StoreJob): Job {
  const base = {
    id: storeJob.id,
    issueNumber: storeJob.issueNumber,
    repo: storeJob.repo,
    createdAt: storeJob.createdAt,
    lastUpdatedAt: storeJob.lastUpdatedAt,
    logs: storeJob.logs,
    currentStep: storeJob.currentStep,
    dependencies: storeJob.dependencies,
    phaseResults: storeJob.phaseResults,
    progress: storeJob.progress,
    isRetry: storeJob.isRetry,
    costUsd: storeJob.costUsd,
    totalCostUsd: storeJob.totalCostUsd,
    totalUsage: storeJob.totalUsage
  };

  switch (storeJob.status) {
    case "queued":
      return {
        ...base,
        status: "queued"
      };
    case "running":
      return {
        ...base,
        status: "running",
        startedAt: storeJob.startedAt!,
        error: storeJob.error
      };
    case "success":
      return {
        ...base,
        status: "success",
        startedAt: storeJob.startedAt!,
        completedAt: storeJob.completedAt!,
        prUrl: storeJob.prUrl!
      };
    case "failure":
      return {
        ...base,
        status: "failure",
        startedAt: storeJob.startedAt!,
        completedAt: storeJob.completedAt!,
        error: storeJob.error!
      };
    case "cancelled":
      return {
        ...base,
        status: "cancelled",
        completedAt: storeJob.completedAt!,
        startedAt: storeJob.startedAt,
        error: storeJob.error
      };
    case "archived":
      return {
        ...base,
        status: "archived",
        startedAt: storeJob.startedAt,
        completedAt: storeJob.completedAt,
        prUrl: storeJob.prUrl,
        error: storeJob.error
      };
    default:
      throw new Error(`Unknown job status: ${(storeJob as Job).status}`);
  }
}

const STUCK_CHECK_INTERVAL_MS = 60 * 1000; // check every minute

export class JobQueue {
  private pending: string[] = [];  // job IDs
  private running: Set<string> = new Set();
  private store: JobStore;
  private concurrency: number;
  private handler?: JobHandler; // Optional - for backward compatibility with legacy JobHandler approach
  private cancelled: Set<string> = new Set();
  private stuckChecker: ReturnType<typeof setInterval> | undefined;
  private stuckTimeoutMs: number;
  private shuttingDown: boolean = false;
  private stuckAborted: Set<string> = new Set();
  private isProcessing: boolean = false;
  private needsReprocess: boolean = false;
  private projectConcurrency: Map<string, number> = new Map(); // repo -> concurrency limit
  private runningByRepo: Map<string, number> = new Map(); // repo -> count of running jobs
  private projectErrorState: Map<string, ProjectErrorState> = new Map(); // repo -> error state

  constructor(
    store: JobStore,
    concurrency: number,
    handler?: JobHandler, // Optional for backward compatibility
    stuckTimeoutMs: number = 600000,
    projectConcurrency?: Record<string, number>
  ) {
    this.store = store;
    this.concurrency = concurrency;
    this.handler = handler;
    this.stuckTimeoutMs = stuckTimeoutMs;

    if (projectConcurrency) {
      Object.entries(projectConcurrency).forEach(([repo, limit]) => {
        this.projectConcurrency.set(repo, limit);
      });
    }

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
      if (isRunningJob(job)) {
        // Was running when server died — reset to queued
        this.store.update(job.id, { status: "queued", startedAt: undefined });
        this.pending.push(job.id);
        recovered++;
        logger.info(`Job recovered (was running): ${job.id}`);
      } else if (isQueuedJob(job)) {
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
    } catch (checkpointErr: unknown) {
      logger.warn(`Failed to load checkpoint for cleanup of issue #${issueNumber}: ${getErrorMessage(checkpointErr)}`);
    }

    if (checkpoint) {
      const config = loadConfig(projectRoot);

      // Step 1: Remove worktree if exists
      if (checkpoint.worktreePath) {
        logger.info(`Cleaning up worktree: ${checkpoint.worktreePath}`);
        Promise.resolve(removeWorktree(config.git, checkpoint.worktreePath, { cwd: projectRoot, force: true }))
          .catch((worktreeErr: unknown) => {
            logger.warn(`Failed to remove worktree ${checkpoint.worktreePath}: ${getErrorMessage(worktreeErr)}`);
          });
      }

      // Step 2: Delete remote branch if exists
      if (checkpoint.branchName) {
        logger.info(`Deleting remote branch: ${checkpoint.branchName}`);
        Promise.resolve(deleteRemoteBranch(config.git, checkpoint.branchName, { cwd: projectRoot }))
          .catch((branchErr: unknown) => {
            logger.warn(`Failed to delete remote branch ${checkpoint.branchName}: ${getErrorMessage(branchErr)}`);
          });
      }
    }

    // Step 3: Always attempt to remove checkpoint regardless of whether we could load it
    try {
      logger.info(`Removing checkpoint for issue #${issueNumber}`);
      removeCheckpoint(dataDir, issueNumber);
    } catch (err: unknown) {
      logger.warn(`Failed to remove checkpoint for issue #${issueNumber}: ${getErrorMessage(err)}`);
    }
  }

  /**
   * Enqueues a new job. Returns the job or undefined if duplicate.
   */
  enqueue(issueNumber: number, repo: string, dependencies?: number[], isRetry?: boolean, priority?: import("../types/pipeline.js").JobPriority): Job | undefined {
    if (this.shuttingDown) {
      logger.warn(`Job for issue #${issueNumber} (${repo}) rejected — queue is shutting down`);
      return undefined;
    }

    // Check for existing job
    const existing = this.store.findAnyByIssue(issueNumber, repo);
    if (existing) {
      if (isSuccessJob(existing)) {
        logger.warn(`Job for issue #${issueNumber} (${repo}) already completed successfully: ${existing.id}`);
        return undefined;
      }

      if (isFailureJob(existing) || isCancelledJob(existing)) {
        logger.info(`Auto-archiving existing ${existing.status} job ${existing.id} for issue #${issueNumber} (${repo})`);
        this.cleanupFailedJobArtifacts(issueNumber);
        this.store.archive(existing.id);
      } else if (isActiveJob(existing)) {
        // queued/running statuses should still block
        logger.warn(`Job for issue #${issueNumber} (${repo}) already exists: ${existing.id} (status: ${existing.status})`);
        return undefined;
      } else {
        // archived status - should not happen but log for debugging
        logger.warn(`Job for issue #${issueNumber} (${repo}) in unexpected state: ${existing.id} (status: ${existing.status})`);
        return undefined;
      }
    }

    const job = this.store.create(issueNumber, repo, dependencies, isRetry, undefined, priority);
    // Convert StoreJob to discriminated union Job type
    const snapshot = convertStoreJobToJob(job);
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
    if (!isFailureJob(oldJob) && !isCancelledJob(oldJob)) return undefined;

    // PR이 이미 생성된 job은 재시도 방지 (stuck 오판으로 failure 표시된 경우)
    const logs = oldJob.logs ?? [];
    const hasPR = oldJob.prUrl || logs.some((l: string) => l.includes("PR: https://"));
    if (hasPR) {
      logger.warn(`Job ${jobId} already has a PR — fixing status to success instead of retrying`);

      // Extract PR URL from logs or use existing prUrl
      let prUrl = oldJob.prUrl;
      if (!prUrl) {
        const prLogEntry = logs.find((l: string) => l.includes("PR: https://"));
        if (prLogEntry) {
          const match = prLogEntry.match(/PR: (https:\/\/[^\s]+)/);
          if (match) {
            prUrl = match[1];
          }
        }
      }

      this.store.update(jobId, { status: "success", error: undefined, prUrl });
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
   * Sets the concurrency limit and immediately processes pending jobs if capacity allows.
   */
  setConcurrency(n: number): void {
    if (n <= 0 || !Number.isInteger(n)) {
      throw new Error("Concurrency must be a positive integer");
    }

    this.concurrency = n;
    logger.info(`Concurrency updated to ${n}`);

    // Trigger immediate processing if we now have more capacity
    this.processNext();
  }

  /**
   * Sets the per-project concurrency limit for the given repo at runtime.
   * Pass null to remove the project-specific limit.
   */
  setProjectConcurrency(repo: string, limit: number | null): void {
    if (limit !== null && (limit <= 0 || !Number.isInteger(limit))) {
      throw new Error("Project concurrency limit must be a positive integer");
    }

    if (limit === null) {
      this.projectConcurrency.delete(repo);
      logger.info(`Project concurrency limit removed for ${repo}`);
    } else {
      this.projectConcurrency.set(repo, limit);
      logger.info(`Project concurrency limit for ${repo} set to ${limit}`);
    }

    // Trigger immediate processing in case capacity increased
    this.processNext();
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

  /**
   * Checks if a new job can be started for the given repo based on project-specific concurrency limits.
   */
  private canStartJobForRepo(repo: string): boolean {
    const projectLimit = this.projectConcurrency.get(repo);
    if (!projectLimit) {
      return true;
    }
    const currentRunning = this.runningByRepo.get(repo) ?? 0;
    return currentRunning < projectLimit;
  }

  /**
   * Increments the running count for a repo.
   */
  private addJobToRepo(jobId: string, repo: string): void {
    this.runningByRepo.set(repo, (this.runningByRepo.get(repo) ?? 0) + 1);
  }

  /**
   * Decrements the running count for a repo.
   */
  private removeJobFromRepo(jobId: string, repo: string): void {
    const current = this.runningByRepo.get(repo) ?? 0;
    if (current > 1) {
      this.runningByRepo.set(repo, current - 1);
    } else {
      this.runningByRepo.delete(repo);
    }
  }

  /**
   * Checks if a project is currently paused due to consecutive failures.
   */
  isProjectPaused(repo: string): boolean {
    const errorState = this.projectErrorState.get(repo);
    if (!errorState || !errorState.pausedUntil) {
      return false;
    }

    // Check if pause has expired
    if (Date.now() >= errorState.pausedUntil) {
      // Auto-resume expired pause
      this.resumeProject(repo);
      return false;
    }

    return true;
  }

  /**
   * Manually pauses a project for the specified duration.
   */
  pauseProject(repo: string, durationMs: number): void {
    const errorState = this.projectErrorState.get(repo) || {
      consecutiveFailures: 0,
      pausedUntil: null,
      lastFailureAt: null,
    };

    errorState.pausedUntil = Date.now() + durationMs;
    this.projectErrorState.set(repo, errorState);

    logger.warn(`Project ${repo} manually paused for ${Math.round(durationMs / 1000)}s`);
  }

  /**
   * Resumes a paused project.
   */
  resumeProject(repo: string): void {
    const errorState = this.projectErrorState.get(repo);
    if (errorState) {
      errorState.pausedUntil = null;
      this.projectErrorState.set(repo, errorState);
      logger.info(`Project ${repo} resumed`);
    }
  }

  /**
   * Gets the error status of a project.
   */
  getProjectStatus(repo: string): ProjectErrorState | null {
    return this.projectErrorState.get(repo) || null;
  }

  /**
   * Tracks a project failure and potentially pauses the project.
   */
  private trackProjectFailure(repo: string): void {
    let project = undefined;
    try {
      const config = loadConfig(process.cwd());
      project = config?.projects?.find(p => p.repo === repo);
    } catch (error: unknown) {
      // If config loading fails (e.g. in test environment), use defaults
      logger.debug(`Failed to load config for project failure tracking: ${getErrorMessage(error)}`);
    }

    const pauseThreshold = project?.pauseThreshold || 3;
    const pauseDurationMs = project?.pauseDurationMs || 30 * 60 * 1000; // 30분 기본값

    const errorState = this.projectErrorState.get(repo) || {
      consecutiveFailures: 0,
      pausedUntil: null,
      lastFailureAt: null,
    };

    errorState.consecutiveFailures++;
    errorState.lastFailureAt = Date.now();

    if (errorState.consecutiveFailures >= pauseThreshold) {
      errorState.pausedUntil = Date.now() + pauseDurationMs;
      logger.error(
        `Project ${repo} paused for ${Math.round(pauseDurationMs / 60000)}min after ${errorState.consecutiveFailures} consecutive failures`
      );
    } else {
      logger.warn(
        `Project ${repo} failure count: ${errorState.consecutiveFailures}/${pauseThreshold}`
      );
    }

    this.projectErrorState.set(repo, errorState);
  }

  /**
   * Tracks a project success and resets failure count.
   */
  private trackProjectSuccess(repo: string): void {
    const errorState = this.projectErrorState.get(repo);
    if (errorState && errorState.consecutiveFailures > 0) {
      logger.info(`Project ${repo} success - resetting failure count (was ${errorState.consecutiveFailures})`);
      errorState.consecutiveFailures = 0;
      errorState.lastFailureAt = null;
      // Keep pausedUntil if manually set
      this.projectErrorState.set(repo, errorState);
    }
  }

  /**
   * Gets the highest priority job from the pending queue and removes it.
   * Priority order: high (0) > normal (1) > low (2)
   * Within same priority: FIFO (earliest createdAt first)
   * Missing priority defaults to 'normal'
   */
  private getNextPriorityJob(): string | null {
    if (this.pending.length === 0) return null;

    let bestIndex = -1;
    let bestPriorityValue = 3; // Lower than 'low' (2)
    let bestCreatedAt = '';

    // Find the job with highest priority (lowest numeric value)
    for (let i = 0; i < this.pending.length; i++) {
      const jobId = this.pending[i];
      const job = this.store.get(jobId);
      if (!job) continue;

      // Map priority to numeric value for comparison: high=0, normal=1, low=2
      const priority = job.priority ?? 'normal';
      const priorityValue = priority === 'high' ? 0 : priority === 'normal' ? 1 : 2;

      // Select if higher priority, or same priority but earlier created, or first job
      if (bestIndex === -1 ||
          priorityValue < bestPriorityValue ||
          (priorityValue === bestPriorityValue && job.createdAt < bestCreatedAt)) {
        bestIndex = i;
        bestPriorityValue = priorityValue;
        bestCreatedAt = job.createdAt;
      }
    }

    if (bestIndex >= 0) {
      return this.pending.splice(bestIndex, 1)[0];
    }
    return null;
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
        const jobId = this.getNextPriorityJob();
        if (!jobId) break; // No valid jobs available

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
              if (depJob && (isFailureJob(depJob) || isCancelledJob(depJob))) {
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

        // Check project-specific concurrency limits
        if (!this.canStartJobForRepo(job.repo)) {
          logger.info(`Job ${jobId} deferred due to project concurrency limit for repo ${job.repo}`);
          deferred.push(jobId);
          continue;
        }

        // Check if project is paused due to consecutive failures
        if (this.isProjectPaused(job.repo)) {
          const errorState = this.projectErrorState.get(job.repo);
          const remainingMs = errorState!.pausedUntil! - Date.now();
          logger.info(`Job ${jobId} deferred due to project pause (${job.repo}). Resume in ${Math.round(remainingMs / 1000)}s`);
          deferred.push(jobId);
          continue;
        }

        this.running.add(jobId);
        this.addJobToRepo(jobId, job.repo);
        this.store.update(jobId, { status: "running", startedAt: new Date().toISOString() });

        logger.info(`Job started: ${jobId}`);

        // Run async - don't await, let it run in background
        this.executeJob(convertStoreJobToJob(job)).catch((err: unknown) => {
          logger.error(`Job ${jobId} unexpected error: ${getErrorMessage(err)}`);
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
        setImmediate(() => this.processNext());
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

      // Task 팩토리 패턴으로 Job 타입에 따라 Task 생성
      const task = JobTaskFactory.createTask(job);

      // Task lifecycle 이벤트를 Job 상태 업데이트와 연결
      task.on?.("started", () => {
        logger.info(`Task started for job ${job.id}: ${task.id}`);
        this.store.update(job.id, {
          lastUpdatedAt: new Date().toISOString(),
          currentStep: `Running ${task.type} task`,
        });
      });

      task.on?.("completed", () => {
        logger.info(`Task completed for job ${job.id}: ${task.id}`);
        // Task 완료 시 Job을 성공으로 마킹 (결과 처리는 아래에서)
      });

      task.on?.("failed", () => {
        logger.error(`Task failed for job ${job.id}: ${task.id}`);
        // Task 실패 시 Job을 실패로 마킹 (결과 처리는 아래에서)
      });

      task.on?.("killed", () => {
        logger.warn(`Task killed for job ${job.id}: ${task.id}`);
        this.store.update(job.id, {
          status: "cancelled",
          completedAt: new Date().toISOString(),
          error: "Task was killed during execution",
        });
      });

      // 기존 handler가 있으면 사용 (하위 호환성), 없으면 Task 실행
      let result: { prUrl?: string; error?: string };

      if (this.handler) {
        // 기존 JobHandler 방식 (하위 호환성 유지)
        result = await this.handler(job);
      } else {
        // 새로운 Task 기반 실행
        try {
          const taskResult = await task.run();

          // Task 결과를 Job 결과 형태로 변환
          if (task.type === "claude") {
            const claudeResult = (task as ClaudeTask).getResult();
            result = {
              prUrl: claudeResult?.success ? "https://github.com/example/pr" : undefined, // 실제로는 PR 생성 로직 필요
              error: claudeResult?.success ? undefined : claudeResult?.output,
            };
          } else if (task.type === "validation") {
            const validationResult = (task as ValidationTask).getResult();
            result = {
              error: validationResult?.success ? undefined : validationResult?.stderr || "Validation failed",
            };
          } else if (task.type === "git") {
            const gitResult = (task as GitTask).getResult();
            result = {
              error: gitResult?.success ? undefined : gitResult?.error,
            };
          } else {
            result = { error: "Unknown task type" };
          }
        } catch (taskError) {
          result = {
            error: getErrorMessage(taskError),
          };
        }
      }

      // Re-check after handler completes — stuck checker may have fired during execution
      const wasStuckAborted = this.stuckAborted.has(job.id);
      if (wasStuckAborted) {
        this.stuckAborted.delete(job.id);
        logger.warn(`Job ${job.id} handler completed after stuck-abort — updating status but not tracking project metrics`);
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
        // Don't track project failure if it was stuck aborted
        if (!wasStuckAborted) {
          this.trackProjectFailure(job.repo);
        }
      } else if (result.prUrl) {
        this.store.update(job.id, {
          status: "success",
          completedAt: new Date().toISOString(),
          prUrl: result.prUrl,
        });
        // Don't track project success if it was stuck aborted
        if (!wasStuckAborted) {
          this.trackProjectSuccess(job.repo);
        }
      } else {
        this.store.update(job.id, {
          status: "failure",
          completedAt: new Date().toISOString(),
          error: "Pipeline completed but no PR was created",
        });
        // Don't track project failure if it was stuck aborted
        if (!wasStuckAborted) {
          this.trackProjectFailure(job.repo);
        }
      }
    } catch (error: unknown) {
      this.store.update(job.id, {
        status: "failure",
        completedAt: new Date().toISOString(),
        error: getErrorMessage(error),
      });
      this.trackProjectFailure(job.repo);
    } finally {
      this.running.delete(job.id);
      this.removeJobFromRepo(job.id, job.repo);
      // Process next in queue (defer via setImmediate to avoid deep call stacks)
      setImmediate(() => this.processNext());
    }
  }
}
