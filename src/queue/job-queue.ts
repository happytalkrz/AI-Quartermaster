import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { JobStore, Job as StoreJob } from "./job-store.js";
import { Job, isQueuedJob, isRunningJob, isSuccessJob, isFailureJob, isCancelledJob, isActiveJob, PhaseResultInfo, DiagnosisReport, UserSummary } from "../types/pipeline.js";
import type { ConfigProvider } from "../config/config-provider.js";
import { ProjectErrorState, StuckThresholdConfig } from "../types/config.js";
import { JobCleanupService } from "./job-cleanup.js";
import { ProjectErrorTracker } from "./project-error-tracker.js";
import { StuckJobMonitor } from "./stuck-monitor.js";
import { JobLifecycle } from "./job-lifecycle.js";
import { JobScheduler } from "./job-scheduler.js";
import type { TaskFactory } from "../tasks/task-factory.js";
import type { AQMTask } from "../tasks/aqm-task.js";

const logger = getLogger();

export type JobHandler = (job: Job) => Promise<{ prUrl?: string; error?: string; diagnosis?: DiagnosisReport; userSummary?: UserSummary }>;

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
  private store: JobStore;
  private handler: JobHandler;
  private cancelled: Set<string> = new Set();
  private stuckAborted: Set<string> = new Set();
  private activeTasks: Map<string, AQMTask> = new Map(); // jobId -> AQMTask
  private taskFactory?: TaskFactory;
  private shuttingDown: boolean = false;
  private readonly errorTracker = new ProjectErrorTracker();
  private cleanupService?: JobCleanupService; // setDependencies 호출 후 활성화
  private readonly scheduler: JobScheduler;
  private readonly lifecycle: JobLifecycle;
  private readonly stuckMonitor: StuckJobMonitor;
  private projectRoot?: string;
  private configProvider?: ConfigProvider;

  /**
   * 런타임 의존성(projectRoot, ConfigProvider)을 주입한다 (Plan C #C2/#C6/#C10).
   *
   * 구성자 서명을 바꾸지 않기 위한 post-construction 주입. cli.ts 등 애플리케이션 코드에서 호출하면
   * `JobCleanupService`/`ProjectErrorTracker`가 활성화된다. 테스트는 호출하지 않으면
   * cleanupService 미설정 → cleanup no-op, errorTracker는 configProvider 없이 기본 임계값으로 동작.
   *
   * Plan C #C10 Phase 3에서 `process.cwd()` fallback이 완전히 제거됐다. 호출하지 않으면
   * cleanup이 그냥 동작하지 않으며, 어떤 디렉터리도 가정하지 않는다.
   */
  setDependencies(deps: { projectRoot?: string; configProvider?: ConfigProvider }): void {
    if (deps.projectRoot) this.projectRoot = deps.projectRoot;
    if (deps.configProvider) {
      this.configProvider = deps.configProvider;
      this.errorTracker.setConfigProvider(deps.configProvider);
    }
    if (this.projectRoot) {
      this.cleanupService = new JobCleanupService(this.projectRoot, this.configProvider);
    }
  }

  constructor(
    store: JobStore,
    concurrency: number,
    handler: JobHandler,
    stuckTimeoutMs: number = 600000,
    projectConcurrency?: Record<string, number>,
    taskFactory?: TaskFactory,
    stuckThresholds?: StuckThresholdConfig
  ) {
    this.store = store;
    this.handler = handler;
    this.taskFactory = taskFactory;

    // 스케줄링 책임은 JobScheduler에 위임 (Plan C #C10 Phase 3)
    this.scheduler = new JobScheduler({
      store: this.store,
      errorTracker: this.errorTracker,
      concurrency,
      projectConcurrency,
      cancelledRef: this.cancelled,
      onStartJob: (job) => {
        this.lifecycle.execute(convertStoreJobToJob(job)).catch((err: unknown) => {
          logger.error(`Job ${job.id} unexpected error: ${getErrorMessage(err)}`);
        });
      },
    });

    // 잡 실행/결과 처리는 JobLifecycle에 위임 (Plan C #C10 Phase 2)
    this.lifecycle = new JobLifecycle({
      store: this.store,
      handler: this.handler,
      taskFactory: this.taskFactory,
      errorTracker: this.errorTracker,
      activeTasks: this.activeTasks,
      stuckAborted: this.stuckAborted,
      cancelled: this.cancelled,
      onJobFinished: (jobId, repo) => {
        this.scheduler.markJobFinished(jobId, repo);
      },
    });

    // Stuck 잡 탐지는 StuckJobMonitor에 위임 (Plan C #C10 Phase 1)
    this.stuckMonitor = new StuckJobMonitor({
      store: this.store,
      stuckTimeoutMs,
      stuckThresholds,
      checkIntervalMs: STUCK_CHECK_INTERVAL_MS,
      getRunningJobIds: () => this.scheduler.getRunningIds(),
      toJob: convertStoreJobToJob,
      onStuckDetected: (jobId, reason) => {
        this.store.update(jobId, {
          status: "failure",
          completedAt: new Date().toISOString(),
          error: reason,
        });
        this.stuckAborted.add(jobId);
        this.scheduler.markStuckAborted(jobId);
      },
    });
    this.stuckMonitor.start();
  }

  /**
   * Marks a job as stuck-aborted so executeJob can detect it after the handler returns.
   */
  abortJob(jobId: string): boolean {
    if (this.scheduler.isRunning(jobId)) {
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
    this.stuckMonitor.stop();
    if (this.scheduler.runningCount === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (this.scheduler.runningCount === 0) {
          clearInterval(check);
          resolve();
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          clearInterval(check);
          logger.warn(`Shutdown timeout: ${this.scheduler.runningCount} job(s) still running after ${timeoutMs / 1000}s`);
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
    // 재시작 시 메모리 상태 초기화 — pause 상태 자동 해제
    this.errorTracker.clear();
    logger.info("재시작: project error tracker 초기화 완료 (project pause 해제)");

    const jobs = this.store.list();
    let recovered = 0;

    for (const job of jobs) {
      if (isRunningJob(job)) {
        // Was running when server died — reset to queued
        this.store.update(job.id, { status: "queued", startedAt: undefined });
        this.scheduler.pushPending(job.id);
        recovered++;
        logger.info(`Job recovered (was running): ${job.id}`);
      } else if (isQueuedJob(job)) {
        this.scheduler.pushPending(job.id);
        recovered++;
        logger.info(`Job recovered (was queued): ${job.id}`);
      }
    }

    if (recovered > 0) {
      logger.info(`Recovered ${recovered} job(s) from previous session`);
      void this.scheduler.processNext();
    }

    return recovered;
  }


  /**
   * 실패 잡 정리 — JobCleanupService에 위임 (Plan C #C6).
   * setDependencies 전에는 no-op (테스트 환경 호환).
   */
  private async cleanupFailedJobArtifacts(issueNumber: number): Promise<void> {
    if (!this.cleanupService) return;
    await this.cleanupService.cleanupFailedJobArtifacts(issueNumber);
  }

  /**
   * Enqueues a new job. Returns the job or undefined if duplicate.
   */
  enqueue(issueNumber: number, repo: string, dependencies?: number[], isRetry?: boolean, priority?: import("../types/pipeline.js").JobPriority, initialPhaseResults?: PhaseResultInfo[], triggerReason?: string): Job | undefined {
    if (this.shuttingDown) {
      logger.warn(`Job for issue #${issueNumber} (${repo}) rejected — queue is shutting down`);
      return undefined;
    }

    // Check for existing job
    const existing = this.store.findAnyByIssue(issueNumber, repo);
    if (existing) {
      if (isSuccessJob(existing)) {
        logger.info(`Auto-archiving existing success job ${existing.id} for issue #${issueNumber} (${repo})`);
        this.store.archive(existing.id);
      } else if (isFailureJob(existing) || isCancelledJob(existing)) {
        logger.info(`Auto-archiving existing ${existing.status} job ${existing.id} for issue #${issueNumber} (${repo})`);
        // Fire-and-forget: enqueue 응답을 차단하지 않는다. retryJob에서는 race 차단을 위해 await로 호출.
        void this.cleanupFailedJobArtifacts(issueNumber).catch((err: unknown) => {
          logger.warn(`Cleanup failed during enqueue for issue #${issueNumber}: ${getErrorMessage(err)}`);
        });
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

    const job = this.store.create(issueNumber, repo, dependencies, isRetry, initialPhaseResults, priority, triggerReason);
    const snapshot = convertStoreJobToJob(job);
    const status = this.scheduler.getStatus();
    logger.info(`Job enqueued: ${job.id} (pending: ${status.pending + 1}, running: ${status.running})`);

    this.scheduler.enqueue(job.id);

    return snapshot;
  }

  /**
   * Retries a failed or cancelled job by removing the old one and creating a new one.
   *
   * Plan C #C6: cleanup이 완료된 후에야 새 잡을 enqueue하도록 await로 동기화.
   * 이전 fire-and-forget으로 인해 발생할 수 있던 worktree race를 차단한다.
   */
  async retryJob(jobId: string): Promise<Job | undefined> {
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

    const { issueNumber, repo, phaseResults } = oldJob;
    await this.cleanupFailedJobArtifacts(issueNumber);
    this.store.archive(jobId);
    return this.enqueue(issueNumber, repo, undefined, true, undefined, phaseResults);
  }

  /**
   * Cancels a job by ID.
   */
  cancel(jobId: string): boolean {
    // Remove from pending
    if (this.scheduler.removePending(jobId)) {
      this.store.update(jobId, { status: "cancelled", completedAt: new Date().toISOString() });
      logger.info(`Job cancelled (was pending): ${jobId}`);
      return true;
    }

    // Mark running job for cancellation
    if (this.scheduler.isRunning(jobId)) {
      this.cancelled.add(jobId);
      this.store.update(jobId, { status: "cancelled", completedAt: new Date().toISOString() });
      // Kill active task if tracked
      const activeTask = this.activeTasks.get(jobId);
      if (activeTask) {
        activeTask.kill().catch((err: unknown) => {
          logger.warn(`Failed to kill task for job ${jobId}: ${getErrorMessage(err)}`);
        });
      }
      logger.info(`Job cancelled (was running): ${jobId}`);
      return true;
    }

    return false;
  }

  /**
   * Returns the active AQMTask for the given job ID, if taskFactory is in use.
   */
  getActiveTask(jobId: string): AQMTask | undefined {
    return this.activeTasks.get(jobId);
  }

  /**
   * Sets the concurrency limit and immediately processes pending jobs if capacity allows.
   */
  setConcurrency(n: number): void {
    this.scheduler.setConcurrency(n);
  }

  /**
   * Sets the per-project concurrency limit for the given repo at runtime.
   * Pass null to remove the project-specific limit.
   */
  setProjectConcurrency(repo: string, limit: number | null): void {
    this.scheduler.setProjectConcurrency(repo, limit);
  }

  /**
   * Returns queue status.
   */
  getStatus(): { pending: number; running: number; concurrency: number } {
    return this.scheduler.getStatus();
  }

  // Plan C #C6: 프로젝트 실패 추적/일시 정지 로직은 ProjectErrorTracker로 응집됨.
  // 외부 public API 시그니처를 보존하기 위해 위임 wrapper만 유지한다.

  /**
   * Checks if a project is currently paused due to consecutive failures.
   */
  isProjectPaused(repo: string): boolean {
    return this.errorTracker.isProjectPaused(repo);
  }

  /**
   * Manually pauses a project for the specified duration.
   */
  pauseProject(repo: string, durationMs: number): void {
    this.errorTracker.pauseProject(repo, durationMs);
  }

  /**
   * Resumes a paused project.
   */
  resumeProject(repo: string): void {
    this.errorTracker.resumeProject(repo);
  }

  /**
   * Gets the error status of a project.
   */
  getProjectStatus(repo: string): ProjectErrorState | null {
    return this.errorTracker.getProjectStatus(repo);
  }
}
