import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

test('组织架构：admin 视角树渲染 + 拖拽调整 + 手动徽章 + 恢复飞书默认', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/org');

  // 树渲染：Tobi 根节点、Harvey 挂其下、张三/李四挂 Harvey 下
  await expect(page.getByText('组织架构').first()).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_boss')).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_harvey')).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_alice')).toBeVisible();
  await page.screenshot({ path: 'screenshots/org-audit/tree-admin.png', fullPage: true });

  // 拖拽：把张三(ou_dev_alice) 拖到 Tobi(ou_dev_boss) 下
  const alice = page.getByTestId('org-node-ou_dev_alice');
  const boss = page.getByTestId('org-node-ou_dev_boss');
  await alice.dragTo(boss, { timeout: 10_000 });
  await page.waitForTimeout(1200);

  // 拖拽后：出现「手动调整」徽章（exact 匹配，避免命中页头提示文案的子串）
  await expect(page.getByText('手动调整', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'screenshots/org-audit/after-drag.png', fullPage: true });

  // 恢复飞书默认按钮（manual 行常显）
  await expect(page.getByText('恢复飞书默认').first()).toBeVisible();
  await page.getByText('恢复飞书默认').first().click();
  await page.waitForTimeout(1200);
  await expect(page.getByText('手动调整', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/org-audit/after-reset.png', fullPage: true });
});

test('组织架构：员工视角只读（无拖拽手柄）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_alice');
  await setTheme(page, 'dark');
  await visit(page, '/org');

  await expect(page.getByTestId('org-node-ou_dev_boss')).toBeVisible();
  // 只读：节点不可拖拽（无 draggable 属性为 true 的行）
  const draggable = await page.getByTestId('org-node-ou_dev_alice').getAttribute('draggable');
  expect(draggable).toBe('false');
  await page.screenshot({ path: 'screenshots/org-audit/tree-employee.png', fullPage: true });
});
