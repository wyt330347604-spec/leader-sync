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

test('动画：完成任务 → 绿色脉冲反馈（全部视图）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/tasks');
  // 等到真正加载完成（出现「新建任务」入口），避免停在跳转登录态
  await expect(page.getByRole('button', { name: '新建任务' })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/cleanup-audit/03-tasks-baseline.png', fullPage: true });
  // 切到「状态=全部」(第 2 个"全部"，第 1 个是角色筛选)，完成态任务不被过滤，便于看绿色脉冲
  await page.getByRole('button', { name: '全部', exact: true }).nth(1).click();
  await page.waitForTimeout(700);
  const doneBtn = page.getByRole('button', { name: '完成', exact: true }).first();
  await expect(doneBtn).toBeVisible({ timeout: 10000 });
  await doneBtn.click();
  await page.waitForTimeout(450); // 脉冲进行中
  await page.screenshot({ path: 'screenshots/cleanup-audit/04-complete-flash.png', fullPage: true });
});
