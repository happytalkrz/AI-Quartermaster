import { test, expect } from '@playwright/test';

// NOTE: These baselines are generated against the current dashboard state (pre-#642/#643 merge).
// After merging #642 and #643, run `npx playwright test --project=visual --update-snapshots`
// to regenerate snapshots reflecting the updated timeline/gantt rendering.

/** Fixed-timestamp mock job — deterministic bar positions across runs */
const MOCK_JOB = {
  id: 'visual-test-timeline-1',
  issueNumber: 123,
  repo: 'owner/visual-test-repo',
  status: 'success' as const,
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:05:00.000Z', // 5m 0s total
  totalCostUsd: 0.0142,
  phaseResults: [
    {
      name: 'feasibility',
      success: true,
      durationMs: 30_000,
      costUsd: 0.0021,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:30.000Z',
    },
    {
      name: 'setup',
      success: true,
      durationMs: 45_000,
      costUsd: 0.0031,
      startedAt: '2026-01-01T00:00:30.000Z',
      completedAt: '2026-01-01T00:01:15.000Z',
    },
    {
      name: 'execution',
      success: true,
      durationMs: 180_000,
      costUsd: 0.0072,
      startedAt: '2026-01-01T00:01:15.000Z',
      completedAt: '2026-01-01T00:04:15.000Z',
    },
    {
      name: 'review',
      success: false,
      durationMs: 25_000,
      costUsd: 0.0018,
      error: 'Test failure in final validation step',
      startedAt: '2026-01-01T00:04:15.000Z',
      completedAt: '2026-01-01T00:04:40.000Z',
    },
    {
      name: 'publish',
      success: undefined,
      durationMs: 0,
      costUsd: undefined,
      startedAt: undefined,
      completedAt: undefined,
    },
  ],
};

test.describe('Timeline Modal — visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Wait for the dashboard scripts (including openTimelineModal) to be available
    await page.waitForFunction(() => typeof (window as Window & { openTimelineModal?: unknown }).openTimelineModal === 'function');
  });

  test('Gantt chart — phaseResults 포함 타임라인 모달', async ({ page }) => {
    await page.evaluate((job) => {
      (window as Window & { openTimelineModal: (j: unknown) => void }).openTimelineModal(job);
    }, MOCK_JOB);

    const modal = page.locator('#timeline-modal');
    await expect(modal).toBeVisible();
    // Wait for Gantt rows to render
    await page.waitForSelector('#timeline-modal .space-y-4');

    // Mask dynamic regions:
    //   1. Header Duration + Total Cost values (.text-lg.font-mono)
    //   2. X-axis tick labels (flex row to the right of the 12rem phase-label column)
    //   3. Bar inner text — duration/cost labels rendered inside each phase bar
    const masks = [
      page.locator('#timeline-modal .text-lg.font-mono'),
      page.locator('#timeline-modal [style*="margin-left:12rem"] span'),
      page.locator('#timeline-modal .space-y-4 [style*="position:absolute"] span'),
    ];

    await expect(modal).toHaveScreenshot('timeline-modal-gantt.png', {
      mask: masks,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('Gantt chart — phaseResults 없을 때 빈 상태', async ({ page }) => {
    await page.evaluate((job) => {
      (window as Window & { openTimelineModal: (j: unknown) => void }).openTimelineModal(job);
    }, { ...MOCK_JOB, phaseResults: [] });

    const modal = page.locator('#timeline-modal');
    await expect(modal).toBeVisible();

    // Header meta may still show Duration/Cost — mask them
    const masks = [
      page.locator('#timeline-modal .text-lg.font-mono'),
    ];

    await expect(modal).toHaveScreenshot('timeline-modal-empty.png', {
      mask: masks,
      maxDiffPixelRatio: 0.02,
    });
  });
});
