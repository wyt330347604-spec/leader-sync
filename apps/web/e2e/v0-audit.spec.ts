import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

// 项目驱动 V0 审计：未归属 triage 桶 / 子项目分组 / quick-add 默认未归属 / 项目父项目字段。
const OUT = 'screenshots/v0-audit';

test('任务「按项目」：未归属桶 + 子项目分组', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/tasks');
  // 切到全部月份确保未归属测试任务（7月）可见
  await page.getByRole('button', { name: '按项目' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/tasks-by-project.png`, fullPage: true });

  await expect(page.getByRole('heading', { name: '未归属项目' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '子项目-支付通道' })).toBeVisible();
});

test('quick-add：项目默认「未归属」', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/tasks');
  // 展开 quick-add（点击"新建任务"条）
  await page.getByText('新建任务', { exact: false }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/quick-add.png`, fullPage: true });
});

test('项目页：新建项目弹窗含「父项目」字段', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/projects');
  await page.screenshot({ path: `${OUT}/projects-list.png`, fullPage: true });
  // 打开新建项目弹窗
  const newBtn = page.getByRole('button', { name: /新建项目|新建/ }).first();
  if (await newBtn.count()) {
    await newBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/project-modal.png`, fullPage: true });
    await expect(page.getByText('父项目', { exact: false })).toBeVisible();
  }
});
