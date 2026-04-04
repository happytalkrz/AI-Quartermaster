import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JsonMigrator } from "../../src/queue/json-migrator.js";
import { AQDatabase } from "../../src/store/database.js";
import type { Job } from "../../src/queue/job-store.js";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("JsonMigrator", () => {
  let testDir: string;
  let jobsDir: string;
  let database: AQDatabase;
  let migrator: JsonMigrator;

  beforeEach(() => {
    // 테스트용 임시 디렉토리 생성
    testDir = join(tmpdir(), `aq-migrator-test-${Date.now()}`);
    jobsDir = join(testDir, "jobs");
    mkdirSync(jobsDir, { recursive: true });

    // 테스트용 인메모리 SQLite 데이터베이스
    const dbPath = join(testDir, "test.db");
    database = new AQDatabase(dbPath);

    // 마이그레이터 생성
    migrator = new JsonMigrator(database, jobsDir);
  });

  afterEach(() => {
    migrator?.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("migrate", () => {
    it("should migrate empty jobs directory", async () => {
      const stats = await migrator.migrate(false);

      expect(stats.totalJsonFiles).toBe(0);
      expect(stats.migratedJobs).toBe(0);
      expect(stats.migratedPhases).toBe(0);
      expect(stats.migratedLogs).toBe(0);
      expect(stats.skippedFiles).toBe(0);
      expect(stats.errors).toEqual([]);
    });

    it("should migrate basic job without phases or logs", async () => {
      const job: Job = {
        id: "aq-42-1234567890",
        issueNumber: 42,
        repo: "test/repo",
        status: "success",
        createdAt: "2024-01-01T10:00:00.000Z",
        completedAt: "2024-01-01T11:00:00.000Z",
        prUrl: "https://github.com/test/repo/pull/123"
      };

      writeFileSync(join(jobsDir, "aq-42-1234567890.json"), JSON.stringify(job, null, 2));

      const stats = await migrator.migrate(false);

      expect(stats.totalJsonFiles).toBe(1);
      expect(stats.migratedJobs).toBe(1);
      expect(stats.migratedPhases).toBe(0);
      expect(stats.migratedLogs).toBe(0);
      expect(stats.skippedFiles).toBe(0);
      expect(stats.errors).toEqual([]);

      // 데이터베이스에서 확인
      const dbJob = database.getJob("aq-42-1234567890");
      expect(dbJob).toBeTruthy();
      expect(dbJob!.issueNumber).toBe(42);
      expect(dbJob!.repo).toBe("test/repo");
      expect(dbJob!.status).toBe("success");

      // JSON 파일이 .migrated 디렉토리로 이동되었는지 확인
      expect(existsSync(join(jobsDir, "aq-42-1234567890.json"))).toBe(false);
      expect(existsSync(join(jobsDir, ".migrated", "aq-42-1234567890.json"))).toBe(true);
    });

    it("should migrate job with phases and logs", async () => {
      const job: Job = {
        id: "aq-43-1234567891",
        issueNumber: 43,
        repo: "test/repo",
        status: "success",
        createdAt: "2024-01-01T10:00:00.000Z",
        completedAt: "2024-01-01T12:00:00.000Z",
        phaseResults: [
          {
            name: "Planning",
            success: true,
            durationMs: 5000,
            commit: "abc123"
          },
          {
            name: "Implementation",
            success: true,
            durationMs: 15000,
            commit: "def456"
          },
          {
            name: "Testing",
            success: false,
            durationMs: 3000,
            error: "Test failed"
          }
        ],
        logs: [
          "Job started",
          "Planning phase completed",
          "Implementation phase completed",
          "Testing phase failed"
        ]
      };

      writeFileSync(join(jobsDir, "aq-43-1234567891.json"), JSON.stringify(job, null, 2));

      const stats = await migrator.migrate(false);

      expect(stats.totalJsonFiles).toBe(1);
      expect(stats.migratedJobs).toBe(1);
      expect(stats.migratedPhases).toBe(3);
      expect(stats.migratedLogs).toBe(4);
      expect(stats.skippedFiles).toBe(0);
      expect(stats.errors).toEqual([]);

      // 데이터베이스에서 확인
      const dbJob = database.getJob("aq-43-1234567891");
      expect(dbJob).toBeTruthy();

      const phases = database.getPhasesByJob("aq-43-1234567891");
      expect(phases).toHaveLength(3);
      expect(phases[0].phaseName).toBe("Planning");
      expect(phases[0].success).toBe(true);
      expect(phases[0].commitHash).toBe("abc123");
      expect(phases[2].phaseName).toBe("Testing");
      expect(phases[2].success).toBe(false);
      expect(phases[2].error).toBe("Test failed");

      const logs = database.getLogsByJob("aq-43-1234567891");
      expect(logs).toHaveLength(4);
      expect(logs[0].message).toBe("Job started");
      expect(logs[3].message).toBe("Testing phase failed");
    });

    it("should handle multiple jobs in parallel", async () => {
      // 3개의 다른 Job 생성
      const jobs: Job[] = [
        {
          id: "aq-1-1234567890",
          issueNumber: 1,
          repo: "repo/a",
          status: "success",
          createdAt: "2024-01-01T10:00:00.000Z"
        },
        {
          id: "aq-2-1234567891",
          issueNumber: 2,
          repo: "repo/b",
          status: "failure",
          createdAt: "2024-01-01T11:00:00.000Z",
          error: "Build failed"
        },
        {
          id: "aq-3-1234567892",
          issueNumber: 3,
          repo: "repo/c",
          status: "cancelled",
          createdAt: "2024-01-01T12:00:00.000Z"
        }
      ];

      for (const job of jobs) {
        writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(job, null, 2));
      }

      const stats = await migrator.migrate(false);

      expect(stats.totalJsonFiles).toBe(3);
      expect(stats.migratedJobs).toBe(3);
      expect(stats.skippedFiles).toBe(0);
      expect(stats.errors).toEqual([]);

      // 각 Job이 올바르게 마이그레이션되었는지 확인
      for (const job of jobs) {
        const dbJob = database.getJob(job.id);
        expect(dbJob).toBeTruthy();
        expect(dbJob!.issueNumber).toBe(job.issueNumber);
        expect(dbJob!.repo).toBe(job.repo);
        expect(dbJob!.status).toBe(job.status);
      }
    });

    it("should skip duplicate jobs already in database", async () => {
      const job: Job = {
        id: "aq-44-1234567892",
        issueNumber: 44,
        repo: "test/repo",
        status: "success",
        createdAt: "2024-01-01T10:00:00.000Z"
      };

      // 먼저 데이터베이스에 Job 추가
      database.createJob({
        id: job.id,
        issueNumber: job.issueNumber,
        repo: job.repo,
        status: job.status,
        createdAt: job.createdAt
      });

      // 같은 Job의 JSON 파일 생성
      writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(job, null, 2));

      const stats = await migrator.migrate(false);

      expect(stats.totalJsonFiles).toBe(1);
      expect(stats.migratedJobs).toBe(0);
      expect(stats.skippedFiles).toBe(1);
      expect(stats.errors).toEqual([]);
    });

    it("should handle invalid JSON files gracefully", async () => {
      // 유효하지 않은 JSON 파일 생성
      writeFileSync(join(jobsDir, "invalid.json"), "{ invalid json content }");

      // 필수 필드가 누락된 JSON 파일 생성
      writeFileSync(join(jobsDir, "incomplete.json"), JSON.stringify({ id: "test" }));

      const stats = await migrator.migrate(false);

      expect(stats.totalJsonFiles).toBe(2);
      expect(stats.migratedJobs).toBe(0);
      expect(stats.skippedFiles).toBe(2);
      expect(stats.errors).toHaveLength(2);

      // 에러 순서에 의존하지 않고, 두 에러가 모두 포함되어 있는지 확인
      const errorMessages = stats.errors.join(" ");
      expect(errorMessages).toContain("invalid.json");
      expect(errorMessages).toContain("incomplete.json");
    });

    it("should perform dry run without actual migration", async () => {
      const job: Job = {
        id: "aq-45-1234567893",
        issueNumber: 45,
        repo: "test/repo",
        status: "success",
        createdAt: "2024-01-01T10:00:00.000Z",
        phaseResults: [
          { name: "Phase1", success: true, durationMs: 1000 }
        ],
        logs: ["Log entry"]
      };

      writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(job, null, 2));

      // Dry run 실행
      const stats = await migrator.migrate(true);

      expect(stats.totalJsonFiles).toBe(1);
      expect(stats.migratedJobs).toBe(1);
      expect(stats.migratedPhases).toBe(1);
      expect(stats.migratedLogs).toBe(1);

      // 실제로는 데이터베이스에 저장되지 않았는지 확인
      const dbJob = database.getJob(job.id);
      expect(dbJob).toBeUndefined();

      // JSON 파일이 이동되지 않았는지 확인
      expect(existsSync(join(jobsDir, `${job.id}.json`))).toBe(true);
      expect(existsSync(join(jobsDir, ".migrated"))).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle missing jobs directory", async () => {
      rmSync(jobsDir, { recursive: true, force: true });

      const missingDirMigrator = new JsonMigrator(database, jobsDir);
      const stats = await missingDirMigrator.migrate(false);

      expect(stats.totalJsonFiles).toBe(0);
      expect(stats.migratedJobs).toBe(0);
      expect(stats.errors).toEqual([]);

      missingDirMigrator.close();
    });

    it("should handle file name conflicts in .migrated directory", async () => {
      const job: Job = {
        id: "aq-46-1234567894",
        issueNumber: 46,
        repo: "test/repo",
        status: "success",
        createdAt: "2024-01-01T10:00:00.000Z"
      };

      // .migrated 디렉토리에 이미 같은 이름의 파일이 있는 상황 시뮬레이션
      const migratedDir = join(jobsDir, ".migrated");
      mkdirSync(migratedDir, { recursive: true });
      writeFileSync(join(migratedDir, `${job.id}.json`), "existing file");

      // 마이그레이션할 Job 파일 생성
      writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(job, null, 2));

      const stats = await migrator.migrate(false);

      expect(stats.migratedJobs).toBe(1);
      expect(stats.errors).toHaveLength(0);

      // 기존 파일은 그대로, 새 파일은 다른 이름으로 저장되었는지 확인
      expect(existsSync(join(migratedDir, `${job.id}.json`))).toBe(true);
      expect(existsSync(join(migratedDir, `${job.id}.1.json`))).toBe(true);
    });

    it("should handle job with all optional fields", async () => {
      const job: Job = {
        id: "aq-47-1234567895",
        issueNumber: 47,
        repo: "test/repo",
        status: "running",
        createdAt: "2024-01-01T10:00:00.000Z",
        startedAt: "2024-01-01T10:05:00.000Z",
        completedAt: "2024-01-01T11:00:00.000Z",
        prUrl: "https://github.com/test/repo/pull/47",
        error: "Some error",
        lastUpdatedAt: "2024-01-01T10:30:00.000Z",
        currentStep: "Phase 2",
        dependencies: [45, 46],
        progress: 75,
        isRetry: true,
        costUsd: 1.23,
        totalCostUsd: 4.56
      };

      writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(job, null, 2));

      const stats = await migrator.migrate(false);

      expect(stats.migratedJobs).toBe(1);
      expect(stats.errors).toEqual([]);

      const dbJob = database.getJob(job.id);
      expect(dbJob).toBeTruthy();
      expect(dbJob!.startedAt).toBe(job.startedAt);
      expect(dbJob!.completedAt).toBe(job.completedAt);
      expect(dbJob!.prUrl).toBe(job.prUrl);
      expect(dbJob!.error).toBe(job.error);
      expect(dbJob!.lastUpdatedAt).toBe(job.lastUpdatedAt);
      expect(dbJob!.currentStep).toBe(job.currentStep);
      expect(dbJob!.dependencies).toEqual(job.dependencies);
      expect(dbJob!.progress).toBe(job.progress);
      expect(dbJob!.isRetry).toBe(job.isRetry);
      expect(dbJob!.costUsd).toBe(job.costUsd);
      expect(dbJob!.totalCostUsd).toBe(job.totalCostUsd);
    });
  });
});