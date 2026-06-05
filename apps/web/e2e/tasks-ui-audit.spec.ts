import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

// 一次性审计：任务卡片新版（宽度 / 拖拽手柄 / 项目色块 / 完成度环 / 分组切换）。
const OUT = 'screenshots/tasks-ui-audit';

test('任务列表：按优先级（含项目色块/完成度/拖拽手柄）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/tasks');
  await page.screenshot({ path: `${OUT}/priority-dark.png`, fullPage: true });

  // 拖拽手柄存在（grip）
  const handles = page.locator('[aria-label="拖拽排序"]');
  expect(await handles.count(), 'drag handles render').toBeGreaterThan(0);
  // 分组切换按钮存在
  await expect(page.getByRole('button', { name: '按项目' })).toBeVisible();
  await expect(page.getByRole('button', { name: '按优先级' })).toBeVisible();
});

test('任务列表：切到「按项目」分组', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/tasks');
  await page.getByRole('button', { name: '按项目' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/project-dark.png`, fullPage: true });

  // 项目名应作为分组标题出现（fixtures 有「公司建设」）
  await expect(page.getByRole('heading', { name: '公司建设' })).toBeVisible();
});

test('任务列表：浅色主题（按优先级）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'light');
  await visit(page, '/tasks');
  await page.screenshot({ path: `${OUT}/priority-light.png`, fullPage: true });
});
