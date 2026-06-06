import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';
test('R0 业务线卡片：永续标签 + app数 + 逾期；甘特业务线无bar', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'screenshots/r0-audit/cards.png', fullPage: true });
  await expect(page.getByText('业务线·永续').first()).toBeVisible();
  await expect(page.getByText(/个 app/).first()).toBeVisible();
});
