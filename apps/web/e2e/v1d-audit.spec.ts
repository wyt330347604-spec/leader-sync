import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

const OUT = 'screenshots/v1d-audit';

test('项目 tab：卡片显示 PIC + PIC 过滤器', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/portfolio-pic.png`, fullPage: true });
  await expect(page.getByText('PIC Harvey', { exact: false })).toBeVisible();
  await expect(page.getByText('PIC', { exact: true }).first()).toBeVisible(); // 过滤器标签
});

test('项目弹窗：PIC 负责人选择器', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/projects');
  const newBtn = page.getByRole('button', { name: /新建项目|新建/ }).first();
  await newBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/modal-pic.png`, fullPage: true });
  await expect(page.getByText('PIC 负责人', { exact: false })).toBeVisible();
});
