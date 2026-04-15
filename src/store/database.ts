import SQLite from "better-sqlite3";
import { resolve } from "path";
import { mkdirSync } from "fs";
import { getLogger } from "../utils/logger.js";
import { AQM_HOME } from "../config/project-resolver.js";
import type { JobPriority, CostBreakdown, SkipEvent, DiagnosisReport, NotificationType } from "../types/pipeline.js";

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
  cache_hit_ratio: number | null;
  priority: string | null;
  cost_breakdown: string | null;
  trigger_reason: string | null;
  diagnosis: string | null;
}

interface SkipEventRow {
  id: number;
  issue_number: number;
  repo: string;
  reason_code: string;
  reason_message: string;
  source: string;
  created_at: string;
}

interface PhaseRow {
  id: number;
  job_id: string;
  phase_index: number;
  phase_name: string;
  success: number;
  commit_hash: string | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
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

interface NotificationRow {
  id: number;
  job_id: string;
  type: string;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
  repo: string | null;
  issue_number: number | null;
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
  priority?: JobPriority;
  /** 캐시 히트 비율 (0~1). cache_read / (input + cache_read) */
  cacheHitRatio?: number;
  /** phase/model별 비용 세분화 */
  costBreakdown?: CostBreakdown;
  /** 이슈가 처리된 사유 (트리거 원인) */
  triggerReason?: string;
  /** Claude 기반 실패 진단 리포트 (실패 시에만 존재) */
  diagnosis?: DiagnosisReport;
}

export interface DatabasePhase {
  id?: number;
  jobId: string;
  phaseIndex: number;
  phaseName: string;
  success: boolean;
  commitHash?: string;
  durationMs: number;
  startedAt?: string;
  completedAt?: string;
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

export interface DatabaseNotification {
  id?: number;
  jobId: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  repo?: string;
  issueNumber?: number;
}

export interface ListJobsFilter {
  status?: DatabaseJob["status"];
  statuses?: DatabaseJob["status"][];
  excludeStatus?: DatabaseJob["status"];
  repo?: string;
  limit?: number;
  offset?: number;
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
        total_cache_read_input_tokens INTEGER CHECK (total_cache_read_input_tokens >= 0),
        cache_hit_ratio REAL CHECK (cache_hit_ratio >= 0 AND cache_hit_ratio <= 1),
        priority TEXT CHECK (priority IN ('high', 'normal', 'low')),
        cost_breakdown TEXT,
        trigger_reason TEXT,
        diagnosis TEXT
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
        started_at TEXT,
        completed_at TEXT,
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

    // skip_events 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skip_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER NOT NULL,
        repo TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        reason_message TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('webhook', 'polling')),
        created_at TEXT NOT NULL
      )
    `);

    // notifications 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
        created_at TEXT NOT NULL,
        repo TEXT,
        issue_number INTEGER,
        FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
      )
    `);

    // 인덱스 생성
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_issue_repo ON jobs (issue_number, repo);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_status_retry_completed ON jobs (status, is_retry, completed_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_status_last_updated ON jobs (status, last_updated_at, completed_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_phases_job_id ON phases (job_id);
      CREATE INDEX IF NOT EXISTS idx_logs_job_id ON logs (job_id);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs (timestamp);
      CREATE INDEX IF NOT EXISTS idx_skip_events_issue_repo ON skip_events (issue_number, repo);
      CREATE INDEX IF NOT EXISTS idx_skip_events_created_at ON skip_events (created_at);
    `);

    // WAL 모드 활성화 (동시성 향상)
    this.db.exec("PRAGMA journal_mode = WAL;");
    // Foreign key 제약조건 활성화
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.migrateSchema();

    logger.info("Database schema initialized successfully");
  }

  private migrateSchema(): void {
    // jobs 테이블에 priority 컬럼 추가 (기존 DB 마이그레이션)
    const jobColumns = this.db.pragma("table_info(jobs)") as Array<{ name: string }>;
    const hasPriority = jobColumns.some(col => col.name === "priority");
    if (!hasPriority) {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN priority TEXT CHECK (priority IN ('high', 'normal', 'low'))`);
      logger.info("Migration: added priority column to jobs table");
    }

    // phases 테이블에 started_at, completed_at 컬럼 추가 (기존 DB 마이그레이션)
    const phaseColumns = this.db.pragma("table_info(phases)") as Array<{ name: string }>;
    const hasStartedAt = phaseColumns.some(col => col.name === "started_at");
    if (!hasStartedAt) {
      this.db.exec(`ALTER TABLE phases ADD COLUMN started_at TEXT`);
      logger.info("Migration: added started_at column to phases table");
    }
    const hasCompletedAt = phaseColumns.some(col => col.name === "completed_at");
    if (!hasCompletedAt) {
      this.db.exec(`ALTER TABLE phases ADD COLUMN completed_at TEXT`);
      logger.info("Migration: added completed_at column to phases table");
    }

    // jobs 테이블에 cache_hit_ratio 컬럼 추가 (기존 DB 마이그레이션)
    const hasCacheHitRatio = jobColumns.some(col => col.name === "cache_hit_ratio");
    if (!hasCacheHitRatio) {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN cache_hit_ratio REAL CHECK (cache_hit_ratio >= 0 AND cache_hit_ratio <= 1)`);
      logger.info("Migration: added cache_hit_ratio column to jobs table");
    }

    // jobs 테이블에 cost_breakdown 컬럼 추가 (기존 DB 마이그레이션)
    const hasCostBreakdown = jobColumns.some(col => col.name === "cost_breakdown");
    if (!hasCostBreakdown) {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN cost_breakdown TEXT`);
      logger.info("Migration: added cost_breakdown column to jobs table");
    }

    // jobs 테이블에 trigger_reason 컬럼 추가 (기존 DB 마이그레이션)
    const hasTriggerReason = jobColumns.some(col => col.name === "trigger_reason");
    if (!hasTriggerReason) {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN trigger_reason TEXT`);
      logger.info("Migration: added trigger_reason column to jobs table");
    }

    // jobs 테이블에 diagnosis 컬럼 추가 (기존 DB 마이그레이션)
    const hasDiagnosis = jobColumns.some(col => col.name === "diagnosis");
    if (!hasDiagnosis) {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN diagnosis TEXT`);
      logger.info("Migration: added diagnosis column to jobs table");
    }

    // notifications 테이블 컬럼 마이그레이션 (기존 DB 호환성)
    const notifColumns = this.db.pragma("table_info(notifications)") as Array<{ name: string }>;
    if (notifColumns.length > 0) {
      const notifHasIsRead = notifColumns.some(col => col.name === "is_read");
      if (!notifHasIsRead) {
        this.db.exec(`ALTER TABLE notifications ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0`);
        logger.info("Migration: added is_read column to notifications table");
      }
      const notifHasRepo = notifColumns.some(col => col.name === "repo");
      if (!notifHasRepo) {
        this.db.exec(`ALTER TABLE notifications ADD COLUMN repo TEXT`);
        logger.info("Migration: added repo column to notifications table");
      }
      const notifHasIssueNumber = notifColumns.some(col => col.name === "issue_number");
      if (!notifHasIssueNumber) {
        this.db.exec(`ALTER TABLE notifications ADD COLUMN issue_number INTEGER`);
        logger.info("Migration: added issue_number column to notifications table");
      }
    }

    // notifications 인덱스 생성 (컬럼 마이그레이션 이후 안전하게 생성)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_job_id ON notifications (job_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read);
    `);
  }

  // === Job CRUD ===

  createJob(job: DatabaseJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, issue_number, repo, status, created_at, started_at, completed_at,
        pr_url, error, last_updated_at, current_step, dependencies, progress,
        is_retry, cost_usd, total_cost_usd, total_input_tokens, total_output_tokens,
        total_cache_creation_input_tokens, total_cache_read_input_tokens, cache_hit_ratio, priority,
        cost_breakdown, trigger_reason, diagnosis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const params = this.jobToParams(job);
    stmt.run(
      params[0], params[1], params[2], params[3], params[4], params[5], params[6],
      params[7], params[8], params[9], params[10], params[11], params[12], params[13],
      params[14], params[15], params[16], params[17], params[18], params[19], params[20], params[21],
      params[22], params[23], params[24]
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
        total_cache_read_input_tokens = ?, cache_hit_ratio = ?, priority = ?,
        cost_breakdown = ?, trigger_reason = ?, diagnosis = ?
      WHERE id = ?
    `);

    const params = this.jobToParams(merged);
    const changes = stmt.run(
      params[1], params[2], params[3], params[4], params[5], params[6], params[7],
      params[8], params[9], params[10], params[11], params[12], params[13], params[14],
      params[15], params[16], params[17], params[18], params[19], params[20], params[21],
      params[22], params[23], params[24], id
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

  listJobsWithFilter(filter: ListJobsFilter): DatabaseJob[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    } else if (filter.statuses && filter.statuses.length > 0) {
      const placeholders = filter.statuses.map(() => "?").join(", ");
      conditions.push(`status IN (${placeholders})`);
      for (const s of filter.statuses) params.push(s);
    }

    if (filter.excludeStatus) {
      conditions.push("status != ?");
      params.push(filter.excludeStatus);
    }

    if (filter.repo) {
      conditions.push("repo = ?");
      params.push(filter.repo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitPart = filter.limit !== undefined ? "LIMIT ?" : "";
    const offsetPart = filter.offset !== undefined ? "OFFSET ?" : "";

    if (filter.limit !== undefined) params.push(filter.limit);
    if (filter.offset !== undefined) params.push(filter.offset);

    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      ${whereClause}
      ORDER BY created_at DESC
      ${limitPart} ${offsetPart}
    `);

    const rows = stmt.all(...params) as JobRow[];
    return rows.map(row => this.mapRowToJob(row));
  }

  findJobByIssueWithStatus(issueNumber: number, repo: string, status: DatabaseJob["status"]): DatabaseJob | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE issue_number = ? AND repo = ? AND status = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(issueNumber, repo, status) as JobRow | undefined;
    return row ? this.mapRowToJob(row) : undefined;
  }

  findJobByIssueExcludingStatus(issueNumber: number, repo: string, excludeStatus: DatabaseJob["status"]): DatabaseJob | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE issue_number = ? AND repo = ? AND status != ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(issueNumber, repo, excludeStatus) as JobRow | undefined;
    return row ? this.mapRowToJob(row) : undefined;
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

  /**
   * 재시도 대상 실패 job 조회: status=failure, is_retry=0, completed_at <= cutoffIso
   */
  findFailedJobsForRetry(cutoffIso: string): DatabaseJob[] {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'failure'
        AND is_retry = 0
        AND completed_at IS NOT NULL
        AND completed_at <= ?
      ORDER BY completed_at ASC
    `);

    const rows = stmt.all(cutoffIso) as JobRow[];
    return rows.map(row => this.mapRowToJob(row));
  }

  /**
   * prune용 완료 job LRU 조회: success/failure/cancelled 상태, LRU 순 정렬
   */
  listCompletedJobsForPrune(): DatabaseJob[] {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status IN ('success', 'failure', 'cancelled')
      ORDER BY
        COALESCE(last_updated_at, completed_at, created_at) ASC,
        created_at ASC
    `);

    const rows = stmt.all() as JobRow[];
    return rows.map(row => this.mapRowToJob(row));
  }

  /**
   * 전체 job 수 반환
   */
  countJobs(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM jobs").get() as { count: number };
    return row.count;
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
      INSERT INTO phases (job_id, phase_index, phase_name, success, commit_hash, duration_ms, started_at, completed_at, error, cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      phase.jobId,
      phase.phaseIndex,
      phase.phaseName,
      phase.success ? 1 : 0,
      phase.commitHash || null,
      phase.durationMs,
      phase.startedAt || null,
      phase.completedAt || null,
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
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
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
      job.id,               // 0
      job.issueNumber,      // 1
      job.repo,             // 2
      job.status,           // 3
      job.createdAt,        // 4
      job.startedAt || null,    // 5
      job.completedAt || null,  // 6
      job.prUrl || null,        // 7
      job.error || null,        // 8
      job.lastUpdatedAt || null,  // 9
      job.currentStep || null,    // 10
      job.dependencies ? JSON.stringify(job.dependencies) : null,  // 11
      job.progress || null,       // 12
      job.isRetry ? 1 : 0,        // 13
      job.costUsd || null,        // 14
      job.totalCostUsd || null,   // 15
      job.totalUsage?.input_tokens || null,                // 16
      job.totalUsage?.output_tokens || null,               // 17
      job.totalUsage?.cache_creation_input_tokens || null, // 18
      job.totalUsage?.cache_read_input_tokens || null,     // 19
      job.cacheHitRatio ?? null,  // 20
      job.priority || null,       // 21
      job.costBreakdown ? JSON.stringify(job.costBreakdown) : null, // 22
      job.triggerReason || null,  // 23
      job.diagnosis ? JSON.stringify(job.diagnosis) : null, // 24
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
      } : undefined,
      priority: (row.priority as JobPriority | null) ?? undefined,
      cacheHitRatio: row.cache_hit_ratio ?? undefined,
      costBreakdown: row.cost_breakdown ? (JSON.parse(row.cost_breakdown) as CostBreakdown) : undefined,
      triggerReason: row.trigger_reason ?? undefined,
      diagnosis: row.diagnosis ? JSON.parse(row.diagnosis) as DiagnosisReport : undefined,
    };
  }

  // === SkipEvent CRUD ===

  createSkipEvent(event: Omit<SkipEvent, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO skip_events (issue_number, repo, reason_code, reason_message, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      event.issueNumber,
      event.repo,
      event.reasonCode,
      event.reasonMessage,
      event.source,
      event.createdAt
    );

    logger.debug(`SkipEvent created for issue #${event.issueNumber} (${event.repo}): ${event.reasonCode}`);
    return result.lastInsertRowid as number;
  }

  listSkipEvents(issueNumber?: number, repo?: string, limit?: number): SkipEvent[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (issueNumber !== undefined) {
      conditions.push("issue_number = ?");
      params.push(issueNumber);
    }
    if (repo !== undefined) {
      conditions.push("repo = ?");
      params.push(repo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = limit !== undefined ? `LIMIT ${limit}` : "";

    const stmt = this.db.prepare(`
      SELECT * FROM skip_events
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause}
    `);

    const rows = stmt.all(...params) as SkipEventRow[];
    return rows.map(row => this.mapRowToSkipEvent(row));
  }

  pruneOldSkipEvents(beforeIso: string): number {
    const stmt = this.db.prepare("DELETE FROM skip_events WHERE created_at < ?");
    const changes = stmt.run(beforeIso).changes;
    if (changes > 0) {
      logger.info(`Pruned ${changes} old skip events before ${beforeIso}`);
    }
    return changes;
  }

  private mapRowToSkipEvent(row: SkipEventRow): SkipEvent {
    return {
      id: row.id,
      issueNumber: row.issue_number,
      repo: row.repo,
      reasonCode: row.reason_code,
      reasonMessage: row.reason_message,
      source: row.source as SkipEvent["source"],
      createdAt: row.created_at,
    };
  }

  // === Notification CRUD ===

  createNotification(notification: Omit<DatabaseNotification, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO notifications (job_id, type, title, message, is_read, created_at, repo, issue_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      notification.jobId,
      notification.type,
      notification.title,
      notification.message,
      notification.isRead ? 1 : 0,
      notification.createdAt,
      notification.repo ?? null,
      notification.issueNumber ?? null
    );

    logger.debug(`Notification created for job ${notification.jobId}: ${notification.type}`);
    return result.lastInsertRowid as number;
  }

  listNotifications(filter?: { isRead?: boolean; type?: string; limit?: number; offset?: number }): DatabaseNotification[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter?.isRead !== undefined) {
      conditions.push("is_read = ?");
      params.push(filter.isRead ? 1 : 0);
    }

    if (filter?.type !== undefined) {
      conditions.push("type = ?");
      params.push(filter.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitPart = filter?.limit !== undefined ? "LIMIT ?" : "";
    const offsetPart = filter?.offset !== undefined ? "OFFSET ?" : "";

    if (filter?.limit !== undefined) params.push(filter.limit);
    if (filter?.offset !== undefined) params.push(filter.offset);

    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      ${whereClause}
      ORDER BY created_at DESC
      ${limitPart} ${offsetPart}
    `);

    const rows = stmt.all(...params) as NotificationRow[];
    return rows.map(row => this.mapRowToNotification(row));
  }

  countUnreadNotifications(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0").get() as { count: number };
    return row.count;
  }

  countNotifications(filter?: { isRead?: boolean; type?: string }): number {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter?.isRead !== undefined) {
      conditions.push("is_read = ?");
      params.push(filter.isRead ? 1 : 0);
    }

    if (filter?.type !== undefined) {
      conditions.push("type = ?");
      params.push(filter.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM notifications ${whereClause}`).get(...params) as { count: number };
    return row.count;
  }

  markNotificationRead(id: number): boolean {
    const changes = this.db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id).changes;
    return changes > 0;
  }

  markAllNotificationsRead(): number {
    const changes = this.db.prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0").run().changes;
    logger.debug(`Marked ${changes} notifications as read`);
    return changes;
  }

  private mapRowToNotification(row: NotificationRow): DatabaseNotification {
    return {
      id: row.id,
      jobId: row.job_id,
      type: row.type as NotificationType,
      title: row.title,
      message: row.message,
      isRead: row.is_read === 1,
      createdAt: row.created_at,
      repo: row.repo ?? undefined,
      issueNumber: row.issue_number ?? undefined,
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

  // Raw SQLite 접근 (queries.ts 전용)
  getDb(): SQLite.Database {
    return this.db;
  }
}