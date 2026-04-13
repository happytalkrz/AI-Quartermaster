import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: 'list',
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
      name: 'visual',
      testDir: './tests/visual',
      snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3100',
        screenshot: 'on',
      },
    },
  ],
  webServer: {
    command: 'tsx src/cli.ts start --port 3100',
    url: 'http://localhost:3100/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 30000,
  },
});
