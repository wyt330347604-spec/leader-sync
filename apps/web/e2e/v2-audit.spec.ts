import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';
const OUT = 'screenshots/v2-audit';
test('项目卡片显示关联事故徽章', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/incident-badge.png`, fullPage: true });
  await expect(page.getByText(/\d+ 事故/).first()).toBeVisible();
});
