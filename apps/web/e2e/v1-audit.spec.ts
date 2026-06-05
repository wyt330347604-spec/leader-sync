import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

const OUT = 'screenshots/v1-audit';

test('驾驶舱「项目」tab：项目组合 + 健康度 + 子项目下钻', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey'); // admin → 默认进项目 tab
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/portfolio.png`, fullPage: true });

  // 「项目」tab 存在且默认选中
  await expect(page.getByRole('button', { name: '项目', exact: true })).toBeVisible();
  // 至少出现一个项目名
  await expect(page.getByRole('heading', { name: '公司建设' })).toBeVisible();

  // 展开有子项目的项目卡片
  await page.getByRole('heading', { name: '公司建设' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/portfolio-expanded.png`, fullPage: true });
  await expect(page.getByText('支付通道接入', { exact: false })).toBeVisible();
});

test('项目 tab：时间线（分层甘特）视图 + 下钻', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.waitForTimeout(500);
  // 切到时间线视图
  await page.getByRole('button', { name: '时间线', exact: true }).click();
  await page.waitForTimeout(400);
  // 展开公司建设（甘特行）→ 再展开子项目
  await page.getByRole('button', { name: /公司建设/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /支付通道接入/ }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/timeline.png`, fullPage: true });
  // 任务 bar 出现（对接Stripe）
  await expect(page.getByText('对接Stripe', { exact: false })).toBeVisible();
});
