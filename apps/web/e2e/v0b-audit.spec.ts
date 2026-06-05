import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

const OUT = 'screenshots/v0b-audit';

test('未归属批量归类：选择模式 + 底部操作条', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/tasks');
  await page.getByRole('button', { name: '批量归类', exact: true }).click();
  await page.waitForTimeout(300);
  // 选中前两张卡片（点卡片主体即选中）
  const titles = page.locator('h3.truncate');
  await titles.nth(0).click();
  await titles.nth(1).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/select-mode.png`, fullPage: true });
  await expect(page.getByText(/已选 \d+ 项/)).toBeVisible();
  await expect(page.getByText('挂上', { exact: true })).toBeVisible();
});
