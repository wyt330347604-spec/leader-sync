import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

const OUT = 'screenshots/me-perf-audit';

test('/me/performance —— 本人绩效聚合（月度/季度/半年/定级资格）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_alice');
  await setTheme(page, 'dark');
  await visit(page, '/me/performance');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/1-performance.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: '我的绩效' })).toBeVisible();
  await expect(page.getByText('定级定岗资格')).toBeVisible();
});

test('/me/goals —— 本人自评视图', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_alice');
  await setTheme(page, 'dark');
  await visit(page, '/me/goals');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/2-goals-self.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: '我的半年目标' })).toBeVisible();
});

test('/me/goals?ratee —— 直属视图', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/me/goals?ratee=ou_dev_alice');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/3-goals-manager.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: '下属半年目标' })).toBeVisible();
});
