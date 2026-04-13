import { test, expect, type Page } from '@playwright/test';

const MOCK_CONFIG = {
  projects: [
    {
      repo: 'owner/test-repo',
      path: '/home/user/test-repo',
      baseBranch: 'main',
      mode: 'auto',
      commands: {
        test: 'npm test',
        typecheck: 'npx tsc --noEmit',
        build: 'npm run build',
        lint: 'npx eslint src/',
        preInstall: '',
      },
    },
  ],
  general: {
    projectName: 'test-project',
    instanceLabel: 'local',
    instanceOwners: [],
    logLevel: 'info',
    logDir: './logs',
    dryRun: false,
    locale: 'ko',
    concurrency: 1,
    targetRoot: '/home/user',
    stuckTimeoutMs: 300000,
    pollingIntervalMs: 60000,
    maxJobs: 10,
    autoUpdate: false,
  },
  safety: {
    sensitivePaths: [],
    maxPhases: 10,
    maxRetries: 3,
    maxTotalDurationMs: 3600000,
    maxFileChanges: 50,
    maxInsertions: 1000,
    maxDeletions: 500,
    requireTests: true,
    blockDirectBasePush: true,
    timeouts: {},
    stopConditions: [],
    allowedLabels: [],
    rollbackStrategy: 'failed-only',
    feasibilityCheck: true,
    strict: false,
    rules: {},
  },
  review: {
    enabled: true,
    rounds: 2,
    simplify: false,
    unifiedMode: true,
  },
};

async function setupConfigMock(page: Page): Promise<void> {
  await page.route('/api/config', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ config: MOCK_CONFIG }),
    });
  });
}

async function navigateToSettings(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#sidebar-nav a[data-nav="settings"]').click();
  await expect(page.locator('#view-settings')).toHaveClass(/active/);
  // Wait for project cards to be rendered (currentConfig loaded)
  await page.waitForSelector('#settings-content .group', { state: 'attached' });
}

test.describe('프로젝트 편집 모달 Visual Regression', () => {
  test('edit-project-modal 오픈 상태', async ({ page }) => {
    await setupConfigMock(page);
    await navigateToSettings(page);

    // editProject()를 직접 호출해 모달 오픈 (hover 인터랙션 우회)
    await page.evaluate(() => {
      (window as Window & { editProject: (repo: string) => void }).editProject(
        'owner/test-repo'
      );
    });

    await expect(page.locator('#edit-project-modal')).toBeVisible();

    await expect(page).toHaveScreenshot('project-edit-modal-open.png');
  });
});
