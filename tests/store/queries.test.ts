import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  getStatsByProject,
  getStatsByTimeRange,
  getCostsByIssue,
  getCostsByProject
} from "../../src/store/queries.js";
import type { AQDatabase } from "../../src/store/database.js";

// Mock the logger
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("Statistics Queries", () => {
  let mockDb: AQDatabase;
  let mockPreparedStatement: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPreparedStatement = {
      all: vi.fn(),
      get: vi.fn(),
    };

    mockDb = {
      db: {
        prepare: vi.fn().mockReturnValue(mockPreparedStatement),
      }
    } as any;
  });

  describe("getStatsByProject", () => {
    const mockProjectRows = [
      {
        repo: "test-repo-1",
        total: 10,
        success_count: 7,
        failure_count: 2,
        running_count: 1,
        queued_count: 0,
        cancelled_count: 0,
        avg_duration_ms: 5000,
        total_cost_usd: 0.15,
        avg_cost_usd: 0.05,
        cost_job_count: 3,
      },
      {
        repo: "test-repo-2",
        total: 5,
        success_count: 3,
        failure_count: 1,
        running_count: 0,
        queued_count: 1,
        cancelled_count: 0,
        avg_duration_ms: null,
        total_cost_usd: 0.08,
        avg_cost_usd: 0.04,
        cost_job_count: 2,
      },
    ];

    const mockCostRows = [
      {
        id: "job-1",
        issue_number: 123,
        total_cost_usd: 0.10,
        repo: "test-repo-1",
      },
    ];

    beforeEach(() => {
      // Mock project stats query
      mockPreparedStatement.all.mockReturnValueOnce(mockProjectRows);
      // Mock cost query for each project
      mockPreparedStatement.get
        .mockReturnValueOnce({ total_cost_usd: 0.15, avg_cost_usd: 0.05, job_count: 3 })
        .mockReturnValueOnce({ total_cost_usd: 0.08, avg_cost_usd: 0.04, job_count: 2 });
      mockPreparedStatement.all
        .mockReturnValueOnce(mockCostRows)
        .mockReturnValueOnce([]);
    });

    it("should return project statistics for default time range", () => {
      const result = getStatsByProject(mockDb);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        repo: "test-repo-1",
        total: 10,
        successCount: 7,
        failureCount: 2,
        runningCount: 1,
        queuedCount: 0,
        cancelledCount: 0,
        avgDurationMs: 5000,
        successRate: 70,
        costStats: {
          totalCostUsd: 0.15,
          avgCostUsd: 0.05,
          jobCount: 3,
          topExpensiveJobs: [
            {
              id: "job-1",
              issueNumber: 123,
              totalCostUsd: 0.10,
              repo: "test-repo-1",
            },
          ],
        },
      });
    });

    it("should handle null avg_duration_ms correctly", () => {
      const result = getStatsByProject(mockDb);

      expect(result[1].avgDurationMs).toBe(0);
      expect(result[1].successRate).toBe(60); // 3/5 * 100
    });

    it("should apply time range filter", () => {
      getStatsByProject(mockDb, "24h");

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE datetime(created_at) >= datetime('now', '-24 hours')")
      );
    });

    it("should handle 'all' time range", () => {
      getStatsByProject(mockDb, "all");

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("WHERE 1=1")
      );
    });
  });

  describe("getStatsByTimeRange", () => {
    const mockTimeRangeRow = {
      total: 15,
      success_count: 12,
      failure_count: 3,
      avg_duration_ms: 4500,
      total_cost_usd: 0.25,
      avg_cost_usd: 0.06,
    };

    beforeEach(() => {
      mockPreparedStatement.get.mockReturnValue(mockTimeRangeRow);
    });

    it("should return time range breakdown for all ranges", () => {
      const result = getStatsByTimeRange(mockDb);

      expect(result).toHaveLength(4);
      expect(result.map(r => r.timeRange)).toEqual(["24h", "7d", "30d", "all"]);

      result.forEach((range) => {
        expect(range).toEqual({
          timeRange: expect.any(String),
          total: 15,
          successCount: 12,
          failureCount: 3,
          avgDurationMs: 4500,
          successRate: 80,
          totalCostUsd: 0.25,
          avgCostUsd: 0.06,
        });
      });
    });

    it("should filter by project when provided", () => {
      getStatsByTimeRange(mockDb, "test-repo");

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("AND repo = 'test-repo'")
      );
    });

    it("should handle SQL injection in project parameter", () => {
      getStatsByTimeRange(mockDb, "test'; DROP TABLE jobs; --");

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("AND repo = 'test''; DROP TABLE jobs; --'")
      );
    });

    it("should handle null row from database", () => {
      mockPreparedStatement.get.mockReturnValue(undefined);

      const result = getStatsByTimeRange(mockDb);

      expect(result).toHaveLength(4);
      result.forEach((range) => {
        expect(range).toEqual({
          timeRange: expect.any(String),
          total: 0,
          successCount: 0,
          failureCount: 0,
          avgDurationMs: 0,
          successRate: 0,
          totalCostUsd: 0,
          avgCostUsd: 0,
        });
      });
    });
  });

  describe("getCostsByIssue", () => {
    const mockStatsRow = {
      total_cost_usd: 1.25,
      avg_cost_usd: 0.08,
      job_count: 15,
    };

    const mockTopJobs = [
      {
        id: "job-1",
        issue_number: 123,
        total_cost_usd: 0.45,
        repo: "repo-1",
      },
      {
        id: "job-2",
        issue_number: 456,
        total_cost_usd: 0.32,
        repo: "repo-2",
      },
    ];

    beforeEach(() => {
      mockPreparedStatement.get.mockReturnValue(mockStatsRow);
      mockPreparedStatement.all.mockReturnValue(mockTopJobs);
    });

    it("should return cost statistics with default parameters", () => {
      const result = getCostsByIssue(mockDb);

      expect(result).toEqual({
        totalCostUsd: 1.25,
        avgCostUsd: 0.08,
        jobCount: 15,
        topExpensiveJobs: [
          {
            id: "job-1",
            issueNumber: 123,
            totalCostUsd: 0.45,
            repo: "repo-1",
          },
          {
            id: "job-2",
            issueNumber: 456,
            totalCostUsd: 0.32,
            repo: "repo-2",
          },
        ],
      });
    });

    it("should apply repo filter when provided", () => {
      getCostsByIssue(mockDb, "test-repo");

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("AND repo = 'test-repo'")
      );
    });

    it("should apply time range filter", () => {
      getCostsByIssue(mockDb, undefined, "30d");

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("datetime('now', '-720 hours')")
      );
    });

    it("should handle empty cost data", () => {
      mockPreparedStatement.get.mockReturnValue({
        total_cost_usd: null,
        avg_cost_usd: null,
        job_count: 0,
      });
      mockPreparedStatement.all.mockReturnValue([]);

      const result = getCostsByIssue(mockDb);

      expect(result).toEqual({
        totalCostUsd: 0,
        avgCostUsd: 0,
        jobCount: 0,
        topExpensiveJobs: [],
      });
    });

    it("should round cost values to 2 decimal places", () => {
      mockPreparedStatement.get.mockReturnValue({
        total_cost_usd: 1.2567,
        avg_cost_usd: 0.08333,
        job_count: 15,
      });
      mockPreparedStatement.all.mockReturnValue([
        {
          id: "job-1",
          issue_number: 123,
          total_cost_usd: 0.4567,
          repo: "repo-1",
        },
      ]);

      const result = getCostsByIssue(mockDb);

      expect(result.totalCostUsd).toBe(1.26);
      expect(result.avgCostUsd).toBe(0.08);
      expect(result.topExpensiveJobs[0].totalCostUsd).toBe(0.46);
    });
  });

  describe("getCostsByProject", () => {
    it("should delegate to getCostsByIssue with repo filter", () => {
      const mockStatsRow = {
        total_cost_usd: 0.50,
        avg_cost_usd: 0.05,
        job_count: 10,
      };

      mockPreparedStatement.get.mockReturnValue(mockStatsRow);
      mockPreparedStatement.all.mockReturnValue([]);

      const result = getCostsByProject(mockDb, "test-repo", "24h");

      expect(result).toEqual({
        totalCostUsd: 0.50,
        avgCostUsd: 0.05,
        jobCount: 10,
        topExpensiveJobs: [],
      });

      // Should have called with repo filter
      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("AND repo = 'test-repo'")
      );
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle zero total jobs for success rate calculation", () => {
      // First call: project stats query returns empty repo
      mockPreparedStatement.all.mockReturnValueOnce([
        {
          repo: "empty-repo",
          total: 0,
          success_count: 0,
          failure_count: 0,
          running_count: 0,
          queued_count: 0,
          cancelled_count: 0,
          avg_duration_ms: null,
          total_cost_usd: 0,
          avg_cost_usd: 0,
          cost_job_count: 0,
        },
      ]);

      // Mock empty cost data for getCostsByProject calls
      mockPreparedStatement.get.mockReturnValue({
        total_cost_usd: 0,
        avg_cost_usd: 0,
        job_count: 0,
      });
      // Second call: top expensive jobs query returns empty array
      mockPreparedStatement.all.mockReturnValue([]);

      const result = getStatsByProject(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0].successRate).toBe(0);
      expect(result[0].avgDurationMs).toBe(0);
    });

    it("should handle different time range values correctly", () => {
      const timeRanges = ["24h", "7d", "30d", "all"] as const;

      timeRanges.forEach((range) => {
        vi.clearAllMocks();
        mockPreparedStatement.all.mockReturnValue([]);
        getStatsByProject(mockDb, range);

        if (range === "all") {
          expect(mockDb.db.prepare).toHaveBeenCalledWith(
            expect.stringContaining("WHERE 1=1")
          );
        } else {
          const expectedHours = range === "24h" ? 24 : range === "7d" ? 168 : 720;
          expect(mockDb.db.prepare).toHaveBeenCalledWith(
            expect.stringContaining(`'-${expectedHours} hours'`)
          );
        }
      });
    });
  });
});