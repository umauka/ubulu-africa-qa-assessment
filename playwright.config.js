import { defineConfig } from '@playwright/test';
import { env } from './api-tests/config/env.js';

/**
 * API-only suite (Restful Booker, local instance) — no browsers/projects.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './api-tests/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],
  use: {
    baseURL: env.baseURL,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    trace: 'on-first-retry',
  },
});
