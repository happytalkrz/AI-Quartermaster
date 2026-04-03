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

  describe("File System Watcher", () => {
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
});