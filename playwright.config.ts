import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config/env.js';

/**
 * `TEST_REPORT_NAME` lets Drone (or a local run) point the JSON reporter's output file at a
 * suite-specific name (`api-results.json`, `e2e-results.json`) without editing this file —
 * see `.drone.yml` and `scripts/notify-teams.ts`, which reads exactly these files back to
 * build the Teams summary.
 */
const jsonReportPath = `reports/${process.env.TEST_REPORT_NAME ?? 'results.json'}`;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A flaky test retried into a pass still shows up as `flaky` (not `passed`) in the JSON
  // report's stats — that distinction is exactly what the Teams summary reports on.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: jsonReportPath }],
  ],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'api',
      testDir: 'tests/api',
      use: {
        baseURL: env.API_BASE_URL,
      },
    },
    {
      name: 'e2e',
      testDir: 'tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.BASE_URL,
      },
    },
  ],
});
