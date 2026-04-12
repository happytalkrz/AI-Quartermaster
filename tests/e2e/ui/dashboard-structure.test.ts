import { test, expect } from '@playwright/test';

test.describe('대시보드 레이아웃 구조 검증', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('사이드바 존재 및 5개 nav 항목 확인', async ({ page }) => {
    const sidebarNav = page.locator('#sidebar-nav');
    await expect(sidebarNav).toBeVisible();

    const navKeys = ['dashboard', 'logs', 'repositories', 'automations', 'settings'];
    for (const nav of navKeys) {
      await expect(page.locator(`#sidebar-nav [data-nav="${nav}"]`)).toBeVisible();
    }
  });

  test('헤더 바 + 프로젝트 셀렉터 + 테마 토글 + 언어 토글 + 접속 상태 표시 확인', async ({ page }) => {
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('#project-selector')).toBeVisible();
    await expect(page.locator('#btn-theme')).toBeVisible();
    await expect(page.locator('#lang-label')).toBeVisible();
    await expect(page.locator('#conn-dot')).toBeAttached();
    await expect(page.locator('#conn-label')).toBeAttached();
  });

  test('기본 뷰(dashboard)가 active 상태', async ({ page }) => {
    await expect(page.locator('#view-dashboard')).toHaveClass(/active/);
  });

  test('5개 view-panel 요소가 DOM에 존재', async ({ page }) => {
    const viewIds = [
      'view-dashboard',
      'view-logs',
      'view-repositories',
      'view-automations',
      'view-settings',
    ];
    for (const id of viewIds) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });
});
