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

test('R1 安全：非 PM 员工看不到「人力容量」管理 tab', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_alice'); // employee
  await setTheme(page, 'dark');
  await visit(page, '/requirements');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/r1-audit/08-nonpm-no-capacity-tab.png', fullPage: true });
  await expect(page.getByRole('button', { name: '需求看板' })).toBeVisible();
  await expect(page.getByRole('button', { name: '人力容量' })).toHaveCount(0);
});

test('R1 流程清晰化：看板列负责人 + 流程说明图例', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/requirements');
  await page.waitForTimeout(700);
  // 展开流程说明
  await page.getByText(/需求流程说明/).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/r1-audit/09-flow-legend.png', fullPage: true });
  await expect(page.getByText('提出人 · 待 PM 认领').first()).toBeVisible();
});

test('R1 流程清晰化：详情当前步提示 + 回退原因弹窗', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/requirements');
  await page.waitForTimeout(700);
  // 打开一张「开发」态的卡片（有退回选项）
  const card = page.locator('button').filter({ hasText: /风控规则引擎升级|数据看板实时化|对账中心自动化/ }).first();
  await card.click();
  await expect(page.getByText('流程进度')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/r1-audit/10-detail-step-hint.png', fullPage: true });
  // 触发回退/驳回原因弹窗（驳回任意态可用）
  const rejectBtn = page.getByRole('button', { name: /驳回|退回/ }).first();
  if (await rejectBtn.count()) {
    await rejectBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/r1-audit/11-transition-reason.png', fullPage: true });
  }
});

test('R1c 业务线概览需求计数联动', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/r1-audit/07-portfolio-reqcount.png', fullPage: true });
});
