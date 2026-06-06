import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,                  // serial — single dev server, avoid race
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: path.join(REPO_ROOT, 'playwright-report'), open: 'never' }]],
  outputDir: path.join(REPO_ROOT, 'test-results'),
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Screenshots/baseline live at the repo root so they don't pollute apps/web
  snapshotPathTemplate: path.join(
    REPO_ROOT,
    'screenshots',
    '__baseline__',
    '{testFileDir}',
    '{testFileName}-snapshots',
    '{projectName}',
    '{arg}{ext}',
  ),
  projects: [
    {
      name: 'desktop',
      testMatch: /(desktop|error-states)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'audit',
      testMatch: /.*-audit\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'tablet',
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
      },
    },
  ],
});
