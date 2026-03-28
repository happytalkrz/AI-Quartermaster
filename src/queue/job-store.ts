import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { resolve } from "path";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export type JobStatus = "queued" | "running" | "success" | "failure" | "cancelled";

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
  phaseResults?: Array<{
    name: string;
    success: boolean;
    commit?: string;
    durationMs: number;
    error?: string;
  }>;
}

export class JobStore {
  private dataDir: string;
  private cache: Map<string, Job> = new Map();

  constructor(dataDir: string) {
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

  create(issueNumber: number, repo: string): Job {
    const id = `aq-${issueNumber}-${Date.now()}`;
    const job: Job = {
      id,
      issueNumber,
      repo,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    this.save(job);
    logger.info(`Job created: ${id}`);
    return job;
  }

  get(id: string): Job | undefined {
    return this.cache.get(id);
  }

  update(id: string, updates: Partial<Job>): Job | undefined {
    const job = this.get(id);
    if (!job) return undefined;
    Object.assign(job, updates);
    this.save(job);
    return job;
  }

  list(): Job[] {
    return Array.from(this.cache.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  findByIssue(issueNumber: number, repo: string): Job | undefined {
    return this.list().find(
      j => j.issueNumber === issueNumber && j.repo === repo && (j.status === "queued" || j.status === "running")
    );
  }

  remove(id: string): boolean {
    try {
      unlinkSync(this.jobPath(id));
      this.cache.delete(id);
      logger.info(`Job deleted: ${id}`);
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
