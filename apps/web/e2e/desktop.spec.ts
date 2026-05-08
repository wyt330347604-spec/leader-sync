import { test } from '@playwright/test';
import { devLogin, setTheme, visit, snap } from './helpers';

test.describe('Desktop visual audit', () => {
  test.beforeEach(async ({ context, page }) => {
    await setTheme(page, 'dark');
    await devLogin(context);
  });

  /* ---------- 一、core pages ---------- */
  test('01-tasks default', async ({ page }) => {
    await visit(page, '/tasks');
    await snap(page, '01-tasks-default');
  });

  test('02-tasks-create', async ({ page }) => {
    await visit(page, '/tasks/create');
    await snap(page, '02-tasks-create');
  });

  test('03-projects', async ({ page }) => {
    await visit(page, '/projects');
    await snap(page, '03-projects');
  });

  test('04-dashboard', async ({ page }) => {
    await visit(page, '/dashboard');
    await snap(page, '04-dashboard');
  });

  test('05-settings-notifications', async ({ page }) => {
    await visit(page, '/settings/notifications');
    await snap(page, '05-settings-notifications');
  });

  /* ---------- 二、/tasks 筛选状态 ---------- */
  test('06-tasks-status-done', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '已完成' }).click();
    await page.waitForTimeout(500);
    await snap(page, '06-tasks-status-done');
  });

  test('07-tasks-status-stalled', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '已停滞' }).click();
    await page.waitForTimeout(500);
    await snap(page, '07-tasks-status-stalled');
  });

  test('08-tasks-status-all', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '全部', exact: true }).nth(1).click(); // status=all
    await page.waitForTimeout(500);
    await snap(page, '08-tasks-status-all');
  });

  test('09-tasks-role-assignee', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '我负责的' }).click();
    await page.waitForTimeout(500);
    await snap(page, '09-tasks-role-assignee');
  });

  test('10-tasks-role-collaborator', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '我协作的' }).click();
    await page.waitForTimeout(500);
    await snap(page, '10-tasks-role-collaborator');
  });

  /* ---------- 三、task detail 3 states ---------- */
  test('11-task-detail-in-progress', async ({ page }) => {
    await visit(page, '/tasks/task_dev_002');  // 财务规范化推进, in_progress, urgent_important, boss_attention
    await snap(page, '11-task-detail-in-progress');
  });

  test('12-task-detail-done', async ({ page }) => {
    await visit(page, '/tasks/task_dev_014'); // 4月份月报, done
    await snap(page, '12-task-detail-done');
  });

  test('13-task-detail-overdue-delayed', async ({ page }) => {
    await visit(page, '/tasks/task_dev_011'); // 老 GitLab 迁移, delay_count=3
    await snap(page, '13-task-detail-overdue-delayed');
  });

  /* ---------- 四、interactive dialogs ---------- */
  test('14-quickadd-expanded', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '新建任务' }).first().click();
    await page.waitForTimeout(400);
    await snap(page, '14-quickadd-expanded');
  });

  test('15-list-delete-confirm', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '删除' }).first().click();
    await page.waitForTimeout(400);
    await snap(page, '15-list-delete-confirm');
  });

  test('16-detail-delay-dialog', async ({ page }) => {
    await visit(page, '/tasks/task_dev_002');
    await page.getByRole('button', { name: '延期' }).click();
    await page.waitForTimeout(400);
    await snap(page, '16-detail-delay-dialog');
  });

  test('17-detail-delete-confirm', async ({ page }) => {
    await visit(page, '/tasks/task_dev_002');
    await page.getByRole('button', { name: '删除' }).click();
    await page.waitForTimeout(400);
    await snap(page, '17-detail-delete-confirm');
  });

  test('18-leader-search-popover', async ({ page }) => {
    await visit(page, '/tasks/task_dev_002');
    await page.getByRole('button', { name: '添加 Leader' }).click();
    await page.waitForTimeout(300);
    const search = page.getByPlaceholder('搜索姓名（支持中文 / 拼音首字母）').first();
    await search.fill('张');
    await page.waitForTimeout(700);
    await snap(page, '18-leader-search-popover');
  });

  /* ---------- 五、dashboard variants ---------- */
  test('19-dashboard-by-leader', async ({ page }) => {
    await visit(page, '/dashboard');
    const tab = page.getByRole('button', { name: /按.*Leader.*分组/i });
    if (await tab.count()) await tab.first().click();
    await page.waitForTimeout(500);
    await snap(page, '19-dashboard-by-leader');
  });

  test('20-dashboard-by-project', async ({ page }) => {
    await visit(page, '/dashboard');
    const tab = page.getByRole('button', { name: /按.*项目.*分组/i });
    if (await tab.count()) await tab.first().click();
    await page.waitForTimeout(500);
    await snap(page, '20-dashboard-by-project');
  });

  test('21-dashboard-gantt', async ({ page }) => {
    await visit(page, '/dashboard');
    const ganttTab = page.getByRole('button', { name: /甘特图/ });
    if (await ganttTab.count()) await ganttTab.first().click();
    await page.waitForTimeout(800);
    await snap(page, '21-dashboard-gantt');
  });

  test('22-dashboard-quarter', async ({ page }) => {
    await visit(page, '/dashboard');
    const q = page.getByRole('button', { name: '季', exact: true });
    if (await q.count()) await q.first().click();
    await page.waitForTimeout(500);
    await snap(page, '22-dashboard-quarter');
  });

  /* ---------- 六、light theme ---------- */
  test('23-tasks-light', async ({ page, context }) => {
    await setTheme(page, 'light');
    await devLogin(context);
    await visit(page, '/tasks');
    await snap(page, '23-tasks-light');
  });

  test('24-detail-light', async ({ page, context }) => {
    await setTheme(page, 'light');
    await devLogin(context);
    await visit(page, '/tasks/task_dev_002');
    await snap(page, '24-detail-light');
  });

  test('25-settings-light', async ({ page, context }) => {
    await setTheme(page, 'light');
    await devLogin(context);
    await visit(page, '/settings/notifications');
    await snap(page, '25-settings-light');
  });

  /* ---------- 七、empty + toggle ---------- */
  test('26-tasks-empty-month', async ({ page }) => {
    await visit(page, '/tasks');
    // Click an old month with no fixtures
    const oldMonth = page.getByRole('button', { name: /2025年12月/ });
    if (await oldMonth.count()) await oldMonth.first().click();
    await page.waitForTimeout(500);
    await snap(page, '26-tasks-empty-month');
  });

  test('27-settings-after-toggle-on', async ({ page }) => {
    await visit(page, '/settings/notifications');
    // Click the daily-overdue switch (currently off → toggle to on)
    const daily = page.locator('button[role="switch"]').first();
    await daily.click();
    await page.waitForTimeout(700); // toast + state save
    await snap(page, '27-settings-after-toggle-on');
  });
});
