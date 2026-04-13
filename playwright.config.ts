import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
