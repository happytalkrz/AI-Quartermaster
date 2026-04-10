import { resolve } from "path";
import { EventEmitter } from "events";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { AQDatabase, DatabaseJob, DatabasePhase, DatabaseLog } from "../store/database.js";
import { JsonMigrator } from "./json-migrator.js";
import type {
  Job,
  JobStatus,
  QueuedJob,
  RunningJob,
  SuccessJob,
  FailureJob,
  CancelledJob,
  ArchivedJob,
  PhaseResultInfo,
  UsageStats
} from "../types/pipeline.js";

const logger = getLogger();

// Re-export Job types for backward compatibility
export type {
  Job,
  JobStatus,
  QueuedJob,
  RunningJob,
  SuccessJob,
  FailureJob,
  CancelledJob,
  ArchivedJob
} from "../types/pipeline.js";

export class JobStore extends EventEmitter {
  private db: AQDatabase;
  private dataDir: string;
  private maxJobs: number;
  // 메모리 캐시: running/queued 상태의 job만 캐싱
  private cache: Map<string, Job> = new Map();
  // 우선순위 맵: jobId → priority (낮을수록 먼저). in-memory only.
  private priorityMap: Map<string, number> = new Map();

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

    // 시작 시 running/queued job을 캐시로 로드
    this.loadActiveJobsToCache();
  }

  /**
   * 시작 시 running/queued 상태의 job들을 캐시로 로드
   */
  private loadActiveJobsToCache(): void {
    try {
      const allDbJobs = this.db.listJobs();
      let loadedCount = 0;

      for (const dbJob of allDbJobs) {
        if (dbJob.status === "queued" || dbJob.status === "running") {
          const job = this.dbJobToJob(dbJob);
          this.cache.set(job.id, job);
          loadedCount++;
        }
      }

      if (loadedCount > 0) {
        logger.info(`Loaded ${loadedCount} active jobs to cache`);
      }
    } catch (err: unknown) {
      logger.error(`Failed to load active jobs to cache: ${getErrorMessage(err)}`);
    }
  }

  /**
   * job을 캐시에 추가 (running/queued 상태만)
   */
  private addToCache(job: Job): void {
    if (job.status === "queued" || job.status === "running") {
      this.cache.set(job.id, job);
      logger.debug(`Job cached: ${job.id} (${job.status})`);
    }
  }

  getAqDb(): AQDatabase {
    return this.db;
  }

  /**
   * 캐시에서 job 제거
   */
  private removeFromCache(id: string): void {
    if (this.cache.delete(id)) {
      logger.debug(`Job removed from cache: ${id}`);
    }
  }

  /**
   * 캐시 업데이트 및 동기화
   */
  private updateCache(job: Job): void {
    if (job.status === "queued" || job.status === "running") {
      // running/queued 상태면 캐시에 추가/업데이트
      this.cache.set(job.id, job);
      logger.debug(`Job cache updated: ${job.id} (${job.status})`);
    } else {
      // 다른 상태로 변경되면 캐시에서 제거
      this.removeFromCache(job.id);
    }
  }

  /**
   * 캐시에서 job 조회
   */
  private getCachedJob(id: string): Job | undefined {
    return this.cache.get(id);
  }

  /**
   * 캐시된 모든 job 조회
   */
  private getCachedJobs(): Job[] {
    return Array.from(this.cache.values());
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
    // 공통 필드들
    const baseFields = {
      id: dbJob.id,
      issueNumber: dbJob.issueNumber,
      repo: dbJob.repo,
      createdAt: dbJob.createdAt,
      lastUpdatedAt: dbJob.lastUpdatedAt,
      currentStep: dbJob.currentStep,
      dependencies: dbJob.dependencies,
      progress: dbJob.progress,
      isRetry: dbJob.isRetry,
      costUsd: dbJob.costUsd,
      totalCostUsd: dbJob.totalCostUsd,
      totalUsage: dbJob.totalUsage as UsageStats | undefined
    };

    // Phase 결과를 phaseResults 배열로 변환
    const phases = this.db.getPhasesByJob(dbJob.id);
    let phaseResults: PhaseResultInfo[] | undefined = undefined;
    if (phases.length > 0) {
      phaseResults = phases.map(phase => ({
        name: phase.phaseName,
        success: phase.success,
        commit: phase.commitHash,
        durationMs: phase.durationMs,
        error: phase.error,
        costUsd: phase.costUsd,
        usage: phase.inputTokens !== undefined ? {
          input_tokens: phase.inputTokens,
          output_tokens: phase.outputTokens || 0,
          cache_creation_input_tokens: phase.cacheCreationInputTokens,
          cache_read_input_tokens: phase.cacheReadInputTokens
        } : undefined
      }));
    }

    // 로그를 logs 배열로 변환
    const logs = this.db.getLogsByJob(dbJob.id);
    const logMessages = logs.length > 0 ? logs.map(log => log.message) : undefined;

    // 상태별로 올바른 타입 반환
    switch (dbJob.status) {
      case "queued":
        return {
          ...baseFields,
          status: "queued",
          logs: logMessages,
          phaseResults
        } as QueuedJob;

      case "running":
        return {
          ...baseFields,
          status: "running",
          startedAt: dbJob.startedAt!,
          error: dbJob.error,
          logs: logMessages,
          phaseResults
        } as RunningJob;

      case "success":
        return {
          ...baseFields,
          status: "success",
          startedAt: dbJob.startedAt!,
          completedAt: dbJob.completedAt!,
          prUrl: dbJob.prUrl!,
          logs: logMessages,
          phaseResults
        } as SuccessJob;

      case "failure":
        return {
          ...baseFields,
          status: "failure",
          startedAt: dbJob.startedAt!,
          completedAt: dbJob.completedAt!,
          error: dbJob.error!,
          prUrl: dbJob.prUrl,
          logs: logMessages,
          phaseResults
        } as FailureJob;

      case "cancelled":
        return {
          ...baseFields,
          status: "cancelled",
          completedAt: dbJob.completedAt!,
          startedAt: dbJob.startedAt,
          error: dbJob.error,
          logs: logMessages,
          phaseResults
        } as CancelledJob;

      case "archived":
        return {
          ...baseFields,
          status: "archived",
          startedAt: dbJob.startedAt,
          completedAt: dbJob.completedAt,
          prUrl: dbJob.prUrl,
          error: dbJob.error,
          logs: logMessages,
          phaseResults
        } as ArchivedJob;

      default:
        throw new Error(`Unknown job status: ${dbJob.status}`);
    }
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
      totalCostUsd: job.totalCostUsd,
      totalUsage: job.totalUsage
    };
  }

  create(issueNumber: number, repo: string, dependencies?: number[], isRetry?: boolean, initialPhaseResults?: PhaseResultInfo[]): QueuedJob {
    const id = `aq-${issueNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const job: QueuedJob = {
      id,
      issueNumber,
      repo,
      status: "queued",
      createdAt: new Date().toISOString(),
      ...(dependencies && dependencies.length > 0 ? { dependencies } : {}),
      ...(isRetry ? { isRetry } : {}),
      ...(initialPhaseResults && initialPhaseResults.length > 0 ? { phaseResults: initialPhaseResults } : {}),
    };

    // SQLite에 저장
    const dbJob = this.jobToDbJob(job);
    this.db.createJob(dbJob);

    // 초기 Phase results가 있다면 별도로 저장
    if (initialPhaseResults && initialPhaseResults.length > 0) {
      for (let index = 0; index < initialPhaseResults.length; index++) {
        const phaseResult = initialPhaseResults[index];
        const dbPhase: DatabasePhase = {
          jobId: id,
          phaseIndex: index,
          phaseName: phaseResult.name,
          success: phaseResult.success,
          commitHash: phaseResult.commit,
          durationMs: phaseResult.durationMs,
          error: phaseResult.error,
          costUsd: phaseResult.costUsd,
          inputTokens: phaseResult.usage?.input_tokens,
          outputTokens: phaseResult.usage?.output_tokens,
          cacheCreationInputTokens: phaseResult.usage?.cache_creation_input_tokens,
          cacheReadInputTokens: phaseResult.usage?.cache_read_input_tokens
        };
        this.db.createPhase(dbPhase);
      }
    }

    // 캐시에 추가 (queued 상태이므로)
    this.addToCache(job);

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
    // 캐시 우선 조회
    const cachedJob = this.getCachedJob(id);
    if (cachedJob) {
      return cachedJob;
    }

    // 캐시 미스 시 SQLite에서 조회
    const dbJob = this.db.getJob(id);
    return dbJob ? this.dbJobToJob(dbJob) : undefined;
  }

  update(id: string, updates: Partial<Job>): Job | undefined {
    const currentJob = this.get(id);
    if (!currentJob) return undefined;

    const previousJob = { ...currentJob };

    // 상태별로 올바른 discriminated union 타입 생성
    let updatedJob: Job;
    const newStatus = updates.status || currentJob.status;

    const baseFields = {
      ...currentJob,
      ...updates,
      lastUpdatedAt: new Date().toISOString()
    };

    switch (newStatus) {
      case "queued":
        updatedJob = {
          id: baseFields.id,
          issueNumber: baseFields.issueNumber,
          repo: baseFields.repo,
          status: "queued",
          createdAt: baseFields.createdAt,
          lastUpdatedAt: baseFields.lastUpdatedAt,
          logs: baseFields.logs,
          currentStep: baseFields.currentStep,
          dependencies: baseFields.dependencies,
          phaseResults: baseFields.phaseResults,
          progress: baseFields.progress,
          isRetry: baseFields.isRetry,
          costUsd: baseFields.costUsd,
          totalCostUsd: baseFields.totalCostUsd,
          totalUsage: baseFields.totalUsage
        } as QueuedJob;
        break;

      case "running":
        updatedJob = {
          id: baseFields.id,
          issueNumber: baseFields.issueNumber,
          repo: baseFields.repo,
          status: "running",
          startedAt: baseFields.startedAt || new Date().toISOString(),
          createdAt: baseFields.createdAt,
          lastUpdatedAt: baseFields.lastUpdatedAt,
          logs: baseFields.logs,
          currentStep: baseFields.currentStep,
          dependencies: baseFields.dependencies,
          phaseResults: baseFields.phaseResults,
          progress: baseFields.progress,
          isRetry: baseFields.isRetry,
          costUsd: baseFields.costUsd,
          totalCostUsd: baseFields.totalCostUsd,
          totalUsage: baseFields.totalUsage,
          error: baseFields.error
        } as RunningJob;
        break;

      case "success":
        updatedJob = {
          id: baseFields.id,
          issueNumber: baseFields.issueNumber,
          repo: baseFields.repo,
          status: "success",
          startedAt: baseFields.startedAt!,
          completedAt: baseFields.completedAt || new Date().toISOString(),
          prUrl: baseFields.prUrl!,
          createdAt: baseFields.createdAt,
          lastUpdatedAt: baseFields.lastUpdatedAt,
          logs: baseFields.logs,
          currentStep: baseFields.currentStep,
          dependencies: baseFields.dependencies,
          phaseResults: baseFields.phaseResults,
          progress: baseFields.progress,
          isRetry: baseFields.isRetry,
          costUsd: baseFields.costUsd,
          totalCostUsd: baseFields.totalCostUsd,
          totalUsage: baseFields.totalUsage
        } as SuccessJob;
        break;

      case "failure":
        updatedJob = {
          id: baseFields.id,
          issueNumber: baseFields.issueNumber,
          repo: baseFields.repo,
          status: "failure",
          startedAt: baseFields.startedAt!,
          completedAt: baseFields.completedAt || new Date().toISOString(),
          error: baseFields.error!,
          prUrl: baseFields.prUrl,
          createdAt: baseFields.createdAt,
          lastUpdatedAt: baseFields.lastUpdatedAt,
          logs: baseFields.logs,
          currentStep: baseFields.currentStep,
          dependencies: baseFields.dependencies,
          phaseResults: baseFields.phaseResults,
          progress: baseFields.progress,
          isRetry: baseFields.isRetry,
          costUsd: baseFields.costUsd,
          totalCostUsd: baseFields.totalCostUsd,
          totalUsage: baseFields.totalUsage
        } as FailureJob;
        break;

      case "cancelled":
        updatedJob = {
          id: baseFields.id,
          issueNumber: baseFields.issueNumber,
          repo: baseFields.repo,
          status: "cancelled",
          completedAt: baseFields.completedAt || new Date().toISOString(),
          startedAt: baseFields.startedAt,
          error: baseFields.error,
          createdAt: baseFields.createdAt,
          lastUpdatedAt: baseFields.lastUpdatedAt,
          logs: baseFields.logs,
          currentStep: baseFields.currentStep,
          dependencies: baseFields.dependencies,
          phaseResults: baseFields.phaseResults,
          progress: baseFields.progress,
          isRetry: baseFields.isRetry,
          costUsd: baseFields.costUsd,
          totalCostUsd: baseFields.totalCostUsd,
          totalUsage: baseFields.totalUsage
        } as CancelledJob;
        break;

      case "archived":
        updatedJob = {
          id: baseFields.id,
          issueNumber: baseFields.issueNumber,
          repo: baseFields.repo,
          status: "archived",
          startedAt: baseFields.startedAt,
          completedAt: baseFields.completedAt,
          prUrl: baseFields.prUrl,
          error: baseFields.error,
          createdAt: baseFields.createdAt,
          lastUpdatedAt: baseFields.lastUpdatedAt,
          logs: baseFields.logs,
          currentStep: baseFields.currentStep,
          dependencies: baseFields.dependencies,
          phaseResults: baseFields.phaseResults,
          progress: baseFields.progress,
          isRetry: baseFields.isRetry,
          costUsd: baseFields.costUsd,
          totalCostUsd: baseFields.totalCostUsd,
          totalUsage: baseFields.totalUsage
        } as ArchivedJob;
        break;

      default:
        throw new Error(`Unknown job status: ${newStatus}`);
    }

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
          error: phaseResult.error,
          costUsd: phaseResult.costUsd,
          inputTokens: phaseResult.usage?.input_tokens,
          outputTokens: phaseResult.usage?.output_tokens,
          cacheCreationInputTokens: phaseResult.usage?.cache_creation_input_tokens,
          cacheReadInputTokens: phaseResult.usage?.cache_read_input_tokens
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

    // 캐시 동기화
    this.updateCache(updatedJob);

    this.emit('jobUpdated', updatedJob, previousJob);
    return updatedJob;
  }

  list(): Job[] {
    const dbJobs = this.db.listJobs();
    const allJobs = dbJobs.map(dbJob => this.dbJobToJob(dbJob));

    // 캐시된 job들로 업데이트 (최신 상태 반영)
    const cachedJobs = this.getCachedJobs();
    const jobMap = new Map<string, Job>();

    // 먼저 SQLite에서 가져온 모든 job을 맵에 추가
    for (const job of allJobs) {
      jobMap.set(job.id, job);
    }

    // 캐시된 job으로 덮어쓰기 (더 최신 상태)
    for (const cachedJob of cachedJobs) {
      jobMap.set(cachedJob.id, cachedJob);
    }

    return Array.from(jobMap.values())
      .map(job => {
        const p = this.priorityMap.get(job.id);
        return p !== undefined ? { ...job, priority: p } : job;
      })
      .sort((a, b) => {
        // queued 잡: priority 오름차순 (낮을수록 먼저), 그 다음 createdAt 내림차순
        if (a.status === "queued" && b.status === "queued") {
          const pa = a.priority ?? Infinity;
          const pb = b.priority ?? Infinity;
          if (pa !== pb) return pa - pb;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  findByIssue(issueNumber: number, repo: string): Job | undefined {
    // 캐시에서 우선 조회 (running/queued 상태만 캐싱됨)
    const cachedJobs = this.getCachedJobs();
    for (const job of cachedJobs) {
      if (job.issueNumber === issueNumber && job.repo === repo) {
        return job;
      }
    }

    // 캐시 미스 시 SQLite에서 조회
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
    const existingJob = this.findAnyByIssue(issueNumber, repo);
    if (!existingJob) return false;

    // queued, running, success 상태의 잡이 있으면 차단
    // failure, cancelled, archived 상태는 재시도 가능하므로 차단하지 않음
    return existingJob.status === "queued" ||
           existingJob.status === "running" ||
           existingJob.status === "success";
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
        // LRU: lastUpdatedAt 기준, 없으면 completedAt → createdAt 순으로 fallback
        const ta = a.lastUpdatedAt
          ? new Date(a.lastUpdatedAt).getTime()
          : a.completedAt
            ? new Date(a.completedAt).getTime()
            : new Date(a.createdAt).getTime();
        const tb = b.lastUpdatedAt
          ? new Date(b.lastUpdatedAt).getTime()
          : b.completedAt
            ? new Date(b.completedAt).getTime()
            : new Date(b.createdAt).getTime();

        // 동일한 timestamp인 경우 createdAt로 tie-break (더 오래된 것 먼저)
        if (ta === tb) {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        return ta - tb; // LRU: 가장 오래전에 사용된 것 먼저
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
      // 캐시에서도 제거
      this.removeFromCache(id);

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
   * queued 잡의 우선순위를 변경한다. (낮을수록 먼저 실행)
   * running 이상의 잡에는 적용되지 않는다.
   */
  updateJobPriority(id: string, priority: number): boolean {
    const job = this.get(id);
    if (!job) return false;
    if (job.status !== "queued") return false;

    this.priorityMap.set(id, priority);
    const updatedJob = { ...job, priority };
    this.updateCache(updatedJob);
    this.emit('jobUpdated', updatedJob, job);
    return true;
  }

  /**
   * 데이터베이스 연결 종료
   */
  close(): void {
    this.db.close();
  }
}