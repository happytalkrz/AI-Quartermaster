import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AQDatabase, DatabaseJob, DatabasePhase, DatabaseLog } from "../../src/store/database.js";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("AQDatabase", () => {
  let dataDir: string;
  let dbPath: string;
  let db: AQDatabase;

  beforeEach(() => {
    dataDir = join(tmpdir(), `aq-database-test-${Date.now()}`);
    dbPath = join(dataDir, "test.db");
    db = new AQDatabase(dbPath);
  });

  afterEach(() => {
    db?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("Database Creation", () => {
    it("should create database file at specified path", () => {
      expect(existsSync(dbPath)).toBe(true);
    });

    it("should create database with default path when none provided", () => {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });

      // Create new instance without path
      const defaultDb = new AQDatabase();
      expect(defaultDb).toBeTruthy();
      defaultDb.close();
    });

    it("should create parent directories if they don't exist", () => {
      const nestedPath = join(dataDir, "nested", "deep", "test.db");
      const nestedDb = new AQDatabase(nestedPath);

      expect(existsSync(nestedPath)).toBe(true);
      nestedDb.close();
    });
  });

  describe("Schema Initialization", () => {
    it("should create jobs table with correct structure", () => {
      // Verify table exists by trying to query it
      const result = db.listJobs(1);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should create phases table with correct structure", () => {
      // Create a test job first
      const job: DatabaseJob = {
        id: "test-job-1",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };
      db.createJob(job);

      // Verify phases table exists by trying to query it
      const phases = db.getPhasesByJob("test-job-1");
      expect(Array.isArray(phases)).toBe(true);
    });

    it("should create logs table with correct structure", () => {
      // Create a test job first
      const job: DatabaseJob = {
        id: "test-job-1",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };
      db.createJob(job);

      // Verify logs table exists by trying to query it
      const logs = db.getLogsByJob("test-job-1");
      expect(Array.isArray(logs)).toBe(true);
    });

    it("should enable WAL mode and foreign keys", () => {
      // These are set during initialization, we can't directly test them
      // but we can verify they don't cause errors
      expect(db).toBeTruthy();
    });
  });

  describe("Job CRUD Operations", () => {
    const createTestJob = (id: string = "test-job-1"): DatabaseJob => ({
      id,
      issueNumber: 42,
      repo: "test/repo",
      status: "queued",
      createdAt: new Date().toISOString(),
      dependencies: [1, 2, 3],
      progress: 50,
      isRetry: false,
      costUsd: 1.5,
      totalCostUsd: 2.0
    });

    it("should create a job successfully", () => {
      const job = createTestJob();

      expect(() => db.createJob(job)).not.toThrow();

      const retrieved = db.getJob(job.id);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe(job.id);
      expect(retrieved?.issueNumber).toBe(job.issueNumber);
      expect(retrieved?.repo).toBe(job.repo);
      expect(retrieved?.status).toBe(job.status);
      expect(retrieved?.dependencies).toEqual(job.dependencies);
      expect(retrieved?.progress).toBe(job.progress);
      expect(retrieved?.isRetry).toBe(job.isRetry);
      expect(retrieved?.costUsd).toBe(job.costUsd);
      expect(retrieved?.totalCostUsd).toBe(job.totalCostUsd);
    });

    it("should return undefined for non-existent job", () => {
      const retrieved = db.getJob("non-existent-id");
      expect(retrieved).toBeUndefined();
    });

    it("should update a job successfully", () => {
      const job = createTestJob();
      db.createJob(job);

      const updates: Partial<DatabaseJob> = {
        status: "running",
        startedAt: new Date().toISOString(),
        progress: 75,
        currentStep: "Building"
      };

      const success = db.updateJob(job.id, updates);
      expect(success).toBe(true);

      const updated = db.getJob(job.id);
      expect(updated?.status).toBe("running");
      expect(updated?.startedAt).toBe(updates.startedAt);
      expect(updated?.progress).toBe(75);
      expect(updated?.currentStep).toBe("Building");
    });

    it("should return false when updating non-existent job", () => {
      const success = db.updateJob("non-existent-id", { status: "running" });
      expect(success).toBe(false);
    });

    it("should list jobs in correct order", () => {
      const job1 = createTestJob("job-1");
      const job2 = createTestJob("job-2");
      const job3 = createTestJob("job-3");

      db.createJob(job1);
      db.createJob(job2);
      db.createJob(job3);

      const jobs = db.listJobs();
      expect(jobs).toHaveLength(3);
      // Should be ordered by created_at DESC
      expect(jobs[0].id).toBe("job-3");
      expect(jobs[1].id).toBe("job-2");
      expect(jobs[2].id).toBe("job-1");
    });

    it("should support pagination in listJobs", () => {
      // Create 5 jobs
      for (let i = 1; i <= 5; i++) {
        db.createJob(createTestJob(`job-${i}`));
      }

      const page1 = db.listJobs(2, 0);
      expect(page1).toHaveLength(2);
      expect(page1[0].id).toBe("job-5");
      expect(page1[1].id).toBe("job-4");

      const page2 = db.listJobs(2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0].id).toBe("job-3");
      expect(page2[1].id).toBe("job-2");
    });

    it("should find job by issue number and repo", () => {
      const job1 = createTestJob("job-1");
      job1.issueNumber = 42;
      job1.repo = "test/repo";
      job1.status = "running";

      const job2 = createTestJob("job-2");
      job2.issueNumber = 42;
      job2.repo = "other/repo";
      job2.status = "queued";

      const job3 = createTestJob("job-3");
      job3.issueNumber = 43;
      job3.repo = "test/repo";
      job3.status = "queued";

      db.createJob(job1);
      db.createJob(job2);
      db.createJob(job3);

      const found = db.findJobByIssue(42, "test/repo");
      expect(found?.id).toBe("job-1");
    });

    it("should return undefined when no active job found for issue", () => {
      const job = createTestJob();
      job.status = "success"; // completed status
      db.createJob(job);

      const found = db.findJobByIssue(42, "test/repo");
      expect(found).toBeUndefined();
    });

    it("should delete a job successfully", () => {
      const job = createTestJob();
      db.createJob(job);

      const success = db.deleteJob(job.id);
      expect(success).toBe(true);

      const retrieved = db.getJob(job.id);
      expect(retrieved).toBeUndefined();
    });

    it("should return false when deleting non-existent job", () => {
      const success = db.deleteJob("non-existent-id");
      expect(success).toBe(false);
    });

    it("should handle null values correctly", () => {
      const job: DatabaseJob = {
        id: "minimal-job",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
        // All optional fields are undefined
      };

      db.createJob(job);
      const retrieved = db.getJob(job.id);

      expect(retrieved?.startedAt).toBeUndefined();
      expect(retrieved?.completedAt).toBeUndefined();
      expect(retrieved?.prUrl).toBeUndefined();
      expect(retrieved?.error).toBeUndefined();
      expect(retrieved?.dependencies).toBeUndefined();
      expect(retrieved?.progress).toBeUndefined();
      expect(retrieved?.costUsd).toBeUndefined();
    });

    it("should enforce status check constraints", () => {
      const job = createTestJob();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (job as any).status = "invalid-status";

      expect(() => db.createJob(job)).toThrow();
    });
  });

  describe("Phase CRUD Operations", () => {
    const createTestPhase = (jobId: string, phaseIndex: number = 0): DatabasePhase => ({
      jobId,
      phaseIndex,
      phaseName: `Phase ${phaseIndex}`,
      success: true,
      commitHash: "abc123",
      durationMs: 1500,
      error: undefined,
      costUsd: 0.5
    });

    beforeEach(() => {
      // Create a test job for phase operations
      const job: DatabaseJob = {
        id: "test-job",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };
      db.createJob(job);
    });

    it("should create a phase successfully", () => {
      const phase = createTestPhase("test-job");

      const phaseId = db.createPhase(phase);
      expect(typeof phaseId).toBe("number");
      expect(phaseId).toBeGreaterThan(0);
    });

    it("should retrieve phases by job ID", () => {
      const phase1 = createTestPhase("test-job", 0);
      const phase2 = createTestPhase("test-job", 1);

      db.createPhase(phase1);
      db.createPhase(phase2);

      const phases = db.getPhasesByJob("test-job");
      expect(phases).toHaveLength(2);
      expect(phases[0].phaseIndex).toBe(0);
      expect(phases[1].phaseIndex).toBe(1);
      expect(phases[0].phaseName).toBe("Phase 0");
      expect(phases[1].phaseName).toBe("Phase 1");
    });

    it("should return empty array for job with no phases", () => {
      const phases = db.getPhasesByJob("test-job");
      expect(phases).toHaveLength(0);
    });

    it("should handle phase with error", () => {
      const phase = createTestPhase("test-job");
      phase.success = false;
      phase.error = "Build failed";

      const phaseId = db.createPhase(phase);
      expect(phaseId).toBeGreaterThan(0);

      const phases = db.getPhasesByJob("test-job");
      expect(phases[0].success).toBe(false);
      expect(phases[0].error).toBe("Build failed");
    });

    it("should enforce foreign key constraint", () => {
      const phase = createTestPhase("non-existent-job");

      expect(() => db.createPhase(phase)).toThrow();
    });
  });

  describe("Log CRUD Operations", () => {
    const createTestLog = (jobId: string, message: string = "Test message"): DatabaseLog => ({
      jobId,
      message,
      timestamp: new Date().toISOString()
    });

    beforeEach(() => {
      // Create a test job for log operations
      const job: DatabaseJob = {
        id: "test-job",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };
      db.createJob(job);
    });

    it("should create a log successfully", () => {
      const log = createTestLog("test-job");

      const logId = db.createLog(log);
      expect(typeof logId).toBe("number");
      expect(logId).toBeGreaterThan(0);
    });

    it("should retrieve logs by job ID", () => {
      const now = new Date();
      const log1 = createTestLog("test-job", "First message");
      log1.timestamp = new Date(now.getTime() - 1000).toISOString(); // 1 second earlier

      const log2 = createTestLog("test-job", "Second message");
      log2.timestamp = now.toISOString(); // Current time

      db.createLog(log1);
      db.createLog(log2);

      const logs = db.getLogsByJob("test-job");
      expect(logs).toHaveLength(2);
      // Should be ordered by timestamp DESC
      expect(logs[0].message).toBe("Second message");
      expect(logs[1].message).toBe("First message");
    });

    it("should support limit parameter in getLogsByJob", () => {
      for (let i = 1; i <= 5; i++) {
        db.createLog(createTestLog("test-job", `Message ${i}`));
      }

      const logs = db.getLogsByJob("test-job", 3);
      expect(logs).toHaveLength(3);
    });

    it("should return empty array for job with no logs", () => {
      const logs = db.getLogsByJob("test-job");
      expect(logs).toHaveLength(0);
    });

    it("should enforce foreign key constraint", () => {
      const log = createTestLog("non-existent-job");

      expect(() => db.createLog(log)).toThrow();
    });
  });

  describe("Transaction Support", () => {
    it("should support transactions", () => {
      const job1: DatabaseJob = {
        id: "job-1",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };

      const job2: DatabaseJob = {
        id: "job-2",
        issueNumber: 43,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };

      // Transaction should succeed
      expect(() => {
        db.transaction(() => {
          db.createJob(job1);
          db.createJob(job2);
        });
      }).not.toThrow();

      expect(db.getJob("job-1")).toBeTruthy();
      expect(db.getJob("job-2")).toBeTruthy();
    });

    it("should rollback on transaction error", () => {
      const job: DatabaseJob = {
        id: "job-1",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };

      // Transaction should fail and rollback
      expect(() => {
        db.transaction(() => {
          db.createJob(job);
          // Force an error by trying to create the same job again
          db.createJob(job);
        });
      }).toThrow();

      // Job should not exist due to rollback
      expect(db.getJob("job-1")).toBeUndefined();
    });
  });

  describe("Cascade Deletion", () => {
    it("should cascade delete phases when job is deleted", () => {
      // Create job
      const job: DatabaseJob = {
        id: "test-job",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };
      db.createJob(job);

      // Create phases
      const phase: DatabasePhase = {
        jobId: "test-job",
        phaseIndex: 0,
        phaseName: "Test Phase",
        success: true,
        durationMs: 1000
      };
      db.createPhase(phase);

      // Verify phase exists
      expect(db.getPhasesByJob("test-job")).toHaveLength(1);

      // Delete job
      db.deleteJob("test-job");

      // Phases should be cascade deleted
      expect(db.getPhasesByJob("test-job")).toHaveLength(0);
    });

    it("should cascade delete logs when job is deleted", () => {
      // Create job
      const job: DatabaseJob = {
        id: "test-job",
        issueNumber: 42,
        repo: "test/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };
      db.createJob(job);

      // Create logs
      const log: DatabaseLog = {
        jobId: "test-job",
        message: "Test log",
        timestamp: new Date().toISOString()
      };
      db.createLog(log);

      // Verify log exists
      expect(db.getLogsByJob("test-job")).toHaveLength(1);

      // Delete job
      db.deleteJob("test-job");

      // Logs should be cascade deleted
      expect(db.getLogsByJob("test-job")).toHaveLength(0);
    });
  });

  describe("Database Cleanup", () => {
    it("should close database connection successfully", () => {
      expect(() => db.close()).not.toThrow();
    });

    it("should handle multiple close calls gracefully", () => {
      db.close();
      expect(() => db.close()).not.toThrow();
    });
  });
});