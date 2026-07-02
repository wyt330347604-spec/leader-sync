import { defineConfig, devices } from '@playwright/test';

// 一次性配置：仅跑 perm-audit.spec.ts（权限 tab 显隐审计），不做基线比对。
export default defineConfig({
  testDir: './e2e',
  testMatch: /(perm-audit|tasks-ui-audit|v0-audit|v1-audit|v1d-audit|v0b-audit|v2-audit|v2c-audit|r0-audit|org-audit)\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
