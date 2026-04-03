import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JobStore } from "../../src/queue/job-store.js";
import { mkdirSync, rmSync } from "fs";
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
});