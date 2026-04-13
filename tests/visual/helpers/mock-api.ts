import type { Page } from "@playwright/test";
import {
  EMPTY_JOBS_RESPONSE,
  JOBS_WITH_DATA_RESPONSE,
  EMPTY_STATS_RESPONSE,
  STATS_WITH_DATA_RESPONSE,
} from "../fixtures/dashboard-data.js";

/** route.fulfill()으로 API를 stub하는 공용 헬퍼 */

/**
 * 대시보드 초기 로드에 필요한 모든 API endpoint를 stub한다.
 * jobs: 빈 목록, stats: 초기값 0
 */
export async function mockDashboardApiEmpty(page: Page): Promise<void> {
  await page.route("**/api/jobs*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_JOBS_RESPONSE),
    });
  });

  await page.route("**/api/stats*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_STATS_RESPONSE),
    });
  });

  await page.route("**/api/stats/projects*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ timeRange: "7d", projects: [] }),
    });
  });

  await page.route("**/api/stats/costs*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        project: null,
        timeRange: "30d",
        groupBy: "project",
        summary: {
          totalCostUsd: 0,
          jobCount: 0,
          avgCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          cacheHitRatio: 0,
        },
        breakdown: [],
      }),
    });
  });
}

/**
 * 대시보드 초기 로드에 필요한 모든 API endpoint를 stub한다.
 * jobs: 샘플 데이터 포함, stats: 집계값 포함
 */
export async function mockDashboardApiWithData(page: Page): Promise<void> {
  await page.route("**/api/jobs*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(JOBS_WITH_DATA_RESPONSE),
    });
  });

  await page.route("**/api/stats*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STATS_WITH_DATA_RESPONSE),
    });
  });

  await page.route("**/api/stats/projects*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeRange: "7d",
        projects: [
          {
            project: "owner/repo-alpha",
            total: 2,
            successCount: 1,
            failureCount: 0,
            successRate: 50,
            avgDurationMs: 300000,
            totalCostUsd: 0.033,
            avgCostUsd: 0.0165,
          },
          {
            project: "owner/repo-beta",
            total: 1,
            successCount: 0,
            failureCount: 1,
            successRate: 0,
            avgDurationMs: 300000,
            totalCostUsd: 0.012,
            avgCostUsd: 0.012,
          },
        ],
      }),
    });
  });

  await page.route("**/api/stats/costs*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        project: null,
        timeRange: "30d",
        groupBy: "project",
        summary: {
          totalCostUsd: 0.045,
          jobCount: 3,
          avgCostUsd: 0.015,
          totalInputTokens: 50000,
          totalOutputTokens: 10000,
          totalCacheCreationTokens: 5000,
          totalCacheReadTokens: 30000,
          cacheHitRatio: 0.6,
        },
        breakdown: [
          {
            label: "owner/repo-alpha",
            totalCostUsd: 0.033,
            jobCount: 2,
            avgCostUsd: 0.0165,
            totalInputTokens: 30000,
            totalOutputTokens: 6000,
            totalCacheCreationTokens: 3000,
            totalCacheReadTokens: 20000,
            cacheHitRatio: 0.67,
          },
        ],
      }),
    });
  });
}

/**
 * SSE 스트림 endpoint를 stub하여 연결을 즉시 닫는다.
 * visual 테스트에서 실시간 업데이트로 인한 flaky를 방지한다.
 */
export async function mockSseEndpoint(page: Page): Promise<void> {
  await page.route("**/api/events*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "",
    });
  });
}
