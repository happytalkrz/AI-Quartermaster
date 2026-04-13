import type { AQDatabase } from "./database.js";
import type { StatsResponse, GetStatsQuery, CostsResponse, GetCostsQuery, CostEntry, GetProjectStatsQuery, ProjectStatsResponse, GetFailureReasonsQuery, FailureReasonsResponse } from "../types/api.js";
import { classifyError } from "../pipeline/errors/error-classifier.js";

// SQLite row types for query results
interface StatsRow {
  total: number;
  success_count: number;
  failure_count: number;
  running_count: number;
  queued_count: number;
  cancelled_count: number;
  avg_duration_ms: number | null;
}

interface CostGroupRow {
  label: string;
  total_cost_usd: number;
  job_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
}

interface CostSummaryRow {
  total_cost_usd: number;
  job_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
}

interface ProjectSummaryRow {
  repo: string;
  total: number;
  success_count: number;
  failure_count: number;
  total_cost_usd: number;
  last_activity: string | null;
  total_input_tokens: number;
  total_cache_read_input_tokens: number;
}

export interface ProjectSummary {
  repo: string;
  total: number;
  successCount: number;
  failureCount: number;
  totalCostUsd: number;
  successRate: number;
  lastActivity: string | null;
  cacheHitRatio: number;
}

function getTimeRangeCutoff(timeRange: string): string | null {
  if (timeRange === "all") return null;
  const now = new Date();
  switch (timeRange) {
    case "24h": return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    case "7d": return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return null;
  }
}

function buildWhereClause(project: string | undefined, cutoff: string | null): {
  sql: string;
  params: (string | null)[];
} {
  const conditions: string[] = [];
  const params: (string | null)[] = [];

  if (project) {
    conditions.push("repo = ?");
    params.push(project);
  }
  if (cutoff) {
    conditions.push("created_at >= ?");
    params.push(cutoff);
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function getJobStats(aqDb: AQDatabase, query: GetStatsQuery): StatsResponse {
  const { project, timeRange } = query;
  const cutoff = getTimeRangeCutoff(timeRange);
  const { sql: whereClause, params } = buildWhereClause(project, cutoff);

  const db = aqDb.getDb();

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running_count,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued_count,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
      AVG(CASE
        WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
        THEN (julianday(completed_at) - julianday(started_at)) * 86400000.0
        ELSE NULL
      END) as avg_duration_ms
    FROM jobs
    ${whereClause}
  `).get(...params) as StatsRow;

  const total = row.total ?? 0;
  const successCount = row.success_count ?? 0;

  return {
    total,
    successCount,
    failureCount: row.failure_count ?? 0,
    runningCount: row.running_count ?? 0,
    queuedCount: row.queued_count ?? 0,
    cancelledCount: row.cancelled_count ?? 0,
    avgDurationMs: row.avg_duration_ms != null ? Math.round(row.avg_duration_ms) : 0,
    successRate: total > 0 ? Math.round((successCount / total) * 100) : 0,
    project: project ?? null,
    timeRange,
  };
}

export function getCostStats(aqDb: AQDatabase, query: GetCostsQuery): CostsResponse {
  const { project, timeRange, groupBy } = query;
  const cutoff = getTimeRangeCutoff(timeRange);
  const { sql: whereClause, params } = buildWhereClause(project, cutoff);

  const db = aqDb.getDb();

  let groupExpr: string;
  switch (groupBy) {
    case "day":   groupExpr = "date(created_at)"; break;
    case "week":  groupExpr = "strftime('%Y-W%W', created_at)"; break;
    case "month": groupExpr = "strftime('%Y-%m', created_at)"; break;
    default:      groupExpr = "repo"; // project
  }

  const breakdownRows = db.prepare(`
    SELECT
      ${groupExpr} as label,
      COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
      COUNT(*) as job_count,
      COALESCE(SUM(total_input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(total_output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(total_cache_creation_input_tokens), 0) as total_cache_creation_tokens,
      COALESCE(SUM(total_cache_read_input_tokens), 0) as total_cache_read_tokens
    FROM jobs
    ${whereClause}
    GROUP BY ${groupExpr}
    ORDER BY ${groupExpr}
  `).all(...params) as CostGroupRow[];

  const summaryRow = db.prepare(`
    SELECT
      COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
      COUNT(*) as job_count,
      COALESCE(SUM(total_input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(total_output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(total_cache_creation_input_tokens), 0) as total_cache_creation_tokens,
      COALESCE(SUM(total_cache_read_input_tokens), 0) as total_cache_read_tokens
    FROM jobs
    ${whereClause}
  `).get(...params) as CostSummaryRow;

  const breakdown: CostEntry[] = breakdownRows.map(row => {
    const cacheHitDenominator = row.total_input_tokens + row.total_cache_read_tokens;
    return {
      label: row.label,
      totalCostUsd: row.total_cost_usd,
      jobCount: row.job_count,
      avgCostUsd: row.job_count > 0 ? row.total_cost_usd / row.job_count : 0,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalCacheCreationTokens: row.total_cache_creation_tokens,
      totalCacheReadTokens: row.total_cache_read_tokens,
      cacheHitRatio: cacheHitDenominator > 0 ? row.total_cache_read_tokens / cacheHitDenominator : 0,
    };
  });

  const totalJobCount = summaryRow.job_count;

  return {
    project: project ?? null,
    timeRange,
    groupBy,
    summary: {
      totalCostUsd: summaryRow.total_cost_usd,
      jobCount: totalJobCount,
      avgCostUsd: totalJobCount > 0 ? summaryRow.total_cost_usd / totalJobCount : 0,
      totalInputTokens: summaryRow.total_input_tokens,
      totalOutputTokens: summaryRow.total_output_tokens,
      totalCacheCreationTokens: summaryRow.total_cache_creation_tokens,
      totalCacheReadTokens: summaryRow.total_cache_read_tokens,
      cacheHitRatio: (summaryRow.total_input_tokens + summaryRow.total_cache_read_tokens) > 0
        ? summaryRow.total_cache_read_tokens / (summaryRow.total_input_tokens + summaryRow.total_cache_read_tokens)
        : 0,
    },
    breakdown,
  };
}

interface ProjectStatsRow {
  repo: string;
  total: number;
  success_count: number;
  failure_count: number;
  avg_duration_ms: number | null;
  total_cost_usd: number;
}

export function getProjectStatsWithTimeRange(aqDb: AQDatabase, query: GetProjectStatsQuery): ProjectStatsResponse {
  const { timeRange } = query;
  const cutoff = getTimeRangeCutoff(timeRange);
  const { sql: whereClause, params } = buildWhereClause(undefined, cutoff);

  const db = aqDb.getDb();

  const rows = db.prepare(`
    SELECT
      repo,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count,
      AVG(CASE
        WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
        THEN (julianday(completed_at) - julianday(started_at)) * 86400000.0
        ELSE NULL
      END) as avg_duration_ms,
      COALESCE(SUM(total_cost_usd), 0) as total_cost_usd
    FROM jobs
    ${whereClause}
    GROUP BY repo
    ORDER BY total DESC
  `).all(...params) as ProjectStatsRow[];

  return {
    timeRange,
    projects: rows.map(row => ({
      project: row.repo,
      total: row.total,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.total > 0 ? Math.round((row.success_count / row.total) * 100) : 0,
      avgDurationMs: row.avg_duration_ms != null ? Math.round(row.avg_duration_ms) : 0,
      totalCostUsd: row.total_cost_usd,
      avgCostUsd: row.total > 0 ? row.total_cost_usd / row.total : 0,
    })),
  };
}

interface FailureErrorRow {
  error: string;
}

export function getFailureReasons(aqDb: AQDatabase, query: GetFailureReasonsQuery): FailureReasonsResponse {
  const { project, window: timeWindow, top } = query;
  const cutoff = getTimeRangeCutoff(timeWindow);
  const { sql: whereBase, params } = buildWhereClause(project, cutoff);

  const db = aqDb.getDb();

  // status='failure' AND error IS NOT NULL 조건 추가
  const failureCondition = "status = 'failure' AND error IS NOT NULL";
  const whereClause = whereBase
    ? `${whereBase} AND ${failureCondition}`
    : `WHERE ${failureCondition}`;

  const rows = db.prepare(`
    SELECT error FROM jobs
    ${whereClause}
    ORDER BY created_at DESC
  `).all(...params) as FailureErrorRow[];

  // 카테고리별 집계
  const categoryMap = new Map<string, { count: number; recentErrors: string[] }>();

  for (const row of rows) {
    const category = classifyError(row.error);
    const entry = categoryMap.get(category);
    if (entry) {
      entry.count += 1;
      if (entry.recentErrors.length < 3) {
        entry.recentErrors.push(row.error);
      }
    } else {
      categoryMap.set(category, { count: 1, recentErrors: [row.error] });
    }
  }

  const total = rows.length;

  // 내림차순 정렬 후 상위 top개
  const sorted = Array.from(categoryMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, top);

  const reasons = sorted.map(([category, { count, recentErrors }]) => ({
    category,
    count,
    percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
    recentErrors,
  }));

  return {
    reasons,
    total,
    window: timeWindow,
    project: project ?? null,
  };
}

export function getProjectSummary(aqDb: AQDatabase): ProjectSummary[] {
  const db = aqDb.getDb();

  const rows = db.prepare(`
    SELECT
      repo,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count,
      COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
      MAX(created_at) as last_activity,
      COALESCE(SUM(total_input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(total_cache_read_input_tokens), 0) as total_cache_read_input_tokens
    FROM jobs
    GROUP BY repo
    ORDER BY last_activity DESC
  `).all() as ProjectSummaryRow[];

  return rows.map(row => ({
    repo: row.repo,
    total: row.total,
    successCount: row.success_count,
    failureCount: row.failure_count,
    totalCostUsd: row.total_cost_usd,
    successRate: row.total > 0 ? Math.round((row.success_count / row.total) * 100) : 0,
    lastActivity: row.last_activity ?? null,
    cacheHitRatio: (row.total_input_tokens + row.total_cache_read_input_tokens) > 0
      ? row.total_cache_read_input_tokens / (row.total_input_tokens + row.total_cache_read_input_tokens)
      : 0,
  }));
}
