import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

test('R1b 需求池看板 + 提需求表单（含 P0 影响评估）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/requirements');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/r1-audit/01-kanban.png', fullPage: true });
  await expect(page.getByRole('heading', { name: '需求池' })).toBeVisible();

  // 提需求表单
  await page.getByRole('button', { name: '+ 提需求' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/r1-audit/02-form.png', fullPage: true });

  // 选 P0 → 触发影响评估（需要业务线 + 期望上线）
  await page.getByRole('button', { name: 'P0', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/r1-audit/03-form-p0.png', fullPage: true });
});

test('R1 需求甘特 + 人力容量甘特', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/requirements');
  await page.getByRole('button', { name: '需求甘特' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/r1-audit/04-req-gantt.png', fullPage: true });

  await page.getByRole('button', { name: '人力容量' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/r1-audit/05-capacity.png', fullPage: true });
});

test('R1c 需求详情：stepper + 流转 + 任务 + 产出物', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/requirements');
  await page.waitForTimeout(800);
  // 点开第一张需求卡片
  const card = page.locator('button').filter({ hasText: /PM·|待认领/ }).first();
  await card.click();
  await expect(page.getByText('流程进度')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/r1-audit/06-detail.png', fullPage: true });
});

test('R1c 业务线概览需求计数联动', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/r1-audit/07-portfolio-reqcount.png', fullPage: true });
});
