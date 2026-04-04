import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, watch, FSWatcher } from "fs";
import { resolve } from "path";
import { EventEmitter } from "events";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export type JobStatus = "queued" | "running" | "success" | "failure" | "cancelled" | "archived";

export interface Job {
  id: string;
  issueNumber: number;
  repo: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  prUrl?: string;
  error?: string;
  lastUpdatedAt?: string;
  logs?: string[];
  currentStep?: string;
  dependencies?: number[];
  phaseResults?: Array<{
    name: string;
    success: boolean;
    commit?: string;
    durationMs: number;
    error?: string;
  }>;
  progress?: number;  // 0-100 overall pipeline progress
  isRetry?: boolean;  // Indicates if this job is a retry of a previously failed job
  costUsd?: number;
  totalCostUsd?: number;
}

export class JobStore extends EventEmitter {
  private dataDir: string;
  private cache: Map<string, Job> = new Map();
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private internalDeletes: Set<string> = new Set();

  constructor(dataDir: string) {
    super();
    this.dataDir = resolve(dataDir, "jobs");
    mkdirSync(this.dataDir, { recursive: true });
    this.loadAll();
    this.startWatching();
  }

  private loadAll(): void {
    try {
      const files = readdirSync(this.dataDir).filter(f => f.endsWith(".json"));
      for (const f of files) {
        try {
          const job = JSON.parse(readFileSync(resolve(this.dataDir, f), "utf-8")) as Job;
          this.cache.set(job.id, job);
        } catch { /* skip corrupt files */ }
      }
    } catch { /* empty dir */ }
  }

  private jobPath(id: string): string {
    return resolve(this.dataDir, `${id}.json`);
  }

  create(issueNumber: number, repo: string, dependencies?: number[], isRetry?: boolean): Job {
    const id = `aq-${issueNumber}-${Date.now()}`;
    const job: Job = {
      id,
      issueNumber,
      repo,
      status: "queued",
      createdAt: new Date().toISOString(),
      ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
      ...(isRetry ? { isRetry } : {}),
    };
    this.save(job);
    logger.info(`Job created: ${id}`);
    this.emit('jobCreated', job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.cache.get(id);
  }

  update(id: string, updates: Partial<Job>): Job | undefined {
    const job = this.get(id);
    if (!job) return undefined;
    const previousJob = { ...job };
    Object.assign(job, updates);
    this.save(job);
    this.emit('jobUpdated', job, previousJob);
    return job;
  }

  list(): Job[] {
    return Array.from(this.cache.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  findByIssue(issueNumber: number, repo: string): Job | undefined {
    for (const job of this.cache.values()) {
      if (job.issueNumber === issueNumber && job.repo === repo && (job.status === "queued" || job.status === "running")) {
        return job;
      }
    }
    return undefined;
  }

  findCompletedByIssue(issueNumber: number, repo: string): Job | undefined {
    for (const job of this.cache.values()) {
      if (job.issueNumber === issueNumber && job.repo === repo && job.status === "success") {
        return job;
      }
    }
    return undefined;
  }

  findAnyByIssue(issueNumber: number, repo: string): Job | undefined {
    for (const job of this.cache.values()) {
      if (job.issueNumber === issueNumber && job.repo === repo && job.status !== "archived") {
        return job;
      }
    }
    return undefined;
  }

  shouldBlockRepickup(issueNumber: number, repo: string): boolean {
    for (const job of this.cache.values()) {
      if (job.issueNumber === issueNumber && job.repo === repo && job.status === "success") {
        return true;
      }
    }
    return false;
  }

  findFailedJobsForRetry(): Job[] {
    const now = Date.now();
    const RETRY_DELAY_MS = 10 * 60 * 1000; // 10분 대기 후 재시도

    return Array.from(this.cache.values()).filter(job => {
      // failed 상태이고 retry가 아닌 job만
      if (job.status !== "failure" || job.isRetry === true) {
        return false;
      }

      // 최근 실패한 job은 제외 (10분 대기)
      const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
      return completedAt > 0 && (now - completedAt) > RETRY_DELAY_MS;
    });
  }

  archive(id: string): boolean {
    const job = this.get(id);
    if (!job) return false;
    const previousJob = { ...job };
    job.status = "archived";
    this.save(job);
    logger.info(`Job archived: ${id}`);
    this.emit('jobArchived', job, previousJob);
    return true;
  }

  prune(maxJobs: number): number {
    const all = this.list();
    if (all.length <= maxJobs) return 0;

    const completed = all
      .filter(j => j.status === "success" || j.status === "failure" || j.status === "cancelled")
      .sort((a, b) => {
        const ta = a.completedAt ? new Date(a.completedAt).getTime() : new Date(a.createdAt).getTime();
        const tb = b.completedAt ? new Date(b.completedAt).getTime() : new Date(b.createdAt).getTime();
        return ta - tb; // oldest first
      });

    const excess = all.length - maxJobs;
    const toDelete = completed.slice(0, excess);

    for (const job of toDelete) {
      this.remove(job.id);
    }

    if (toDelete.length > 0) {
      logger.info(`Job pruning: ${toDelete.length}개 완료 작업 삭제 (총 ${all.length} → ${all.length - toDelete.length})`);
    }

    return toDelete.length;
  }

  remove(id: string): boolean {
    const job = this.cache.get(id);
    try {
      // Mark as internal delete to avoid duplicate processing in watcher
      this.internalDeletes.add(id);
      unlinkSync(this.jobPath(id));
      this.cache.delete(id);
      logger.info(`Job deleted: ${id}`);
      if (job) {
        this.emit('jobDeleted', job);
      }
      // Clean up internal delete flag after a short delay
      setTimeout(() => this.internalDeletes.delete(id), 100);
      return true;
    } catch (err: unknown) {
      this.internalDeletes.delete(id); // Clean up on error
      if (err && typeof err === 'object' && 'code' in err && err.code === "ENOENT") return false;
      return false;
    }
  }

  getCostStats(repo?: string): {
    totalCostUsd: number;
    avgCostUsd: number;
    jobCount: number;
    topExpensiveJobs: Array<{ id: string; issueNumber: number; totalCostUsd: number; repo: string }>;
  } {
    const allJobs = Array.from(this.cache.values());
    const filteredJobs = repo ? allJobs.filter(job => job.repo === repo) : allJobs;
    const jobsWithCost = filteredJobs.filter(job => job.totalCostUsd != null && job.totalCostUsd > 0);

    const round = (val: number) => Math.round(val * 100) / 100;

    const totalCostUsd = round(jobsWithCost.reduce((sum, job) => sum + job.totalCostUsd!, 0));
    const avgCostUsd = jobsWithCost.length > 0 ? round(totalCostUsd / jobsWithCost.length) : 0;

    const topExpensiveJobs = jobsWithCost
      .sort((a, b) => b.totalCostUsd! - a.totalCostUsd!)
      .slice(0, 10)
      .map(job => ({
        id: job.id,
        issueNumber: job.issueNumber,
        totalCostUsd: job.totalCostUsd!,
        repo: job.repo
      }));

    return {
      totalCostUsd,
      avgCostUsd,
      jobCount: jobsWithCost.length,
      topExpensiveJobs
    };
  }

  private save(job: Job): void {
    writeFileSync(this.jobPath(job.id), JSON.stringify(job, null, 2));
    this.cache.set(job.id, job);
  }

  startWatching(): void {
    if (this.watcher) {
      return; // Already watching
    }

    try {
      this.watcher = watch(this.dataDir, { persistent: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) {
          return;
        }

        const jobId = filename.replace('.json', '');

        // Clear existing debounce timer
        const existingTimer = this.debounceTimers.get(jobId);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // Set new debounce timer
        const timer = setTimeout(() => {
          this.handleFileEvent(eventType, jobId);
          this.debounceTimers.delete(jobId);
        }, 100); // 100ms debounce

        this.debounceTimers.set(jobId, timer);
      });

      logger.info(`Started watching job store directory: ${this.dataDir}`);
    } catch (err) {
      logger.error(`Failed to start watching job store directory: ${err}`);
    }
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('Stopped watching job store directory');
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private handleFileEvent(eventType: string, jobId: string): void {
    try {
      const filePath = this.jobPath(jobId);

      if (eventType === 'rename') {
        // File was deleted or renamed
        if (this.internalDeletes.has(jobId)) {
          // This was an internal delete, ignore
          return;
        }

        const existingJob = this.cache.get(jobId);
        if (existingJob) {
          this.cache.delete(jobId);
          logger.info(`Job removed from cache due to external deletion: ${jobId}`);
          this.emit('jobDeleted', existingJob);
        }
      } else if (eventType === 'change') {
        // File was modified, reload it
        try {
          const jobData = readFileSync(filePath, 'utf-8');
          const job = JSON.parse(jobData) as Job;
          const previousJob = this.cache.get(jobId);

          this.cache.set(jobId, job);
          logger.info(`Job reloaded from external change: ${jobId}`);

          if (previousJob) {
            this.emit('jobUpdated', job, previousJob);
          } else {
            this.emit('jobCreated', job);
          }
        } catch (err) {
          logger.warn(`Failed to reload job file ${jobId}: ${err}`);
          // If file is corrupt, remove from cache
          const existingJob = this.cache.get(jobId);
          if (existingJob) {
            this.cache.delete(jobId);
            logger.info(`Job removed from cache due to corrupt file: ${jobId}`);
            this.emit('jobDeleted', existingJob);
          }
        }
      }
    } catch (err) {
      logger.error(`Error handling file event for ${jobId}: ${err}`);
    }
  }
}
