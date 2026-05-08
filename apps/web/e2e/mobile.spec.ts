import { test } from '@playwright/test';
import { devLogin, setTheme, visit, snap } from './helpers';

/**
 * Responsive audit. Each test runs once per project (desktop / mobile / tablet)
 * because of playwright.config.ts `projects`. Snapshot file names include
 * the project name so we get separate baselines per viewport.
 */
test.describe('Responsive visual audit', () => {
  test.beforeEach(async ({ context, page }) => {
    await setTheme(page, 'dark');
    await devLogin(context);
  });

  test('r01-tasks', async ({ page }) => {
    await visit(page, '/tasks');
    await snap(page, 'r01-tasks');
  });

  test('r02-tasks-create', async ({ page }) => {
    await visit(page, '/tasks/create');
    await snap(page, 'r02-tasks-create');
  });

  test('r03-task-detail', async ({ page }) => {
    await visit(page, '/tasks/task_dev_002');
    await snap(page, 'r03-task-detail');
  });

  test('r04-projects', async ({ page }) => {
    await visit(page, '/projects');
    await snap(page, 'r04-projects');
  });

  test('r05-dashboard', async ({ page }) => {
    await visit(page, '/dashboard');
    await snap(page, 'r05-dashboard');
  });

  test('r06-settings', async ({ page }) => {
    await visit(page, '/settings/notifications');
    await snap(page, 'r06-settings');
  });

  test('r07-quickadd-expanded', async ({ page }) => {
    await visit(page, '/tasks');
    await page.getByRole('button', { name: '新建任务' }).first().click();
    await page.waitForTimeout(400);
    await snap(page, 'r07-quickadd-expanded');
  });
});
