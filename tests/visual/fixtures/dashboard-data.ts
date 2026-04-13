import type { Job } from "../../../src/types/pipeline.js";
import type { StatsResponse } from "../../../src/types/api.js";

/** 고정 타임스탬프 (동적 값으로 인한 flaky 방지) */
export const FIXED_TIMESTAMP = "2025-01-15T10:00:00.000Z";
export const FIXED_TIMESTAMP_STARTED = "2025-01-15T09:50:00.000Z";
export const FIXED_TIMESTAMP_COMPLETED = "2025-01-15T10:05:00.000Z";

/** 공통 queue 상태 */
const QUEUE_STATUS = {
  pending: 0,
  running: 0,
  concurrency: 3,
} as const;

/** 공통 pagination (단일 페이지) */
function makePagination(total: number) {
  return {
    total,
    offset: 0,
    limit: total,
    hasMore: false,
  };
}

// ── 빈 jobs 목록 fixture ────────────────────────────────────────────────────

export const EMPTY_JOBS_RESPONSE = {
  jobs: [] as Job[],
  queue: QUEUE_STATUS,
  pagination: makePagination(0),
};

// ── jobs 있는 목록 fixture ──────────────────────────────────────────────────

const JOBS_WITH_DATA: Job[] = [
  {
    id: "job-001",
    issueNumber: 42,
    repo: "owner/repo-alpha",
    status: "success",
    createdAt: FIXED_TIMESTAMP,
    lastUpdatedAt: FIXED_TIMESTAMP_COMPLETED,
    startedAt: FIXED_TIMESTAMP_STARTED,
    completedAt: FIXED_TIMESTAMP_COMPLETED,
    prUrl: "https://github.com/owner/repo-alpha/pull/10",
    priority: "normal",
    totalCostUsd: 0.025,
    cacheHitRatio: 0.72,
  } as Job,
  {
    id: "job-002",
    issueNumber: 55,
    repo: "owner/repo-beta",
    status: "failure",
    createdAt: FIXED_TIMESTAMP,
    lastUpdatedAt: FIXED_TIMESTAMP_COMPLETED,
    startedAt: FIXED_TIMESTAMP_STARTED,
    completedAt: FIXED_TIMESTAMP_COMPLETED,
    error: "TypeScript compilation failed",
    priority: "high",
    totalCostUsd: 0.012,
    cacheHitRatio: 0.45,
  } as Job,
  {
    id: "job-003",
    issueNumber: 67,
    repo: "owner/repo-alpha",
    status: "running",
    createdAt: FIXED_TIMESTAMP,
    lastUpdatedAt: FIXED_TIMESTAMP,
    startedAt: FIXED_TIMESTAMP_STARTED,
    priority: "normal",
    progress: 60,
    currentStep: "Running tests",
    totalCostUsd: 0.008,
    cacheHitRatio: 0.6,
  } as Job,
  {
    id: "job-004",
    issueNumber: 78,
    repo: "owner/repo-gamma",
    status: "queued",
    createdAt: FIXED_TIMESTAMP,
    priority: "low",
  } as Job,
];

export const JOBS_WITH_DATA_RESPONSE = {
  jobs: JOBS_WITH_DATA,
  queue: { ...QUEUE_STATUS, pending: 1, running: 1 },
  pagination: makePagination(JOBS_WITH_DATA.length),
};

// ── /api/stats fixture ──────────────────────────────────────────────────────

export const EMPTY_STATS_RESPONSE: StatsResponse = {
  total: 0,
  successCount: 0,
  failureCount: 0,
  runningCount: 0,
  queuedCount: 0,
  cancelledCount: 0,
  avgDurationMs: 0,
  successRate: 0,
  project: null,
  timeRange: "7d",
};

export const STATS_WITH_DATA_RESPONSE: StatsResponse = {
  total: 4,
  successCount: 1,
  failureCount: 1,
  runningCount: 1,
  queuedCount: 1,
  cancelledCount: 0,
  avgDurationMs: 300000,
  successRate: 25,
  project: null,
  timeRange: "7d",
};
