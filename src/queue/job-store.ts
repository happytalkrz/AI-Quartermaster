import { resolve } from "path";
import { EventEmitter } from "events";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { AQDatabase, DatabaseJob, DatabasePhase, DatabaseLog } from "../store/database.js";
import { JsonMigrator } from "./json-migrator.js";

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
  private db: AQDatabase;
  private dataDir: string;
  private maxJobs: number;

  constructor(dataDir: string, maxJobs: number = 1000) {
    super();
    this.dataDir = dataDir;
    this.maxJobs = maxJobs;

    // SQLite 데이터베이스 초기화
    this.db = new AQDatabase(resolve(dataDir, "aqm.db"));

    // JSON → SQLite 자동 마이그레이션 (백그라운드에서 실행)
    this.migrateFromJson().catch(err => {
      logger.error(`JSON migration failed: ${getErrorMessage(err)}`);
    });
  }

  /**
   * 기존 JSON 파일들을 SQLite로 자동 마이그레이션
   */
  private async migrateFromJson(): Promise<void> {
    try {
      // JsonMigrator가 별도 DB 인스턴스를 사용하도록 함 (DB 파일 경로만 전달)
      const dbPath = resolve(this.dataDir, "aqm.db");
      const migrator = new JsonMigrator(new AQDatabase(dbPath), resolve(this.dataDir, "jobs"));
      const stats = await migrator.migrate(false);

      if (stats.migratedJobs > 0) {
        logger.info(`JSON migration completed: ${stats.migratedJobs} jobs migrated`);
      }

      migrator.close(); // 별도 DB 인스턴스 닫기
    } catch (err: unknown) {
      logger.error(`JSON migration failed: ${getErrorMessage(err)}`);
    }
  }

  /**
   * DatabaseJob을 Job 인터페이스로 변환
   */
  private dbJobToJob(dbJob: DatabaseJob): Job {
    const job: Job = {
      id: dbJob.id,
      issueNumber: dbJob.issueNumber,
      repo: dbJob.repo,
      status: dbJob.status,
      createdAt: dbJob.createdAt,
      startedAt: dbJob.startedAt,
      completedAt: dbJob.completedAt,
      prUrl: dbJob.prUrl,
      error: dbJob.error,
      lastUpdatedAt: dbJob.lastUpdatedAt,
      currentStep: dbJob.currentStep,
      dependencies: dbJob.dependencies,
      progress: dbJob.progress,
      isRetry: dbJob.isRetry,
      costUsd: dbJob.costUsd,
      totalCostUsd: dbJob.totalCostUsd
    };

    // Phase 결과를 phaseResults 배열로 변환
    const phases = this.db.getPhasesByJob(dbJob.id);
    if (phases.length > 0) {
      job.phaseResults = phases.map(phase => ({
        name: phase.phaseName,
        success: phase.success,
        commit: phase.commitHash,
        durationMs: phase.durationMs,
        error: phase.error
      }));
    }

    // 로그를 logs 배열로 변환
    const logs = this.db.getLogsByJob(dbJob.id);
    if (logs.length > 0) {
      job.logs = logs.map(log => log.message);
    }

    return job;
  }

  /**
   * Job을 DatabaseJob으로 변환
   */
  private jobToDbJob(job: Job): DatabaseJob {
    return {
      id: job.id,
      issueNumber: job.issueNumber,
      repo: job.repo,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      prUrl: job.prUrl,
      error: job.error,
      lastUpdatedAt: job.lastUpdatedAt,
      currentStep: job.currentStep,
      dependencies: job.dependencies,
      progress: job.progress,
      isRetry: job.isRetry,
      costUsd: job.costUsd,
      totalCostUsd: job.totalCostUsd
    };
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

    // SQLite에 저장
    const dbJob = this.jobToDbJob(job);
    this.db.createJob(dbJob);

    logger.info(`Job created: ${id}`);
    this.emit('jobCreated', job);

    // Auto-prune if needed
    const allJobs = this.db.listJobs();
    if (allJobs.length > this.maxJobs) {
      const pruned = this.prune(this.maxJobs);
      if (pruned > 0) {
        logger.info(`Auto-pruned ${pruned} jobs due to cache size limit (${this.maxJobs})`);
      }
    }

    return job;
  }

  get(id: string): Job | undefined {
    const dbJob = this.db.getJob(id);
    return dbJob ? this.dbJobToJob(dbJob) : undefined;
  }

  update(id: string, updates: Partial<Job>): Job | undefined {
    const currentJob = this.get(id);
    if (!currentJob) return undefined;

    const previousJob = { ...currentJob };
    const updatedJob = { ...currentJob, ...updates };

    // Phase results가 업데이트되었다면 별도로 처리
    if (updates.phaseResults) {
      // 기존 phases 삭제 (외래키 제약조건으로 자동 삭제됨)
      // 새로운 phases 추가
      for (let index = 0; index < updates.phaseResults.length; index++) {
        const phaseResult = updates.phaseResults[index];
        const dbPhase: DatabasePhase = {
          jobId: id,
          phaseIndex: index,
          phaseName: phaseResult.name,
          success: phaseResult.success,
          commitHash: phaseResult.commit,
          durationMs: phaseResult.durationMs,
          error: phaseResult.error
        };
        this.db.createPhase(dbPhase);
      }
    }

    // Logs가 업데이트되었다면 별도로 처리
    if (updates.logs) {
      // 기존 logs 삭제하고 새로 추가하는 대신, 추가만 수행
      // (보통 logs는 append only)
      for (const logMessage of updates.logs) {
        const dbLog: DatabaseLog = {
          jobId: id,
          message: logMessage,
          timestamp: new Date().toISOString()
        };
        this.db.createLog(dbLog);
      }
    }

    // Job 기본 정보 업데이트
    const dbJob = this.jobToDbJob(updatedJob);
    this.db.updateJob(id, dbJob);

    this.emit('jobUpdated', updatedJob, previousJob);
    return updatedJob;
  }

  list(): Job[] {
    const dbJobs = this.db.listJobs();
    return dbJobs.map(dbJob => this.dbJobToJob(dbJob));
  }

  findByIssue(issueNumber: number, repo: string): Job | undefined {
    const dbJob = this.db.findJobByIssue(issueNumber, repo);
    return dbJob ? this.dbJobToJob(dbJob) : undefined;
  }

  findCompletedByIssue(issueNumber: number, repo: string): Job | undefined {
    const allJobs = this.list();
    for (const job of allJobs) {
      if (job.issueNumber === issueNumber && job.repo === repo && job.status === "success") {
        return job;
      }
    }
    return undefined;
  }

  findAnyByIssue(issueNumber: number, repo: string): Job | undefined {
    const allJobs = this.list();
    for (const job of allJobs) {
      if (job.issueNumber === issueNumber && job.repo === repo && job.status !== "archived") {
        return job;
      }
    }
    return undefined;
  }

  shouldBlockRepickup(issueNumber: number, repo: string): boolean {
    return this.findCompletedByIssue(issueNumber, repo) !== undefined;
  }

  findFailedJobsForRetry(): Job[] {
    const now = Date.now();
    const RETRY_DELAY_MS = 10 * 60 * 1000; // 10분 대기 후 재시도

    const allJobs = this.list();
    return allJobs.filter(job => {
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
    const updatedJob = this.update(id, { status: "archived" });

    if (updatedJob) {
      logger.info(`Job archived: ${id}`);
      this.emit('jobArchived', updatedJob, previousJob);
      return true;
    }
    return false;
  }

  prune(maxJobs: number): number {
    const allJobs = this.list();
    if (allJobs.length <= maxJobs) return 0;

    const completed = allJobs
      .filter(j => j.status === "success" || j.status === "failure" || j.status === "cancelled")
      .sort((a, b) => {
        const ta = a.completedAt ? new Date(a.completedAt).getTime() : new Date(a.createdAt).getTime();
        const tb = b.completedAt ? new Date(b.completedAt).getTime() : new Date(b.createdAt).getTime();
        return ta - tb; // oldest first
      });

    const excess = allJobs.length - maxJobs;
    const toDelete = completed.slice(0, excess);

    for (const job of toDelete) {
      this.remove(job.id);
    }

    if (toDelete.length > 0) {
      logger.info(`Job pruning: ${toDelete.length}개 완료 작업 삭제 (총 ${allJobs.length} → ${allJobs.length - toDelete.length})`);
    }

    return toDelete.length;
  }

  remove(id: string): boolean {
    const job = this.get(id);
    const success = this.db.deleteJob(id);

    if (success) {
      logger.info(`Job deleted: ${id}`);
      if (job) {
        this.emit('jobDeleted', job);
      }
      return true;
    }
    return false;
  }

  getCostStats(repo?: string): {
    totalCostUsd: number;
    avgCostUsd: number;
    jobCount: number;
    topExpensiveJobs: Array<{ id: string; issueNumber: number; totalCostUsd: number; repo: string }>;
  } {
    const allJobs = this.list();
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

  /**
   * 파일시스템 감시 시작 (SQLite 전환 후 no-op)
   */
  startWatching(): void {
    // SQLite 기반으로 전환하면서 파일시스템 감시는 불필요
    // 호환성을 위해 메서드는 유지하지만 실제 동작은 하지 않음
    logger.debug("startWatching called but no-op in SQLite mode");
  }

  /**
   * 파일시스템 감시 중지 (SQLite 전환 후 no-op)
   */
  stopWatching(): void {
    // SQLite 기반으로 전환하면서 파일시스템 감시는 불필요
    // 호환성을 위해 메서드는 유지하지만 실제 동작은 하지 않음
    logger.debug("stopWatching called but no-op in SQLite mode");
  }

  /**
   * 데이터베이스 연결 종료
   */
  close(): void {
    this.db.close();
  }
}