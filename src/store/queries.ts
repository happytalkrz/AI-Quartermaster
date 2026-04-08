import type { AQDatabase } from "./database.js";
import type {
  ProjectStats,
  CostStats,
  TimeRangeBreakdown
} from "../types/api.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

/**
 * 프로젝트별 통계 조회
 *
 * @param db AQDatabase 인스턴스
 * @param timeRange 시간 범위 필터
 * @returns 프로젝트별 통계 배열
 */
export function getStatsByProject(
  db: AQDatabase,
  timeRange: "24h" | "7d" | "30d" | "all" = "7d"
): ProjectStats[] {
  logger.debug(`Getting stats by project for time range: ${timeRange}`);

  // 시간 범위 필터 계산
  const timeFilter = getTimeFilter(timeRange);

  // 프로젝트별 기본 통계 쿼리
  const stmt = (db as unknown as { db: import("better-sqlite3").Database }).db.prepare(`
    SELECT
      repo,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running_count,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued_count,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
      AVG(
        CASE
          WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
          THEN (julianday(completed_at) - julianday(started_at)) * 24 * 60 * 60 * 1000
          ELSE NULL
        END
      ) as avg_duration_ms,
      SUM(COALESCE(total_cost_usd, 0)) as total_cost_usd,
      AVG(COALESCE(total_cost_usd, 0)) as avg_cost_usd,
      COUNT(CASE WHEN total_cost_usd IS NOT NULL THEN 1 END) as cost_job_count
    FROM jobs
    ${timeFilter}
    GROUP BY repo
    ORDER BY total DESC
  `);

  const rows = stmt.all() as Array<{
    repo: string;
    total: number;
    success_count: number;
    failure_count: number;
    running_count: number;
    queued_count: number;
    cancelled_count: number;
    avg_duration_ms: number | null;
    total_cost_usd: number;
    avg_cost_usd: number;
    cost_job_count: number;
  }>;

  return rows.map(row => {
    const successRate = row.total > 0 ? Math.round((row.success_count / row.total) * 100) : 0;
    const avgDurationMs = Math.round(row.avg_duration_ms ?? 0);

    // 각 프로젝트별 비용 통계
    const costStats = getCostsByProject(db, row.repo, timeRange);

    return {
      repo: row.repo,
      total: row.total,
      successCount: row.success_count,
      failureCount: row.failure_count,
      runningCount: row.running_count,
      queuedCount: row.queued_count,
      cancelledCount: row.cancelled_count,
      avgDurationMs,
      successRate,
      costStats
    } satisfies ProjectStats;
  });
}

/**
 * 시간 범위별 통계 조회 (트렌드 분석용)
 *
 * @param db AQDatabase 인스턴스
 * @param project 프로젝트 필터 (선택적)
 * @returns 시간대별 통계 배열
 */
export function getStatsByTimeRange(
  db: AQDatabase,
  project?: string
): TimeRangeBreakdown[] {
  logger.debug(`Getting stats by time range, project: ${project || 'all'}`);

  const timeRanges: Array<"24h" | "7d" | "30d" | "all"> = ["24h", "7d", "30d", "all"];

  return timeRanges.map(timeRange => {
    const timeFilter = getTimeFilter(timeRange);
    const projectFilter = project ? `AND repo = '${project.replace(/'/g, "''")}'` : '';

    const stmt = (db as unknown as { db: import("better-sqlite3").Database }).db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count,
        AVG(
          CASE
            WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
            THEN (julianday(completed_at) - julianday(started_at)) * 24 * 60 * 60 * 1000
            ELSE NULL
          END
        ) as avg_duration_ms,
        SUM(COALESCE(total_cost_usd, 0)) as total_cost_usd,
        AVG(COALESCE(total_cost_usd, 0)) as avg_cost_usd
      FROM jobs
      ${timeFilter}
      ${projectFilter}
    `);

    const row = stmt.get() as {
      total: number;
      success_count: number;
      failure_count: number;
      avg_duration_ms: number | null;
      total_cost_usd: number;
      avg_cost_usd: number;
    } | undefined;

    if (!row) {
      return {
        timeRange,
        total: 0,
        successCount: 0,
        failureCount: 0,
        avgDurationMs: 0,
        successRate: 0,
        totalCostUsd: 0,
        avgCostUsd: 0
      } satisfies TimeRangeBreakdown;
    }

    const successRate = row.total > 0 ? Math.round((row.success_count / row.total) * 100) : 0;
    const avgDurationMs = Math.round(row.avg_duration_ms ?? 0);

    return {
      timeRange,
      total: row.total,
      successCount: row.success_count,
      failureCount: row.failure_count,
      avgDurationMs,
      successRate,
      totalCostUsd: Math.round(row.total_cost_usd * 100) / 100,
      avgCostUsd: Math.round(row.avg_cost_usd * 100) / 100
    } satisfies TimeRangeBreakdown;
  });
}

/**
 * 이슈별 비용 조회
 *
 * @param db AQDatabase 인스턴스
 * @param repo 저장소 필터 (선택적)
 * @param timeRange 시간 범위 필터
 * @returns 비용 통계
 */
export function getCostsByIssue(
  db: AQDatabase,
  repo?: string,
  timeRange: "24h" | "7d" | "30d" | "all" = "7d"
): CostStats {
  logger.debug(`Getting costs by issue, repo: ${repo || 'all'}, timeRange: ${timeRange}`);

  const timeFilter = getTimeFilter(timeRange);
  const repoFilter = repo ? `AND repo = '${repo.replace(/'/g, "''")}'` : '';

  // 비용이 있는 job들의 통계
  const statsStmt = (db as unknown as { db: import("better-sqlite3").Database }).db.prepare(`
    SELECT
      SUM(total_cost_usd) as total_cost_usd,
      AVG(total_cost_usd) as avg_cost_usd,
      COUNT(*) as job_count
    FROM jobs
    WHERE total_cost_usd IS NOT NULL AND total_cost_usd > 0
    ${timeFilter.replace('WHERE', 'AND')}
    ${repoFilter}
  `);

  const statsRow = statsStmt.get() as {
    total_cost_usd: number | null;
    avg_cost_usd: number | null;
    job_count: number;
  } | undefined;

  // 가장 비용이 높은 job들
  const topJobsStmt = (db as unknown as { db: import("better-sqlite3").Database }).db.prepare(`
    SELECT
      id,
      issue_number,
      total_cost_usd,
      repo
    FROM jobs
    WHERE total_cost_usd IS NOT NULL AND total_cost_usd > 0
    ${timeFilter.replace('WHERE', 'AND')}
    ${repoFilter}
    ORDER BY total_cost_usd DESC
    LIMIT 10
  `);

  const topJobs = topJobsStmt.all() as Array<{
    id: string;
    issue_number: number;
    total_cost_usd: number;
    repo: string;
  }>;

  return {
    totalCostUsd: Math.round((statsRow?.total_cost_usd ?? 0) * 100) / 100,
    avgCostUsd: Math.round((statsRow?.avg_cost_usd ?? 0) * 100) / 100,
    jobCount: statsRow?.job_count ?? 0,
    topExpensiveJobs: topJobs.map(job => ({
      id: job.id,
      issueNumber: job.issue_number,
      totalCostUsd: Math.round(job.total_cost_usd * 100) / 100,
      repo: job.repo
    }))
  } satisfies CostStats;
}

/**
 * 프로젝트별 비용 조회
 *
 * @param db AQDatabase 인스턴스
 * @param repo 저장소 이름
 * @param timeRange 시간 범위 필터
 * @returns 프로젝트 비용 통계
 */
export function getCostsByProject(
  db: AQDatabase,
  repo: string,
  timeRange: "24h" | "7d" | "30d" | "all" = "7d"
): CostStats {
  logger.debug(`Getting costs by project: ${repo}, timeRange: ${timeRange}`);

  return getCostsByIssue(db, repo, timeRange);
}

/**
 * 시간 범위에 따른 WHERE 절 생성
 *
 * @param timeRange 시간 범위
 * @returns SQL WHERE 절
 */
function getTimeFilter(timeRange: "24h" | "7d" | "30d" | "all"): string {
  if (timeRange === "all") {
    return "WHERE 1=1";
  }

  let hours: number;
  switch (timeRange) {
    case "24h":
      hours = 24;
      break;
    case "7d":
      hours = 7 * 24;
      break;
    case "30d":
      hours = 30 * 24;
      break;
    default:
      return "WHERE 1=1";
  }

  return `WHERE datetime(created_at) >= datetime('now', '-${hours} hours')`;
}