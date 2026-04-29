import type { Hono } from "hono";
import type { JobStore } from "../../queue/job-store.js";
import type { PatternStore } from "../../learning/pattern-store.js";
import { safeError } from "../route-context.js";
import {
  GetStatsQuerySchema,
  GetCostsQuerySchema,
  GetProjectStatsQuerySchema,
  GetFailureReasonsQuerySchema,
  GetMetricsQuerySchema,
  formatZodError,
} from "../../types/api.js";
import {
  getJobStats,
  getCostStats,
  getProjectStatsWithTimeRange,
  getFailureReasons,
  getThroughputTimeSeries,
  getSuccessRate,
} from "../../store/queries.js";

export interface StatsRouteContext {
  store: JobStore;
  patternStore?: PatternStore;
}

/**
 * /api/stats/* + /api/metrics/* 라우트 등록 (Plan C #C9 — 5단계).
 *
 * 이전: dashboard-api.ts 709-845 (6 read-only routes, ~140줄).
 * 모두 동일한 패턴 — query parse → DB 조회 → JSON 반환.
 */
export function registerStatsRoutes(api: Hono, ctx: StatsRouteContext): void {
  const { store, patternStore } = ctx;

  // Aggregate stats
  api.get("/api/stats", (c) => {
    try {
      const queryParams = {
        project: c.req.query("project"),
        timeRange: c.req.query("timeRange") || "7d",
      };

      const parseResult = GetStatsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({ error: "Invalid query parameters", details: formatZodError(parseResult.error) }, 400);
      }

      const stats = getJobStats(store.getAqDb(), parseResult.data);
      return c.json(stats);
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch stats");
    }
  });

  // Cost stats
  api.get("/api/stats/costs", (c) => {
    try {
      const queryParams = {
        project: c.req.query("project"),
        timeRange: c.req.query("timeRange") || "30d",
        groupBy: c.req.query("groupBy") || "project",
      };

      const parseResult = GetCostsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({ error: "Invalid query parameters", details: formatZodError(parseResult.error) }, 400);
      }

      const costs = getCostStats(store.getAqDb(), parseResult.data);
      return c.json(costs);
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch cost stats");
    }
  });

  // Project stats (success rate + cost per project)
  api.get("/api/stats/projects", (c) => {
    try {
      const queryParams = {
        timeRange: c.req.query("timeRange") || "7d",
      };

      const parseResult = GetProjectStatsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({ error: "Invalid query parameters", details: parseResult.error }, 400);
      }

      const stats = getProjectStatsWithTimeRange(store.getAqDb(), parseResult.data);
      return c.json(stats);
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch project stats");
    }
  });

  // Failure reason top-N analysis
  api.get("/api/metrics/failure-reasons", (c) => {
    try {
      const queryParams = {
        project: c.req.query("project"),
        window: c.req.query("window"),
        top: c.req.query("top"),
      };

      const parseResult = GetFailureReasonsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({ error: "Invalid query parameters", details: formatZodError(parseResult.error) }, 400);
      }

      const result = getFailureReasons(store.getAqDb(), parseResult.data, patternStore);
      return c.json(result);
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch failure reasons");
    }
  });

  // Throughput time series
  api.get("/api/metrics/throughput", (c) => {
    try {
      const queryParams = {
        project: c.req.query("project"),
        window: c.req.query("window") || "7d",
      };

      const parseResult = GetMetricsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({ error: "Invalid query parameters", details: formatZodError(parseResult.error) }, 400);
      }

      const data = getThroughputTimeSeries(store.getAqDb(), parseResult.data);
      return c.json(data);
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch throughput metrics");
    }
  });

  // Success rate metrics
  api.get("/api/metrics/success-rate", (c) => {
    try {
      const queryParams = {
        project: c.req.query("project"),
        window: c.req.query("window") || "7d",
      };

      const parseResult = GetMetricsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({ error: "Invalid query parameters", details: formatZodError(parseResult.error) }, 400);
      }

      const data = getSuccessRate(store.getAqDb(), parseResult.data);
      return c.json(data);
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch success rate metrics");
    }
  });
}
