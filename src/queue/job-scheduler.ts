import { getLogger } from "../utils/logger.js";
import type { JobStore, Job as StoreJob } from "./job-store.js";
import { isFailureJob, isCancelledJob } from "../types/pipeline.js";
import type { ProjectErrorTracker } from "./project-error-tracker.js";
import { areDependenciesMet } from "./dependency-resolver.js";

const logger = getLogger();

/**
 * 잡 스케줄링 책임 (Plan C #C10 — Phase 3).
 *
 * 이전: `JobQueue`가 pending/running/processingJobs/runningByRepo/lastServedRepo,
 *      그리고 round-robin + 우선순위 + dependency/project concurrency/pause 가드
 *      로직을 모두 보관했다.
 * 이후: 본 클래스가 큐 상태와 스케줄링 알고리즘을 응집한다. JobQueue는
 *      `onStartJob` 콜백을 통해 실제 잡 실행(`JobLifecycle`)으로 위임한다.
 *
 * cancelledRef는 `JobQueue.cancel()`이 set하고 scheduler가 processNext에서
 * 한 번 소비하는 공유 set이다. lifecycle은 별도 cancelled set을 본다 (이중 클리어 안전).
 */
export interface JobSchedulerOptions {
  store: JobStore;
  errorTracker: ProjectErrorTracker;
  concurrency: number;
  projectConcurrency?: Record<string, number>;
  /** scheduler가 잡을 시작하기로 결정했을 때 호출. JobQueue가 lifecycle.execute로 위임. */
  onStartJob: (job: StoreJob) => void;
  /** JobQueue.cancel()과 공유되는 cancel 플래그. processNext에서 소비. */
  cancelledRef: Set<string>;
}

export class JobScheduler {
  private readonly pending: string[] = [];
  private readonly running: Set<string> = new Set();
  private readonly processingJobs: Set<string> = new Set();
  private readonly projectConcurrency: Map<string, number> = new Map();
  private readonly runningByRepo: Map<string, number> = new Map();
  private lastServedRepo: string | null = null;
  private concurrency: number;
  private isProcessing: boolean = false;
  private needsReprocess: boolean = false;

  constructor(private readonly opts: JobSchedulerOptions) {
    this.concurrency = opts.concurrency;
    if (opts.projectConcurrency) {
      Object.entries(opts.projectConcurrency).forEach(([repo, limit]) => {
        this.projectConcurrency.set(repo, limit);
      });
    }
  }

  // ─── queries ───────────────────────────────────────────────

  get runningCount(): number {
    return this.running.size;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  /** stuck monitor가 매 체크마다 호출. 직접 set을 노출해 추가 복사를 피한다. */
  getRunningIds(): Iterable<string> {
    return this.running;
  }

  getStatus(): { pending: number; running: number; concurrency: number } {
    return {
      pending: this.pending.length + this.processingJobs.size,
      running: this.running.size,
      concurrency: this.concurrency,
    };
  }

  // ─── pending/queue mutations ───────────────────────────────

  /** 새 잡 진입. 즉시 processNext 호출. */
  enqueue(jobId: string): void {
    this.pending.push(jobId);
    void this.processNext();
  }

  /** 재시작 복구용 — pending에 push만 하고 processNext는 caller가 결정. */
  pushPending(jobId: string): void {
    this.pending.push(jobId);
  }

  /** pending 큐에서 제거. cancel 처리에서 사용. */
  removePending(jobId: string): boolean {
    const idx = this.pending.indexOf(jobId);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
      return true;
    }
    return false;
  }

  // ─── concurrency knobs ─────────────────────────────────────

  setConcurrency(n: number): void {
    if (n <= 0 || !Number.isInteger(n)) {
      throw new Error("Concurrency must be a positive integer");
    }
    this.concurrency = n;
    logger.info(`Concurrency updated to ${n}`);
    void this.processNext();
    if (this.isProcessing && !this.needsReprocess) {
      this.needsReprocess = true;
    }
  }

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
    void this.processNext();
  }

  // ─── lifecycle hooks ───────────────────────────────────────

  /** lifecycle 종료 시 호출 — running/runningByRepo 정리 + 다음 잡 처리. */
  markJobFinished(jobId: string, repo: string): void {
    this.running.delete(jobId);
    this.removeJobFromRepo(repo);
    setImmediate(() => this.processNext());
  }

  /**
   * stuck-aborted 처리: running에서 즉시 제거 + 다음 처리 트리거.
   * runningByRepo는 lifecycle finally의 markJobFinished가 처리하므로 여기서 건드리지 않는다
   * (handler가 stuck 후에도 어쨌든 끝나면 lifecycle이 onJobFinished로 들어옴).
   */
  markStuckAborted(jobId: string): void {
    this.running.delete(jobId);
    setTimeout(() => this.processNext(), 0);
  }

  // ─── core scheduling ───────────────────────────────────────

  async processNext(): Promise<void> {
    if (this.opts.store.isClosed) return;

    if (this.isProcessing) {
      this.needsReprocess = true;
      return;
    }
    this.isProcessing = true;
    this.needsReprocess = false;

    try {
      const deferred: string[] = [];

      while (this.running.size < this.concurrency && this.pending.length > 0) {
        const jobId = this.getNextRoundRobinJob();
        if (!jobId) break;

        this.processingJobs.add(jobId);

        if (this.opts.cancelledRef.has(jobId)) {
          this.opts.cancelledRef.delete(jobId);
          this.processingJobs.delete(jobId);
          continue;
        }

        const job = this.opts.store.get(jobId);
        if (!job) {
          this.processingJobs.delete(jobId);
          continue;
        }

        if (job.dependencies && job.dependencies.length > 0) {
          const { met, pending } = areDependenciesMet(job.dependencies, job.repo, this.opts.store);
          if (!met) {
            let depFailed = false;
            for (const depNum of job.dependencies) {
              const depJob = this.opts.store.findAnyByIssue(depNum, job.repo);
              if (depJob && (isFailureJob(depJob) || isCancelledJob(depJob))) {
                logger.error(`Job ${jobId} dependency #${depNum} failed — failing dependent job`);
                this.opts.store.update(jobId, {
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
              this.processingJobs.delete(jobId);
              deferred.push(jobId);
            } else {
              this.processingJobs.delete(jobId);
            }
            continue;
          }
        }

        if (!this.canStartJobForRepo(job.repo)) {
          logger.info(`Job ${jobId} deferred due to project concurrency limit for repo ${job.repo}`);
          this.processingJobs.delete(jobId);
          deferred.push(jobId);
          continue;
        }

        if (this.opts.errorTracker.isProjectPaused(job.repo)) {
          const errorState = this.opts.errorTracker.getProjectStatus(job.repo);
          const remainingMs = errorState!.pausedUntil! - Date.now();
          logger.info(`Job ${jobId} deferred due to project pause (${job.repo}). Resume in ${Math.round(remainingMs / 1000)}s`);
          this.processingJobs.delete(jobId);
          deferred.push(jobId);
          continue;
        }

        this.running.add(jobId);
        this.addJobToRepo(job.repo);
        this.processingJobs.delete(jobId);
        this.opts.store.update(jobId, { status: "running", startedAt: new Date().toISOString() });
        logger.info(`Job started: ${jobId}`);
        this.opts.onStartJob(job);
      }

      for (const jobId of deferred) {
        this.pending.push(jobId);
      }
    } finally {
      this.isProcessing = false;
      if (this.needsReprocess) {
        setImmediate(() => this.processNext());
      }
    }
  }

  // ─── private helpers ───────────────────────────────────────

  private canStartJobForRepo(repo: string): boolean {
    const projectLimit = this.projectConcurrency.get(repo);
    if (!projectLimit) return true;
    const currentRunning = this.runningByRepo.get(repo) ?? 0;
    return currentRunning < projectLimit;
  }

  private addJobToRepo(repo: string): void {
    this.runningByRepo.set(repo, (this.runningByRepo.get(repo) ?? 0) + 1);
  }

  private removeJobFromRepo(repo: string): void {
    const current = this.runningByRepo.get(repo) ?? 0;
    if (current > 1) {
      this.runningByRepo.set(repo, current - 1);
    } else {
      this.runningByRepo.delete(repo);
    }
  }

  /**
   * Round-robin: 마지막에 서빙한 repo 다음부터 순환하며, 각 repo 내에서는
   * priority(high>normal>low) → createdAt(FIFO) 순으로 선택한다.
   */
  private getNextRoundRobinJob(): string | null {
    if (this.pending.length === 0) return null;

    const repoOrder: string[] = [];
    const jobsByRepo = new Map<string, string[]>();
    for (const jobId of this.pending) {
      const job = this.opts.store.get(jobId);
      if (!job) continue;
      if (!jobsByRepo.has(job.repo)) {
        repoOrder.push(job.repo);
        jobsByRepo.set(job.repo, []);
      }
      jobsByRepo.get(job.repo)!.push(jobId);
    }

    if (repoOrder.length === 0) return null;

    let startIndex = 0;
    if (this.lastServedRepo !== null) {
      const lastIdx = repoOrder.indexOf(this.lastServedRepo);
      if (lastIdx >= 0) {
        startIndex = (lastIdx + 1) % repoOrder.length;
      }
    }

    for (let i = 0; i < repoOrder.length; i++) {
      const repo = repoOrder[(startIndex + i) % repoOrder.length];
      const repoJobs = jobsByRepo.get(repo);
      if (!repoJobs || repoJobs.length === 0) continue;

      let bestIndex = -1;
      let bestPriorityValue = 3;
      let bestCreatedAt = "";

      for (let j = 0; j < repoJobs.length; j++) {
        const jobId = repoJobs[j];
        const job = this.opts.store.get(jobId);
        if (!job) continue;

        const priority = job.priority ?? "normal";
        const priorityValue = priority === "high" ? 0 : priority === "normal" ? 1 : 2;

        if (
          bestIndex === -1 ||
          priorityValue < bestPriorityValue ||
          (priorityValue === bestPriorityValue && job.createdAt < bestCreatedAt)
        ) {
          bestIndex = j;
          bestPriorityValue = priorityValue;
          bestCreatedAt = job.createdAt;
        }
      }

      if (bestIndex >= 0) {
        const selectedJobId = repoJobs[bestIndex];
        const pendingIdx = this.pending.indexOf(selectedJobId);
        if (pendingIdx >= 0) {
          this.pending.splice(pendingIdx, 1);
        }
        this.lastServedRepo = repo;
        return selectedJobId;
      }
    }

    return null;
  }
}
