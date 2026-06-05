import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

// 一次性权限审计：验证「全员概览 / 我的团队」tab 按角色显隐。
// 不做基线比对，仅断言 + 落地截图到 screenshots/perm-audit/。

const OUT = 'screenshots/perm-audit';

test('employee 仅见「我的完成情况」tab', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_alice'); // role=employee
  await setTheme(page, 'dark');

  const seen: { url: string; status: number }[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/dashboard/')) seen.push({ url: r.url(), status: r.status() });
  });

  await visit(page, '/dashboard');
  await page.screenshot({ path: `${OUT}/employee-dashboard.png`, fullPage: true });

  console.log('[employee] dashboard requests:', JSON.stringify(seen));

  await expect(page.getByRole('button', { name: '我的完成情况' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Boss 全员概览' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我的团队' })).toHaveCount(0);

  // 关键：员工不应触发 /boss 或 /gantt 请求（SWR 已 gating）。
  const boss = seen.filter((r) => r.url.includes('/dashboard/boss') || r.url.includes('/dashboard/gantt'));
  expect(boss, `employee should not call boss/gantt, saw: ${JSON.stringify(boss)}`).toHaveLength(0);
});

test('admin 可见全部三个 tab', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey'); // role=admin
  await setTheme(page, 'dark');
  await visit(page, '/dashboard');
  await page.screenshot({ path: `${OUT}/admin-dashboard.png`, fullPage: true });

  await expect(page.getByRole('button', { name: 'Boss 全员概览' })).toBeVisible();
  await expect(page.getByRole('button', { name: '我的团队' })).toBeVisible();
  await expect(page.getByRole('button', { name: '我的完成情况' })).toBeVisible();
});
