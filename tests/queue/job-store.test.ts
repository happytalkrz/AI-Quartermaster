import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JobStore } from "../../src/queue/job-store.js";
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("JobStore", () => {
  let dataDir: string;
  let store: JobStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `aq-jobstore-test-${Date.now()}`);
    mkdirSync(dataDir, { recursive: true });
    store = new JobStore(dataDir);
  });

  afterEach(() => {
    store?.stopWatching();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("Event Emission", () => {
    it("should emit jobCreated event when a job is created", () => {
      let emittedJob: any = null;
      store.on('jobCreated', (job) => {
        emittedJob = job;
      });

      const job = store.create(42, "test/repo");

      expect(emittedJob).toBeTruthy();
      expect(emittedJob.id).toBe(job.id);
      expect(emittedJob.issueNumber).toBe(42);
      expect(emittedJob.repo).toBe("test/repo");
    });

    it("should emit jobUpdated event when a job is updated", () => {
      let emittedJob: any = null;
      let emittedPreviousJob: any = null;

      store.on('jobUpdated', (job, previousJob) => {
        emittedJob = job;
        emittedPreviousJob = previousJob;
      });

      const job = store.create(42, "test/repo");
      store.update(job.id, { status: "running" });

      expect(emittedJob).toBeTruthy();
      expect(emittedJob.status).toBe("running");
      expect(emittedPreviousJob.status).toBe("queued");
    });

    it("should emit jobDeleted event when a job is removed", () => {
      let emittedJob: any = null;

      store.on('jobDeleted', (job) => {
        emittedJob = job;
      });

      const job = store.create(42, "test/repo");
      const removed = store.remove(job.id);

      expect(removed).toBe(true);
      expect(emittedJob).toBeTruthy();
      expect(emittedJob.id).toBe(job.id);
    });

    it("should emit jobArchived event when a job is archived", () => {
      let emittedJob: any = null;
      let emittedPreviousJob: any = null;

      store.on('jobArchived', (job, previousJob) => {
        emittedJob = job;
        emittedPreviousJob = previousJob;
      });

      const job = store.create(42, "test/repo");
      const archived = store.archive(job.id);

      expect(archived).toBe(true);
      expect(emittedJob).toBeTruthy();
      expect(emittedJob.status).toBe("archived");
      expect(emittedPreviousJob.status).toBe("queued");
    });

    it("should not emit jobDeleted event when removing non-existent job", () => {
      let emittedJob: any = null;

      store.on('jobDeleted', (job) => {
        emittedJob = job;
      });

      const removed = store.remove("non-existent-id");

      expect(removed).toBe(false);
      expect(emittedJob).toBe(null);
    });
  });

  describe("shouldBlockRepickup", () => {
    it("should return false when no jobs exist for the issue", () => {
      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should return true when a success job exists for the issue", () => {
      const job = store.create(42, "test/repo");
      store.update(job.id, { status: "success", completedAt: new Date().toISOString() });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(true);
    });

    it("should return false when only failure job exists for the issue", () => {
      const job = store.create(42, "test/repo");
      store.update(job.id, { status: "failure", completedAt: new Date().toISOString(), error: "Test error" });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should return false when only cancelled job exists for the issue", () => {
      const job = store.create(42, "test/repo");
      store.update(job.id, { status: "cancelled", completedAt: new Date().toISOString() });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should return false when only queued job exists for the issue", () => {
      store.create(42, "test/repo"); // default status is "queued"

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should return false when only running job exists for the issue", () => {
      const job = store.create(42, "test/repo");
      store.update(job.id, { status: "running", startedAt: new Date().toISOString() });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should return false when only archived job exists for the issue", () => {
      const job = store.create(42, "test/repo");
      store.update(job.id, { status: "archived" });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should respect repo boundary - success in different repo should not block", () => {
      const job = store.create(42, "other/repo");
      store.update(job.id, { status: "success", completedAt: new Date().toISOString() });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should return false when multiple non-success jobs exist", () => {
      const job1 = store.create(42, "test/repo");
      store.update(job1.id, { status: "failure", completedAt: new Date().toISOString(), error: "Error 1" });

      const job2 = store.create(42, "test/repo");
      store.update(job2.id, { status: "cancelled", completedAt: new Date().toISOString() });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(false);
    });

    it("should return true when both success and other status jobs exist", () => {
      const job1 = store.create(42, "test/repo");
      store.update(job1.id, { status: "failure", completedAt: new Date().toISOString(), error: "Error 1" });

      const job2 = store.create(42, "test/repo");
      store.update(job2.id, { status: "success", completedAt: new Date().toISOString() });

      const result = store.shouldBlockRepickup(42, "test/repo");
      expect(result).toBe(true);
    });
  });

  describe.skip("File System Watcher", () => {
    it("should detect external file deletion and remove from cache", async () => {
      const job = store.create(42, "test/repo");
      expect(store.get(job.id)).toBeTruthy();

      let deletedJob: any = null;
      const deletePromise = new Promise<void>((resolve) => {
        store.on('jobDeleted', (job) => {
          deletedJob = job;
          resolve();
        });
      });

      // Simulate external deletion
      const jobsDir = join(dataDir, "jobs");
      unlinkSync(join(jobsDir, `${job.id}.json`));

      // Wait for the jobDeleted event or timeout after 500ms
      await Promise.race([
        deletePromise,
        new Promise(resolve => setTimeout(resolve, 500))
      ]);

      expect(store.get(job.id)).toBeUndefined();
      expect(deletedJob).toBeTruthy();
      expect(deletedJob.id).toBe(job.id);
    });

    it("should detect external file modification and reload job", async () => {
      const job = store.create(42, "test/repo");
      const originalStatus = job.status;

      let updatedJob: any = null;
      let previousJob: any = null;
      store.on('jobUpdated', (job, prev) => {
        updatedJob = job;
        previousJob = prev;
      });

      // Simulate external modification
      const jobsDir = join(dataDir, "jobs");
      const modifiedJob = { ...job, status: "running", startedAt: new Date().toISOString() };
      writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(modifiedJob, null, 2));

      // Wait for watcher to process the event
      await new Promise(resolve => setTimeout(resolve, 150));

      const reloadedJob = store.get(job.id);
      expect(reloadedJob?.status).toBe("running");
      expect(updatedJob).toBeTruthy();
      expect(updatedJob.status).toBe("running");
      expect(previousJob?.status).toBe(originalStatus);
    });

    it("should handle external creation of new job file", async () => {
      let createdJob: any = null;
      store.on('jobCreated', (job) => {
        createdJob = job;
      });

      const newJobId = `aq-99-${Date.now()}`;
      const newJob = {
        id: newJobId,
        issueNumber: 99,
        repo: "external/repo",
        status: "queued",
        createdAt: new Date().toISOString()
      };

      // Simulate external creation
      const jobsDir = join(dataDir, "jobs");
      writeFileSync(join(jobsDir, `${newJobId}.json`), JSON.stringify(newJob, null, 2));

      // Wait for watcher to process the event
      await new Promise(resolve => setTimeout(resolve, 150));

      const foundJob = store.get(newJobId);
      expect(foundJob).toBeTruthy();
      expect(foundJob?.issueNumber).toBe(99);
      expect(foundJob?.repo).toBe("external/repo");
      expect(createdJob).toBeTruthy();
      expect(createdJob.id).toBe(newJobId);
    });

    it("should not trigger events for internal deletions", async () => {
      const job = store.create(42, "test/repo");

      let deletedEventCount = 0;
      store.on('jobDeleted', () => {
        deletedEventCount++;
      });

      // Internal deletion (should trigger only one event)
      store.remove(job.id);

      // Wait for potential watcher events
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(deletedEventCount).toBe(1); // Only from internal deletion
      expect(store.get(job.id)).toBeUndefined();
    });

    it("should handle corrupt external file by removing from cache", async () => {
      const job = store.create(42, "test/repo");
      expect(store.get(job.id)).toBeTruthy();

      let deletedJob: any = null;
      store.on('jobDeleted', (job) => {
        deletedJob = job;
      });

      // Write corrupt JSON
      const jobsDir = join(dataDir, "jobs");
      writeFileSync(join(jobsDir, `${job.id}.json`), "{ invalid json }");

      // Wait for watcher to process the event
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(store.get(job.id)).toBeUndefined();
      expect(deletedJob).toBeTruthy();
      expect(deletedJob.id).toBe(job.id);
    });

    it("should start and stop watching correctly", () => {
      expect(store.startWatching).toBeDefined();
      expect(store.stopWatching).toBeDefined();

      // Should not crash when called multiple times
      store.startWatching();
      store.startWatching();

      store.stopWatching();
      store.stopWatching();
    });
  });

  describe("Cache Size Management", () => {
    it("should use default maxJobs when not specified", () => {
      const defaultStore = new JobStore(dataDir);
      expect(defaultStore).toBeTruthy();
      // Can't directly access private field, but test via behavior

      // Create jobs up to default limit and verify no auto-pruning occurs
      for (let i = 1; i <= 10; i++) {
        defaultStore.create(i, "test/repo");
      }
      expect(defaultStore.list().length).toBe(10);
      defaultStore.stopWatching();
    });

    it("should use custom maxJobs when specified", () => {
      const customStore = new JobStore(dataDir, 5);

      // Create 3 jobs - should not trigger pruning
      for (let i = 1; i <= 3; i++) {
        customStore.create(i, "test/repo");
      }
      expect(customStore.list().length).toBe(3);

      // Complete 2 jobs to make them eligible for pruning
      const jobs = customStore.list();
      customStore.update(jobs[0].id, { status: "success", completedAt: new Date().toISOString() });
      customStore.update(jobs[1].id, { status: "failure", completedAt: new Date().toISOString() });

      // Create more jobs to exceed limit and trigger auto-pruning
      for (let i = 4; i <= 7; i++) {
        customStore.create(i, "test/repo");
      }

      // Should have pruned oldest completed jobs
      const finalJobs = customStore.list();
      expect(finalJobs.length).toBeLessThanOrEqual(5);

      customStore.stopWatching();
    });

    it("should auto-prune when cache size exceeds maxJobs", () => {
      const smallStore = new JobStore(dataDir, 3);

      // Create and complete 2 jobs
      const job1 = smallStore.create(1, "test/repo");
      const job2 = smallStore.create(2, "test/repo");
      smallStore.update(job1.id, { status: "success", completedAt: new Date().toISOString() });
      smallStore.update(job2.id, { status: "failure", completedAt: new Date().toISOString() });

      // Create 2 more jobs (total 4, exceeds limit of 3)
      const job3 = smallStore.create(3, "test/repo");
      const job4 = smallStore.create(4, "test/repo"); // This should trigger pruning

      const remainingJobs = smallStore.list();
      expect(remainingJobs.length).toBeLessThanOrEqual(3);

      // Verify that newer jobs are kept
      const remainingIds = remainingJobs.map(j => j.id);
      expect(remainingIds).toContain(job3.id);
      expect(remainingIds).toContain(job4.id);

      smallStore.stopWatching();
    });

    it("should not prune running or queued jobs", () => {
      const smallStore = new JobStore(dataDir, 2);

      // Create 2 running/queued jobs
      const job1 = smallStore.create(1, "test/repo");
      const job2 = smallStore.create(2, "test/repo");
      smallStore.update(job1.id, { status: "running", startedAt: new Date().toISOString() });
      // job2 stays queued

      // Create third job - should not prune running/queued jobs
      const job3 = smallStore.create(3, "test/repo");

      const remainingJobs = smallStore.list();
      expect(remainingJobs.length).toBe(3); // No pruning occurred

      const remainingIds = remainingJobs.map(j => j.id);
      expect(remainingIds).toContain(job1.id);
      expect(remainingIds).toContain(job2.id);
      expect(remainingIds).toContain(job3.id);

      smallStore.stopWatching();
    });
  });

  describe("getCostStats", () => {
    it("should return zero stats when no jobs exist", () => {
      const stats = store.getCostStats();

      expect(stats.totalCostUsd).toBe(0);
      expect(stats.avgCostUsd).toBe(0);
      expect(stats.jobCount).toBe(0);
      expect(stats.topExpensiveJobs).toEqual([]);
    });

    it("should return zero stats when no jobs have cost data", () => {
      store.create(42, "test/repo");
      store.create(43, "test/repo");

      const stats = store.getCostStats();

      expect(stats.totalCostUsd).toBe(0);
      expect(stats.avgCostUsd).toBe(0);
      expect(stats.jobCount).toBe(0);
      expect(stats.topExpensiveJobs).toEqual([]);
    });

    it("should calculate stats correctly for jobs with cost data", () => {
      const job1 = store.create(42, "test/repo");
      store.update(job1.id, { totalCostUsd: 10.50 });

      const job2 = store.create(43, "test/repo");
      store.update(job2.id, { totalCostUsd: 5.25 });

      const job3 = store.create(44, "test/repo");
      store.update(job3.id, { totalCostUsd: 20.00 });

      const stats = store.getCostStats();

      expect(stats.totalCostUsd).toBe(35.75);
      expect(stats.avgCostUsd).toBe(11.92); // (10.50 + 5.25 + 20.00) / 3 = 11.916... rounded to 11.92
      expect(stats.jobCount).toBe(3);
      expect(stats.topExpensiveJobs).toHaveLength(3);
      expect(stats.topExpensiveJobs[0].totalCostUsd).toBe(20.00);
      expect(stats.topExpensiveJobs[1].totalCostUsd).toBe(10.50);
      expect(stats.topExpensiveJobs[2].totalCostUsd).toBe(5.25);
    });

    it("should filter by repo when repo parameter is provided", () => {
      const job1 = store.create(42, "repo/a");
      store.update(job1.id, { totalCostUsd: 10.00 });

      const job2 = store.create(43, "repo/b");
      store.update(job2.id, { totalCostUsd: 5.00 });

      const job3 = store.create(44, "repo/a");
      store.update(job3.id, { totalCostUsd: 15.00 });

      const stats = store.getCostStats("repo/a");

      expect(stats.totalCostUsd).toBe(25.00);
      expect(stats.avgCostUsd).toBe(12.50);
      expect(stats.jobCount).toBe(2);
      expect(stats.topExpensiveJobs).toHaveLength(2);
      expect(stats.topExpensiveJobs[0].repo).toBe("repo/a");
      expect(stats.topExpensiveJobs[1].repo).toBe("repo/a");
    });

    it("should ignore jobs with zero, null, or undefined cost", () => {
      const job1 = store.create(42, "test/repo");
      store.update(job1.id, { totalCostUsd: 10.00 });

      const job2 = store.create(43, "test/repo");
      store.update(job2.id, { totalCostUsd: 0 });

      const job3 = store.create(44, "test/repo");
      // job3는 totalCostUsd를 설정하지 않음 (null/undefined)

      const stats = store.getCostStats();

      expect(stats.totalCostUsd).toBe(10.00);
      expect(stats.avgCostUsd).toBe(10.00);
      expect(stats.jobCount).toBe(1);
      expect(stats.topExpensiveJobs).toHaveLength(1);
    });

    it("should limit top expensive jobs to 10 items", () => {
      // Create 15 jobs with different costs
      for (let i = 1; i <= 15; i++) {
        const job = store.create(40 + i, "test/repo");
        store.update(job.id, { totalCostUsd: i * 2.5 });
      }

      const stats = store.getCostStats();

      expect(stats.topExpensiveJobs).toHaveLength(10);
      expect(stats.topExpensiveJobs[0].totalCostUsd).toBe(37.50); // 15 * 2.5
      expect(stats.topExpensiveJobs[9].totalCostUsd).toBe(15.00); // 6 * 2.5
    });

    it("should include all required fields in topExpensiveJobs", () => {
      const job = store.create(42, "test/repo");
      store.update(job.id, { totalCostUsd: 10.50 });

      const stats = store.getCostStats();

      expect(stats.topExpensiveJobs).toHaveLength(1);
      const topJob = stats.topExpensiveJobs[0];
      expect(topJob.id).toBe(job.id);
      expect(topJob.issueNumber).toBe(42);
      expect(topJob.totalCostUsd).toBe(10.50);
      expect(topJob.repo).toBe("test/repo");
    });

    it("should round costs to 2 decimal places", () => {
      const job1 = store.create(42, "test/repo");
      store.update(job1.id, { totalCostUsd: 10.123456 });

      const job2 = store.create(43, "test/repo");
      store.update(job2.id, { totalCostUsd: 5.876543 });

      const stats = store.getCostStats();

      expect(stats.totalCostUsd).toBe(16.00); // 10.123456 + 5.876543 = 16.0 (rounded)
      expect(stats.avgCostUsd).toBe(8.00); // 16.0 / 2 = 8.0
    });
  });
});