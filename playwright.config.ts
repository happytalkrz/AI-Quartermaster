import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',
  updateSnapshots: process.env['CI'] ? 'none' : 'missing',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  projects: [
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3100',
        trace: 'on-first-retry',
      },
    },
    {
      name: 'visual-desktop',
      testDir: './tests/visual',
      snapshotDir: './tests/visual/__snapshots__',
      snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
      updateSnapshots: process.env['CI'] ? 'none' : 'missing',
    },
    {
      name: 'visual-mobile',
      testDir: './tests/visual',
      snapshotDir: './tests/visual/__snapshots__',
      snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 800 },
      },
      updateSnapshots: process.env['CI'] ? 'none' : 'missing',
    },
  ],
  webServer: {
    command: 'tsx src/cli.ts start --port 3100',
    url: 'http://localhost:3100/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 30000,
  },
});
