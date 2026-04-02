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