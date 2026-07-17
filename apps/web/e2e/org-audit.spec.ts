import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

// /org 已从 CSS ul/li + HTML5 dragTo 拖拽树重写为 React Flow（@xyflow/react）画布。
// React Flow 的拖拽由节点对象的 `draggable` prop 控制（org-canvas.tsx），不再是 DOM
// draggable 属性，且拖拽落点判定依赖真实指针事件序列，Playwright 的 .dragTo() 对
// React Flow canvas 不可靠。因此本文件只做静态渲染 + 权限断言：
//   - 拖拽调整上级（manager reassignment）
//   - 拖拽后出现的「手动」徽章
//   - 「恢复为飞书通讯录的上级」按钮（manual 行才出现）
// 这三项已通过 org-canvas-audit.spec.ts 的截图 + 人工审计确认，不在此重复模拟拖拽。

test('组织架构：admin 视角画布渲染 + 隐藏/恢复入口', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/org');

  await expect(page.getByText('组织架构').first()).toBeVisible();
  await expect(page.getByTestId('org-canvas')).toBeVisible();

  // 树渲染：dev fixture 中默认（未隐藏）可见节点 —— Tobi(boss)/Harvey/李四(bob)/王五(carol)
  await expect(page.getByTestId('org-node-ou_dev_boss')).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_harvey')).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_bob')).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_carol')).toBeVisible();

  // admin 编辑态：至少一个节点带「隐藏（不入目录）」图标按钮
  await expect(page.getByRole('button', { name: '隐藏（不入目录）' }).first()).toBeVisible();

  // 「显示已隐藏」切换：admin 专属入口，点击后按钮文案切到隐藏态
  const showHiddenToggle = page.getByRole('button', { name: /显示已隐藏/ });
  await expect(showHiddenToggle).toBeVisible();
  await showHiddenToggle.click();
  await page.waitForTimeout(700);
  await expect(page.getByRole('button', { name: '隐藏已离职/隐藏成员' })).toBeVisible();

  await page.screenshot({ path: 'screenshots/org-audit/tree-admin.png', fullPage: true });
});

test('组织架构：员工视角只读（无隐藏/恢复入口）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_alice');
  await setTheme(page, 'dark');
  await visit(page, '/org');

  await expect(page.getByTestId('org-canvas')).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_boss')).toBeVisible();
  await expect(page.getByTestId('org-node-ou_dev_harvey')).toBeVisible();

  // 只读：员工看不到隐藏按钮，也看不到「显示已隐藏」切换（both admin-only）
  await expect(page.getByRole('button', { name: '隐藏（不入目录）' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /显示已隐藏/ })).toHaveCount(0);

  await page.screenshot({ path: 'screenshots/org-audit/tree-employee.png', fullPage: true });
});
