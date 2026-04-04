import SQLite from "better-sqlite3";
import { resolve } from "path";
import { mkdirSync } from "fs";
import { getLogger } from "../utils/logger.js";
import { AQM_HOME } from "../config/project-resolver.js";

const logger = getLogger();

// SQLite row types (snake_case columns)
interface JobRow {
  id: string;
  issue_number: number;
  repo: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  pr_url: string | null;
  error: string | null;
  last_updated_at: string | null;
  current_step: string | null;
  dependencies: string | null;
  progress: number | null;
  is_retry: number;
  cost_usd: number | null;
  total_cost_usd: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cache_creation_input_tokens: number | null;
  total_cache_read_input_tokens: number | null;
}

interface PhaseRow {
  id: number;
  job_id: string;
  phase_index: number;
  phase_name: string;
  success: number;
  commit_hash: string | null;
  duration_ms: number | null;
  error: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

interface LogRow {
  id: number;
  job_id: string;
  message: string;
  timestamp: string;
}

export interface DatabaseJob {
  id: string;
  issueNumber: number;
  repo: string;
  status: "queued" | "running" | "success" | "failure" | "cancelled" | "archived";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  prUrl?: string;
  error?: string;
  lastUpdatedAt?: string;
  currentStep?: string;
  dependencies?: number[];
  progress?: number;
  isRetry?: boolean;
  costUsd?: number;
  totalCostUsd?: number;
  totalUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface DatabasePhase {
  id?: number;
  jobId: string;
  phaseIndex: number;
  phaseName: string;
  success: boolean;
  commitHash?: string;
  durationMs: number;
  error?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface DatabaseLog {
  id?: number;
  jobId: string;
  message: string;
  timestamp: string;
}

export class AQDatabase {
  private db: SQLite.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || resolve(AQM_HOME, "aqm.db");

    // DB 디렉토리가 없으면 생성
    mkdirSync(resolve(finalPath, ".."), { recursive: true });

    logger.info(`Opening database at: ${finalPath}`);
    this.db = new SQLite(finalPath);

    this.initSchema();
  }

  private initSchema(): void {
    logger.debug("Initializing database schema");

    // jobs 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        issue_number INTEGER NOT NULL,
        repo TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failure', 'cancelled', 'archived')),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        pr_url TEXT,
        error TEXT,
        last_updated_at TEXT,
        current_step TEXT,
        dependencies TEXT, -- JSON array
        progress INTEGER CHECK (progress >= 0 AND progress <= 100),
        is_retry INTEGER CHECK (is_retry IN (0, 1)),
        cost_usd REAL CHECK (cost_usd >= 0),
        total_cost_usd REAL CHECK (total_cost_usd >= 0),
        total_input_tokens INTEGER CHECK (total_input_tokens >= 0),
        total_output_tokens INTEGER CHECK (total_output_tokens >= 0),
        total_cache_creation_input_tokens INTEGER CHECK (total_cache_creation_input_tokens >= 0),
        total_cache_read_input_tokens INTEGER CHECK (total_cache_read_input_tokens >= 0)
      )
    `);

    // phases 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        phase_index INTEGER NOT NULL,
        phase_name TEXT NOT NULL,
        success INTEGER NOT NULL CHECK (success IN (0, 1)),
        commit_hash TEXT,
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        error TEXT,
        cost_usd REAL CHECK (cost_usd >= 0),
        input_tokens INTEGER CHECK (input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens >= 0),
        cache_creation_input_tokens INTEGER CHECK (cache_creation_input_tokens >= 0),
        cache_read_input_tokens INTEGER CHECK (cache_read_input_tokens >= 0),
        FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
      )
    `);

    // logs 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
      )
    `);

    // 인덱스 생성
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_issue_repo ON jobs (issue_number, repo);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);
      CREATE INDEX IF NOT EXISTS idx_phases_job_id ON phases (job_id);
      CREATE INDEX IF NOT EXISTS idx_logs_job_id ON logs (job_id);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs (timestamp);
    `);

    // WAL 모드 활성화 (동시성 향상)
    this.db.exec("PRAGMA journal_mode = WAL;");
    // Foreign key 제약조건 활성화
    this.db.exec("PRAGMA foreign_keys = ON;");

    logger.info("Database schema initialized successfully");
  }

  // === Job CRUD ===

  createJob(job: DatabaseJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, issue_number, repo, status, created_at, started_at, completed_at,
        pr_url, error, last_updated_at, current_step, dependencies, progress,
        is_retry, cost_usd, total_cost_usd, total_input_tokens, total_output_tokens,
        total_cache_creation_input_tokens, total_cache_read_input_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const params = this.jobToParams(job);
    stmt.run(
      params[0], params[1], params[2], params[3], params[4], params[5], params[6],
      params[7], params[8], params[9], params[10], params[11], params[12], params[13],
      params[14], params[15], params[16], params[17], params[18], params[19]
    );

    logger.debug(`Job created: ${job.id}`);
  }

  getJob(id: string): DatabaseJob | undefined {
    const stmt = this.db.prepare("SELECT * FROM jobs WHERE id = ?");
    const row = stmt.get(id) as JobRow | undefined;
    return row ? this.mapRowToJob(row) : undefined;
  }

  updateJob(id: string, updates: Partial<DatabaseJob>): boolean {
    const job = this.getJob(id);
    if (!job) return false;

    const merged = { ...job, ...updates };

    const stmt = this.db.prepare(`
      UPDATE jobs SET
        issue_number = ?, repo = ?, status = ?, created_at = ?,
        started_at = ?, completed_at = ?, pr_url = ?, error = ?,
        last_updated_at = ?, current_step = ?, dependencies = ?,
        progress = ?, is_retry = ?, cost_usd = ?, total_cost_usd = ?,
        total_input_tokens = ?, total_output_tokens = ?, total_cache_creation_input_tokens = ?,
        total_cache_read_input_tokens = ?
      WHERE id = ?
    `);

    const params = this.jobToParams(merged);
    const changes = stmt.run(
      params[1], params[2], params[3], params[4], params[5], params[6], params[7],
      params[8], params[9], params[10], params[11], params[12], params[13], params[14],
      params[15], params[16], params[17], params[18], params[19], id
    ).changes;

    if (changes > 0) {
      logger.debug(`Job updated: ${id}`);
      return true;
    }
    return false;
  }

  listJobs(limit?: number, offset?: number): DatabaseJob[] {
    const limitClause = limit ? `LIMIT ${limit}` : "";
    const offsetClause = offset ? `OFFSET ${offset}` : "";

    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      ORDER BY created_at DESC
      ${limitClause} ${offsetClause}
    `);

    const rows = stmt.all() as JobRow[];
    return rows.map(row => this.mapRowToJob(row));
  }

  findJobByIssue(issueNumber: number, repo: string): DatabaseJob | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE issue_number = ? AND repo = ?
      AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(issueNumber, repo) as JobRow | undefined;
    return row ? this.mapRowToJob(row) : undefined;
  }

  deleteJob(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM jobs WHERE id = ?");
    const changes = stmt.run(id).changes;

    if (changes > 0) {
      logger.debug(`Job deleted: ${id}`);
      return true;
    }
    return false;
  }

  // === Phase CRUD ===

  createPhase(phase: DatabasePhase): number {
    // 같은 job_id + phase_index 기존 레코드 제거 (retry/재시작 시 중복 방지)
    this.db.prepare("DELETE FROM phases WHERE job_id = ? AND phase_index = ?").run(phase.jobId, phase.phaseIndex);

    const stmt = this.db.prepare(`
      INSERT INTO phases (job_id, phase_index, phase_name, success, commit_hash, duration_ms, error, cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      phase.jobId,
      phase.phaseIndex,
      phase.phaseName,
      phase.success ? 1 : 0,
      phase.commitHash || null,
      phase.durationMs,
      phase.error || null,
      phase.costUsd || null,
      phase.inputTokens || null,
      phase.outputTokens || null,
      phase.cacheCreationInputTokens || null,
      phase.cacheReadInputTokens || null
    );

    logger.debug(`Phase created for job ${phase.jobId}: ${phase.phaseName}`);
    return result.lastInsertRowid as number;
  }

  getPhasesByJob(jobId: string): DatabasePhase[] {
    const stmt = this.db.prepare("SELECT * FROM phases WHERE job_id = ? ORDER BY phase_index");
    const rows = stmt.all(jobId) as PhaseRow[];

    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      phaseIndex: row.phase_index,
      phaseName: row.phase_name,
      success: row.success === 1,
      commitHash: row.commit_hash ?? undefined,
      durationMs: row.duration_ms ?? 0,
      error: row.error ?? undefined,
      costUsd: row.cost_usd ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      cacheCreationInputTokens: row.cache_creation_input_tokens ?? undefined,
      cacheReadInputTokens: row.cache_read_input_tokens ?? undefined
    }));
  }

  // === Log CRUD ===

  createLog(log: DatabaseLog): number {
    // Enforce max 500 logs per job to prevent DB bloat
    const count = this.db.prepare("SELECT COUNT(*) as c FROM logs WHERE job_id = ?").get(log.jobId) as { c: number } | undefined;
    if (count && count.c >= 500) {
      // Delete oldest logs keeping 400
      this.db.prepare("DELETE FROM logs WHERE job_id = ? AND id NOT IN (SELECT id FROM logs WHERE job_id = ? ORDER BY id DESC LIMIT 400)").run(log.jobId, log.jobId);
    }

    const stmt = this.db.prepare(`
      INSERT INTO logs (job_id, message, timestamp)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(log.jobId, log.message, log.timestamp);
    return result.lastInsertRowid as number;
  }

  getLogsByJob(jobId: string, limit?: number): DatabaseLog[] {
    const limitClause = limit ? `LIMIT ${limit}` : "";

    const stmt = this.db.prepare(`
      SELECT * FROM logs
      WHERE job_id = ?
      ORDER BY timestamp DESC
      ${limitClause}
    `);

    const rows = stmt.all(jobId) as LogRow[];
    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      message: row.message,
      timestamp: row.timestamp
    }));
  }

  // === Utility ===

  private jobToParams(job: DatabaseJob): (string | number | null)[] {
    return [
      job.id,
      job.issueNumber,
      job.repo,
      job.status,
      job.createdAt,
      job.startedAt || null,
      job.completedAt || null,
      job.prUrl || null,
      job.error || null,
      job.lastUpdatedAt || null,
      job.currentStep || null,
      job.dependencies ? JSON.stringify(job.dependencies) : null,
      job.progress || null,
      job.isRetry ? 1 : 0,
      job.costUsd || null,
      job.totalCostUsd || null,
      job.totalUsage?.input_tokens || null,
      job.totalUsage?.output_tokens || null,
      job.totalUsage?.cache_creation_input_tokens || null,
      job.totalUsage?.cache_read_input_tokens || null
    ];
  }

  private mapRowToJob(row: JobRow): DatabaseJob {
    return {
      id: row.id,
      issueNumber: row.issue_number,
      repo: row.repo,
      status: row.status as DatabaseJob["status"],
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      prUrl: row.pr_url ?? undefined,
      error: row.error ?? undefined,
      lastUpdatedAt: row.last_updated_at ?? undefined,
      currentStep: row.current_step ?? undefined,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : undefined,
      progress: row.progress ?? undefined,
      isRetry: row.is_retry === 1,
      costUsd: row.cost_usd ?? undefined,
      totalCostUsd: row.total_cost_usd ?? undefined,
      totalUsage: (row.total_input_tokens !== null && row.total_output_tokens !== null) ? {
        input_tokens: row.total_input_tokens,
        output_tokens: row.total_output_tokens,
        cache_creation_input_tokens: row.total_cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: row.total_cache_read_input_tokens ?? undefined
      } : undefined
    };
  }

  close(): void {
    logger.info("Closing database connection");
    this.db.close();
  }

  // 트랜잭션 지원
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}