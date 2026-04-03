import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
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

  constructor(dataDir: string) {
    super();
    this.dataDir = resolve(dataDir, "jobs");
    mkdirSync(this.dataDir, { recursive: true });
    this.loadAll();
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
      unlinkSync(this.jobPath(id));
      this.cache.delete(id);
      logger.info(`Job deleted: ${id}`);
      if (job) {
        this.emit('jobDeleted', job);
      }
      return true;
    } catch (err: any) {
      if (err?.code === "ENOENT") return false;
      return false;
    }
  }

  private save(job: Job): void {
    writeFileSync(this.jobPath(job.id), JSON.stringify(job, null, 2));
    this.cache.set(job.id, job);
  }
}
