import { test, expect, type Page } from '@playwright/test';
import {
  mockDashboardApiEmpty,
  mockDashboardApiWithData,
  mockSseEndpoint,
} from './helpers/mock-api.js';

/**
 * 스크린샷 비교에서 제외할 동적 영역 locators.
 * - #conn-dot / #conn-label: SSE 연결 상태 (점멸 + 텍스트)
 * - #version-label / #version-hash: 실행 환경별 버전 정보
 * - [data-dur]: running 잡의 실시간 duration 카운터
 * - span containing "전": relativeTime() 출력 ("N초 전", "N분 전" 등)
 * - .live-duration-ticker: 실시간 소요시간 ticker
 */
function dynamicMasks(page: Page) {
  return [
    page.locator('#conn-dot'),
    page.locator('#conn-label'),
    page.locator('#version-label'),
    page.locator('#version-hash'),
    page.locator('[data-dur]'),
    page.locator('span').filter({ hasText: /[초분시일] 전$/ }),
    page.locator('.live-duration-ticker'),
  ];
}

test.describe('대시보드 메인 페이지 visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await mockSseEndpoint(page);
  });

  test('empty 상태 — 잡 없음', async ({ page }) => {
    await mockDashboardApiEmpty(page);
    await page.goto('/');
    await page.locator('#empty-state').waitFor({ state: 'visible' });

    await expect(page).toHaveScreenshot('dashboard-empty.png', {
      mask: dynamicMasks(page),
      animations: 'disabled',
    });
  });

  test('잡 있는 상태', async ({ page }) => {
    await mockDashboardApiWithData(page);
    await page.goto('/');
    await page.locator('#job-list [data-job-id]').first().waitFor({ state: 'visible' });

    await expect(page).toHaveScreenshot('dashboard-with-jobs.png', {
      mask: dynamicMasks(page),
      animations: 'disabled',
    });
  });
});
