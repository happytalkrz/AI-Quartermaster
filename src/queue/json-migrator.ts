import { readFileSync, readdirSync, mkdirSync, renameSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { AQM_HOME } from "../config/project-resolver.js";
import { AQDatabase, DatabaseJob, DatabasePhase, DatabaseLog } from "../store/database.js";
import type { Job } from "./job-store.js";

const logger = getLogger();

export interface MigrationStats {
  totalJsonFiles: number;
  migratedJobs: number;
  migratedPhases: number;
  migratedLogs: number;
  skippedFiles: number;
  errors: string[];
}

export class JsonMigrator {
  private db: AQDatabase;
  private jobsDir: string;
  private migratedDir: string;

  constructor(database?: AQDatabase, jobsDir?: string) {
    this.db = database || new AQDatabase();
    this.jobsDir = jobsDir || resolve(AQM_HOME, "jobs");
    this.migratedDir = resolve(this.jobsDir, ".migrated");
  }

  /**
   * JSON 파일들을 SQLite로 마이그레이션합니다.
   * @param dryRun - true면 실제 마이그레이션 없이 분석만 수행
   * @returns 마이그레이션 통계
   */
  async migrate(dryRun: boolean = false): Promise<MigrationStats> {
    const stats: MigrationStats = {
      totalJsonFiles: 0,
      migratedJobs: 0,
      migratedPhases: 0,
      migratedLogs: 0,
      skippedFiles: 0,
      errors: []
    };

    logger.info(`Starting JSON to SQLite migration (dryRun: ${dryRun})`);
    logger.info(`Jobs directory: ${this.jobsDir}`);

    if (!existsSync(this.jobsDir)) {
      logger.info("Jobs directory does not exist, nothing to migrate");
      return stats;
    }

    // .migrated 디렉토리 준비
    if (!dryRun) {
      mkdirSync(this.migratedDir, { recursive: true });
    }

    // JSON 파일 목록 수집
    const jsonFiles = this.collectJsonFiles();
    stats.totalJsonFiles = jsonFiles.length;
    logger.info(`Found ${jsonFiles.length} JSON files to process`);

    if (jsonFiles.length === 0) {
      logger.info("No JSON files found to migrate");
      return stats;
    }

    // 트랜잭션으로 마이그레이션 수행
    if (!dryRun) {
      this.db.transaction(() => {
        for (const filePath of jsonFiles) {
          try {
            this.migrateJobFile(filePath, stats);
          } catch (err: unknown) {
            const errorMsg = `Failed to migrate ${basename(filePath)}: ${getErrorMessage(err)}`;
            logger.error(errorMsg);
            stats.errors.push(errorMsg);
            stats.skippedFiles++;
          }
        }
      });
    } else {
      // Dry run: 파싱만 테스트
      for (const filePath of jsonFiles) {
        try {
          this.validateJobFile(filePath, stats);
        } catch (err: unknown) {
          const errorMsg = `Failed to validate ${basename(filePath)}: ${getErrorMessage(err)}`;
          logger.warn(errorMsg);
          stats.errors.push(errorMsg);
          stats.skippedFiles++;
        }
      }
    }

    if (!dryRun && stats.migratedJobs > 0) {
      // 마이그레이션된 파일들을 .migrated 디렉토리로 이동
      this.moveJsonFiles(jsonFiles, stats);
    }

    this.logMigrationSummary(stats, dryRun);
    return stats;
  }

  /**
   * JSON 파일 목록을 수집합니다.
   */
  private collectJsonFiles(): string[] {
    try {
      return readdirSync(this.jobsDir)
        .filter(filename => filename.endsWith(".json") && !filename.startsWith("."))
        .map(filename => resolve(this.jobsDir, filename))
        .sort(); // 일관된 순서로 처리
    } catch (err: unknown) {
      logger.error(`Failed to read jobs directory: ${getErrorMessage(err)}`);
      return [];
    }
  }

  /**
   * 개별 Job JSON 파일을 마이그레이션합니다.
   */
  private migrateJobFile(filePath: string, stats: MigrationStats): void {
    const job = this.parseJobFile(filePath);

    // 이미 마이그레이션된 Job인지 확인
    if (this.db.getJob(job.id)) {
      logger.debug(`Job ${job.id} already exists in database, skipping`);
      stats.skippedFiles++;
      return;
    }

    // Job 기본 정보를 database 형식으로 변환
    const dbJob = this.convertToDatabaseJob(job);
    this.db.createJob(dbJob);
    stats.migratedJobs++;

    // Phase 결과들을 phases 테이블로 마이그레이션
    if (job.phaseResults && job.phaseResults.length > 0) {
      for (let index = 0; index < job.phaseResults.length; index++) {
        const phaseResult = job.phaseResults[index];
        const dbPhase: DatabasePhase = {
          jobId: job.id,
          phaseIndex: index,
          phaseName: phaseResult.name,
          success: phaseResult.success,
          commitHash: phaseResult.commit,
          durationMs: phaseResult.durationMs,
          error: phaseResult.error
        };
        this.db.createPhase(dbPhase);
        stats.migratedPhases++;
      }
    }

    // 로그들을 logs 테이블로 마이그레이션
    if (job.logs && job.logs.length > 0) {
      for (const logMessage of job.logs) {
        const dbLog: DatabaseLog = {
          jobId: job.id,
          message: logMessage,
          timestamp: job.createdAt // 로그에 개별 타임스탬프가 없으므로 job 생성시간 사용
        };
        this.db.createLog(dbLog);
        stats.migratedLogs++;
      }
    }

    logger.debug(`Migrated job ${job.id}: ${job.phaseResults?.length || 0} phases, ${job.logs?.length || 0} logs`);
  }

  /**
   * Dry run용: JSON 파일 파싱만 검증합니다.
   */
  private validateJobFile(filePath: string, stats: MigrationStats): void {
    const job = this.parseJobFile(filePath);

    // 기본 검증
    if (!job.id || !job.issueNumber || !job.repo || !job.status || !job.createdAt) {
      throw new Error("Missing required job fields");
    }

    stats.migratedJobs++;
    stats.migratedPhases += job.phaseResults?.length || 0;
    stats.migratedLogs += job.logs?.length || 0;
  }

  /**
   * JSON 파일을 파싱하여 Job 객체로 변환합니다.
   */
  private parseJobFile(filePath: string): Job {
    try {
      const content = readFileSync(filePath, "utf-8");
      const job = JSON.parse(content) as Job;

      // 기본 필드 검증
      if (!job.id) {
        throw new Error("Job ID is missing");
      }
      if (typeof job.issueNumber !== "number") {
        throw new Error("Job issueNumber is missing or invalid");
      }
      if (!job.repo) {
        throw new Error("Job repo is missing");
      }

      return job;
    } catch (err: unknown) {
      throw new Error(`Failed to parse JSON file ${basename(filePath)}: ${getErrorMessage(err)}`);
    }
  }

  /**
   * Job 객체를 DatabaseJob 형식으로 변환합니다.
   */
  private convertToDatabaseJob(job: Job): DatabaseJob {
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

  /**
   * 마이그레이션된 JSON 파일들을 .migrated 디렉토리로 이동합니다.
   */
  private moveJsonFiles(jsonFiles: string[], stats: MigrationStats): void {
    logger.info(`Moving ${jsonFiles.length} JSON files to ${this.migratedDir}`);

    let movedCount = 0;
    for (const filePath of jsonFiles) {
      try {
        const filename = basename(filePath);
        const targetPath = resolve(this.migratedDir, filename);

        // 중복 파일명 처리
        let finalTargetPath = targetPath;
        let counter = 1;
        while (existsSync(finalTargetPath)) {
          const nameWithoutExt = filename.replace(".json", "");
          finalTargetPath = resolve(this.migratedDir, `${nameWithoutExt}.${counter}.json`);
          counter++;
        }

        renameSync(filePath, finalTargetPath);
        movedCount++;
        logger.debug(`Moved ${filename} to ${basename(finalTargetPath)}`);
      } catch (err: unknown) {
        const errorMsg = `Failed to move ${basename(filePath)}: ${getErrorMessage(err)}`;
        logger.error(errorMsg);
        stats.errors.push(errorMsg);
      }
    }

    logger.info(`Successfully moved ${movedCount}/${jsonFiles.length} JSON files`);
  }

  /**
   * 마이그레이션 결과를 로깅합니다.
   */
  private logMigrationSummary(stats: MigrationStats, dryRun: boolean): void {
    const mode = dryRun ? "DRY RUN" : "MIGRATION";
    logger.info(`${mode} COMPLETED:`);
    logger.info(`  - Total JSON files: ${stats.totalJsonFiles}`);
    logger.info(`  - Migrated jobs: ${stats.migratedJobs}`);
    logger.info(`  - Migrated phases: ${stats.migratedPhases}`);
    logger.info(`  - Migrated logs: ${stats.migratedLogs}`);
    logger.info(`  - Skipped files: ${stats.skippedFiles}`);
    logger.info(`  - Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      logger.warn("Migration errors:");
      for (const error of stats.errors) {
        logger.warn(`  - ${error}`);
      }
    }

    if (!dryRun && stats.migratedJobs > 0) {
      logger.info(`Original JSON files moved to: ${this.migratedDir}`);
    }
  }

  /**
   * 데이터베이스 연결을 해제합니다.
   */
  close(): void {
    this.db.close();
  }
}