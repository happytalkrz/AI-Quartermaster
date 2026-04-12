import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'src/': new URL('./src/', import.meta.url).pathname,
    },
  },
  test: {
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});