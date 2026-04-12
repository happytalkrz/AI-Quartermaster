import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AQDatabase, type DatabaseJob } from "../../src/store/database.js";
import { getJobStats, getCostStats, getProjectSummary } from "../../src/store/queries.js";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Helper: create a minimal job object
function makeJob(overrides: Partial<DatabaseJob> & { id: string }): DatabaseJob {
  return {
    issueNumber: 1,
    repo: "org/repo",
    status: "success",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Helper: ISO string N days ago
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe("queries", () => {
  let dataDir: string;
  let dbPath: string;
  let db: AQDatabase;

  beforeEach(() => {
    dataDir = join(tmpdir(), `aq-queries-test-${Date.now()}`);
    dbPath = join(dataDir, "test.db");
    db = new AQDatabase(dbPath);
  });

  afterEach(() => {
    db?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────────────
  // getJobStats
  // ────────────────────────────────────────────────────────────
  describe("getJobStats", () => {
    it("returns all-zero stats for empty db", () => {
      const result = getJobStats(db, { timeRange: "all" });
      expect(result.total).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.runningCount).toBe(0);
      expect(result.queuedCount).toBe(0);
      expect(result.cancelledCount).toBe(0);
      expect(result.avgDurationMs).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.project).toBeNull();
      expect(result.timeRange).toBe("all");
    });

    it("counts jobs by status correctly", () => {
      db.createJob(makeJob({ id: "j1", status: "success" }));
      db.createJob(makeJob({ id: "j2", status: "success" }));
      db.createJob(makeJob({ id: "j3", status: "failure" }));
      db.createJob(makeJob({ id: "j4", status: "running" }));
      db.createJob(makeJob({ id: "j5", status: "queued" }));
      db.createJob(makeJob({ id: "j6", status: "cancelled" }));

      const result = getJobStats(db, { timeRange: "all" });
      expect(result.total).toBe(6);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.runningCount).toBe(1);
      expect(result.queuedCount).toBe(1);
      expect(result.cancelledCount).toBe(1);
    });

    it("calculates successRate correctly", () => {
      db.createJob(makeJob({ id: "j1", status: "success" }));
      db.createJob(makeJob({ id: "j2", status: "success" }));
      db.createJob(makeJob({ id: "j3", status: "failure" }));
      db.createJob(makeJob({ id: "j4", status: "failure" }));

      const result = getJobStats(db, { timeRange: "all" });
      expect(result.successRate).toBe(50);
    });

    it("calculates avgDurationMs for completed jobs", () => {
      const startedAt = new Date("2024-01-01T10:00:00.000Z").toISOString();
      const completedAt = new Date("2024-01-01T10:00:02.000Z").toISOString(); // +2000ms
      db.createJob(makeJob({ id: "j1", status: "success", startedAt, completedAt }));

      const result = getJobStats(db, { timeRange: "all" });
      expect(result.avgDurationMs).toBeCloseTo(2000, -1);
    });

    it("ignores jobs without completedAt in avgDurationMs", () => {
      const startedAt = new Date().toISOString();
      db.createJob(makeJob({ id: "j1", status: "running", startedAt })); // no completedAt

      const result = getJobStats(db, { timeRange: "all" });
      expect(result.avgDurationMs).toBe(0);
    });

    describe("project filter", () => {
      beforeEach(() => {
        db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success" }));
        db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "failure" }));
        db.createJob(makeJob({ id: "j3", repo: "org/beta", status: "success" }));
      });

      it("returns stats for all projects when project is undefined", () => {
        const result = getJobStats(db, { timeRange: "all" });
        expect(result.total).toBe(3);
        expect(result.project).toBeNull();
      });

      it("filters by project", () => {
        const result = getJobStats(db, { project: "org/alpha", timeRange: "all" });
        expect(result.total).toBe(2);
        expect(result.successCount).toBe(1);
        expect(result.failureCount).toBe(1);
        expect(result.project).toBe("org/alpha");
      });

      it("returns zero total for unknown project", () => {
        const result = getJobStats(db, { project: "org/unknown", timeRange: "all" });
        expect(result.total).toBe(0);
      });
    });

    describe("timeRange filter", () => {
      beforeEach(() => {
        // Ensure clean database state for this describe block
        const allJobs = db.listJobs();
        for (const job of allJobs) {
          db.deleteJob(job.id);
        }

        db.createJob(makeJob({ id: "j-12h", status: "success", createdAt: daysAgo(0.5) }));
        db.createJob(makeJob({ id: "j-3d", status: "success", createdAt: daysAgo(3) }));
        db.createJob(makeJob({ id: "j-10d", status: "success", createdAt: daysAgo(10) }));
        db.createJob(makeJob({ id: "j-35d", status: "failure", createdAt: daysAgo(35) }));
      });

      it("timeRange=24h returns only recent jobs", () => {
        const result = getJobStats(db, { timeRange: "24h" });
        expect(result.total).toBe(1);
      });

      it("timeRange=7d returns jobs within 7 days", () => {
        const result = getJobStats(db, { timeRange: "7d" });
        expect(result.total).toBe(2);
      });

      it("timeRange=30d returns jobs within 30 days", () => {
        const result = getJobStats(db, { timeRange: "30d" });
        expect(result.total).toBe(3);
      });

      it("timeRange=all returns all jobs", () => {
        const result = getJobStats(db, { timeRange: "all" });
        expect(result.total).toBe(4);
      });
    });

    it("combines project and timeRange filters", () => {
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success", createdAt: daysAgo(1) }));
      db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "success", createdAt: daysAgo(10) }));
      db.createJob(makeJob({ id: "j3", repo: "org/beta", status: "success", createdAt: daysAgo(1) }));

      const result = getJobStats(db, { project: "org/alpha", timeRange: "7d" });
      expect(result.total).toBe(1);
      expect(result.project).toBe("org/alpha");
    });
  });

  // ────────────────────────────────────────────────────────────
  // getCostStats
  // ────────────────────────────────────────────────────────────
  describe("getCostStats", () => {
    it("returns zero summary for empty db", () => {
      const result = getCostStats(db, { timeRange: "all", groupBy: "project" });
      expect(result.summary.totalCostUsd).toBe(0);
      expect(result.summary.jobCount).toBe(0);
      expect(result.summary.avgCostUsd).toBe(0);
      expect(result.breakdown).toHaveLength(0);
      expect(result.project).toBeNull();
    });

    it("aggregates cost across all jobs", () => {
      db.createJob(makeJob({
        id: "j1", status: "success",
        totalCostUsd: 1.0,
        totalUsage: { input_tokens: 100, output_tokens: 50 },
      }));
      db.createJob(makeJob({
        id: "j2", status: "success",
        totalCostUsd: 2.0,
        totalUsage: { input_tokens: 200, output_tokens: 100 },
      }));

      const result = getCostStats(db, { timeRange: "all", groupBy: "project" });
      expect(result.summary.totalCostUsd).toBeCloseTo(3.0);
      expect(result.summary.jobCount).toBe(2);
      expect(result.summary.avgCostUsd).toBeCloseTo(1.5);
      expect(result.summary.totalInputTokens).toBe(300);
      expect(result.summary.totalOutputTokens).toBe(150);
    });

    it("handles jobs with null cost (treats as 0)", () => {
      db.createJob(makeJob({ id: "j1", status: "success" })); // no cost fields
      const result = getCostStats(db, { timeRange: "all", groupBy: "project" });
      expect(result.summary.totalCostUsd).toBe(0);
      expect(result.summary.jobCount).toBe(1);
    });

    describe("groupBy=project", () => {
      beforeEach(() => {
        db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success", totalCostUsd: 1.0 }));
        db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "success", totalCostUsd: 2.0 }));
        db.createJob(makeJob({ id: "j3", repo: "org/beta", status: "success", totalCostUsd: 5.0 }));
      });

      it("produces one breakdown entry per repo", () => {
        const result = getCostStats(db, { timeRange: "all", groupBy: "project" });
        expect(result.breakdown).toHaveLength(2);
      });

      it("sums cost per repo correctly", () => {
        const result = getCostStats(db, { timeRange: "all", groupBy: "project" });
        const alpha = result.breakdown.find(e => e.label === "org/alpha");
        const beta = result.breakdown.find(e => e.label === "org/beta");

        expect(alpha).toBeDefined();
        expect(alpha?.totalCostUsd).toBeCloseTo(3.0);
        expect(alpha?.jobCount).toBe(2);
        expect(alpha?.avgCostUsd).toBeCloseTo(1.5);

        expect(beta).toBeDefined();
        expect(beta?.totalCostUsd).toBeCloseTo(5.0);
        expect(beta?.jobCount).toBe(1);
      });
    });

    describe("groupBy=day", () => {
      it("groups jobs by date", () => {
        db.createJob(makeJob({ id: "j1", status: "success", totalCostUsd: 1.0, createdAt: "2024-01-10T10:00:00.000Z" }));
        db.createJob(makeJob({ id: "j2", status: "success", totalCostUsd: 2.0, createdAt: "2024-01-10T20:00:00.000Z" }));
        db.createJob(makeJob({ id: "j3", status: "success", totalCostUsd: 3.0, createdAt: "2024-01-11T10:00:00.000Z" }));

        const result = getCostStats(db, { timeRange: "all", groupBy: "day" });
        expect(result.breakdown).toHaveLength(2);

        const jan10 = result.breakdown.find(e => e.label === "2024-01-10");
        expect(jan10?.totalCostUsd).toBeCloseTo(3.0);
        expect(jan10?.jobCount).toBe(2);
      });
    });

    describe("groupBy=week", () => {
      it("groups jobs by ISO week", () => {
        db.createJob(makeJob({ id: "j1", status: "success", totalCostUsd: 1.0, createdAt: "2024-01-08T10:00:00.000Z" }));
        db.createJob(makeJob({ id: "j2", status: "success", totalCostUsd: 2.0, createdAt: "2024-01-08T20:00:00.000Z" }));
        db.createJob(makeJob({ id: "j3", status: "success", totalCostUsd: 3.0, createdAt: "2024-01-15T10:00:00.000Z" }));

        const result = getCostStats(db, { timeRange: "all", groupBy: "week" });
        expect(result.breakdown).toHaveLength(2);
      });
    });

    describe("groupBy=month", () => {
      it("groups jobs by year-month", () => {
        db.createJob(makeJob({ id: "j1", status: "success", totalCostUsd: 1.0, createdAt: "2024-01-10T10:00:00.000Z" }));
        db.createJob(makeJob({ id: "j2", status: "success", totalCostUsd: 2.0, createdAt: "2024-01-20T10:00:00.000Z" }));
        db.createJob(makeJob({ id: "j3", status: "success", totalCostUsd: 3.0, createdAt: "2024-02-05T10:00:00.000Z" }));

        const result = getCostStats(db, { timeRange: "all", groupBy: "month" });
        expect(result.breakdown).toHaveLength(2);

        const jan = result.breakdown.find(e => e.label === "2024-01");
        expect(jan?.totalCostUsd).toBeCloseTo(3.0);
        expect(jan?.jobCount).toBe(2);
      });
    });

    describe("project filter", () => {
      it("filters breakdown and summary by project", () => {
        db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success", totalCostUsd: 1.0 }));
        db.createJob(makeJob({ id: "j2", repo: "org/beta", status: "success", totalCostUsd: 9.0 }));

        const result = getCostStats(db, { project: "org/alpha", timeRange: "all", groupBy: "project" });
        expect(result.summary.totalCostUsd).toBeCloseTo(1.0);
        expect(result.summary.jobCount).toBe(1);
        expect(result.breakdown).toHaveLength(1);
        expect(result.breakdown[0].label).toBe("org/alpha");
        expect(result.project).toBe("org/alpha");
      });
    });

    describe("timeRange filter", () => {
      it("filters by 7d time range", () => {
        db.createJob(makeJob({ id: "j1", status: "success", totalCostUsd: 1.0, createdAt: daysAgo(3) }));
        db.createJob(makeJob({ id: "j2", status: "success", totalCostUsd: 2.0, createdAt: daysAgo(10) }));

        const result = getCostStats(db, { timeRange: "7d", groupBy: "project" });
        expect(result.summary.jobCount).toBe(1);
        expect(result.summary.totalCostUsd).toBeCloseTo(1.0);
      });
    });

    it("includes cache token fields in breakdown", () => {
      db.createJob(makeJob({
        id: "j1", status: "success",
        totalCostUsd: 1.0,
        totalUsage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      }));

      const result = getCostStats(db, { timeRange: "all", groupBy: "project" });
      expect(result.summary.totalCacheCreationTokens).toBe(20);
      expect(result.summary.totalCacheReadTokens).toBe(30);
      expect(result.breakdown[0].totalCacheCreationTokens).toBe(20);
      expect(result.breakdown[0].totalCacheReadTokens).toBe(30);
    });
  });

  // ────────────────────────────────────────────────────────────
  // getProjectSummary
  // ────────────────────────────────────────────────────────────
  describe("getProjectSummary", () => {
    it("returns empty array for empty db", () => {
      const result = getProjectSummary(db);
      expect(result).toHaveLength(0);
    });

    it("groups jobs by repo", () => {
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success" }));
      db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "failure" }));
      db.createJob(makeJob({ id: "j3", repo: "org/beta", status: "success" }));

      const result = getProjectSummary(db);
      expect(result).toHaveLength(2);
    });

    it("calculates successCount, failureCount per repo", () => {
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success" }));
      db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "success" }));
      db.createJob(makeJob({ id: "j3", repo: "org/alpha", status: "failure" }));

      const result = getProjectSummary(db);
      const alpha = result.find(r => r.repo === "org/alpha");
      expect(alpha?.total).toBe(3);
      expect(alpha?.successCount).toBe(2);
      expect(alpha?.failureCount).toBe(1);
    });

    it("calculates successRate per repo", () => {
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success" }));
      db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "failure" }));
      db.createJob(makeJob({ id: "j3", repo: "org/alpha", status: "failure" }));
      db.createJob(makeJob({ id: "j4", repo: "org/alpha", status: "failure" }));

      const result = getProjectSummary(db);
      const alpha = result.find(r => r.repo === "org/alpha");
      expect(alpha?.successRate).toBe(25);
    });

    it("aggregates totalCostUsd per repo", () => {
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success", totalCostUsd: 1.5 }));
      db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "success", totalCostUsd: 2.5 }));
      db.createJob(makeJob({ id: "j3", repo: "org/beta", status: "success", totalCostUsd: 10.0 }));

      const result = getProjectSummary(db);
      const alpha = result.find(r => r.repo === "org/alpha");
      expect(alpha?.totalCostUsd).toBeCloseTo(4.0);
    });

    it("orders repos by last_activity DESC", () => {
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success", createdAt: daysAgo(5) }));
      db.createJob(makeJob({ id: "j2", repo: "org/beta", status: "success", createdAt: daysAgo(1) }));
      db.createJob(makeJob({ id: "j3", repo: "org/gamma", status: "success", createdAt: daysAgo(3) }));

      const result = getProjectSummary(db);
      expect(result[0].repo).toBe("org/beta");
      expect(result[1].repo).toBe("org/gamma");
      expect(result[2].repo).toBe("org/alpha");
    });

    it("sets lastActivity to max createdAt within a repo", () => {
      const older = daysAgo(5);
      const newer = daysAgo(1);
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success", createdAt: older }));
      db.createJob(makeJob({ id: "j2", repo: "org/alpha", status: "success", createdAt: newer }));

      const result = getProjectSummary(db);
      const alpha = result.find(r => r.repo === "org/alpha");
      expect(alpha?.lastActivity).toBe(newer);
    });

    it("treats jobs with no cost as 0 in totalCostUsd", () => {
      db.createJob(makeJob({ id: "j1", repo: "org/alpha", status: "success" })); // no totalCostUsd

      const result = getProjectSummary(db);
      expect(result[0].totalCostUsd).toBe(0);
    });
  });
});
