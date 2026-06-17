import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

test('退役：Boss 全员概览不再有「甘特图」视图切换', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey'); // admin = canCompanyView
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.getByRole('button', { name: 'Boss 全员概览' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/cleanup-audit/01-boss-no-gantt.png', fullPage: true });
  await expect(page.getByRole('button', { name: '甘特图' })).toHaveCount(0);
});

test('合并：Boss 级不再显示独立「我的团队」tab（并入 Boss 概览·按 Leader 分组）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'screenshots/cleanup-audit/02-boss-tabs.png', fullPage: true });
  await expect(page.getByRole('button', { name: '项目', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Boss 全员概览' })).toBeVisible();
  await expect(page.getByRole('button', { name: '我的团队' })).toHaveCount(0);
});
