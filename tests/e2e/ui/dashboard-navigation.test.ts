import { test, expect } from '@playwright/test';

const VIEWS = ['dashboard', 'logs', 'repositories', 'automations', 'settings'] as const;
type ViewName = typeof VIEWS[number];

// Header nav only exposes dashboard and logs
const HEADER_NAV_VIEWS: ViewName[] = ['dashboard', 'logs'];

test.describe('Dashboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('초기 상태: dashboard 뷰가 active', async ({ page }) => {
    await expect(page.locator('#view-dashboard')).toHaveClass(/active/);

    for (const view of VIEWS.filter((v) => v !== 'dashboard')) {
      await expect(page.locator(`#view-${view}`)).not.toHaveClass(/active/);
    }

    await expect(page.locator('#sidebar-nav a[data-nav="dashboard"]')).toHaveClass(/nav-item-active/);
  });

  // ── Sidebar navigation ──────────────────────────────────────────────────────

  for (const view of VIEWS) {
    test(`사이드바 → ${view}: 해당 뷰 활성화`, async ({ page }) => {
      await page.locator(`#sidebar-nav a[data-nav="${view}"]`).click();

      // Target view gains active class
      await expect(page.locator(`#view-${view}`)).toHaveClass(/active/);

      // All other views lose active class
      for (const other of VIEWS.filter((v) => v !== view)) {
        await expect(page.locator(`#view-${other}`)).not.toHaveClass(/active/);
      }

      // Clicked sidebar item gains nav-item-active
      await expect(page.locator(`#sidebar-nav a[data-nav="${view}"]`)).toHaveClass(/nav-item-active/);

      // All other sidebar items lose nav-item-active
      for (const other of VIEWS.filter((v) => v !== view)) {
        await expect(page.locator(`#sidebar-nav a[data-nav="${other}"]`)).not.toHaveClass(/nav-item-active/);
      }
    });
  }

  // ── Header navigation ───────────────────────────────────────────────────────

  for (const view of HEADER_NAV_VIEWS) {
    test(`헤더 nav → ${view}: 해당 뷰 활성화`, async ({ page }) => {
      // Navigate away first so we have a meaningful transition to test
      const startView: ViewName = view === 'dashboard' ? 'logs' : 'dashboard';
      await page.locator(`#sidebar-nav a[data-nav="${startView}"]`).click();
      await expect(page.locator(`#view-${startView}`)).toHaveClass(/active/);

      // Click header nav link
      await page.locator(`header nav a[data-nav="${view}"]`).click();

      // Target view becomes active
      await expect(page.locator(`#view-${view}`)).toHaveClass(/active/);

      // Previous view becomes inactive
      await expect(page.locator(`#view-${startView}`)).not.toHaveClass(/active/);

      // Active header link has border-b-2
      await expect(page.locator(`header nav a[data-nav="${view}"]`)).toHaveClass(/border-b-2/);

      // Inactive header links do not have border-b-2
      for (const other of HEADER_NAV_VIEWS.filter((v) => v !== view)) {
        await expect(page.locator(`header nav a[data-nav="${other}"]`)).not.toHaveClass(/border-b-2/);
      }
    });
  }

  // ── Full cycle traversal ─────────────────────────────────────────────────────

  test('5개 뷰 순회: 사이드바로 모든 뷰 전환 검증', async ({ page }) => {
    for (const view of VIEWS) {
      await page.locator(`#sidebar-nav a[data-nav="${view}"]`).click();

      await expect(page.locator(`#view-${view}`)).toHaveClass(/active/);
      await expect(page.locator(`#sidebar-nav a[data-nav="${view}"]`)).toHaveClass(/nav-item-active/);

      // Exactly one view-panel should be active at any time
      const activePanels = page.locator('.view-panel.active');
      await expect(activePanels).toHaveCount(1);
    }
  });
});
