import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit, snap, API_URL } from './helpers';

/**
 * Error-state visual audit. Uses page.route() to intercept API calls and
 * inject failures, then snapshots how the UI presents the failure to the user.
 */
test.describe('Error states', () => {
  test.beforeEach(async ({ context, page }) => {
    await setTheme(page, 'dark');
    await devLogin(context);
  });

  test('e01-tasks-list-500', async ({ page }) => {
    // Inject 500 on the task list endpoint
    await page.route('**/api/v1/me/tasks**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ code: 5000, message: 'Internal server error', trace_id: 'tr_test', data: null }) }),
    );
    await visit(page, '/tasks');
    await snap(page, 'e01-tasks-list-500');
  });

  test('e02-projects-list-500', async ({ page }) => {
    await page.route('**/api/v1/projects', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ code: 5000, message: 'Internal server error', trace_id: 'tr_test', data: null }) }),
    );
    await visit(page, '/projects');
    await snap(page, 'e02-projects-list-500');
  });

  test('e03-task-detail-not-found', async ({ page }) => {
    await page.route('**/api/v1/tasks/task_does_not_exist', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ code: 4040, message: 'Task not found', trace_id: 'tr_test', data: null }) }),
    );
    await visit(page, '/tasks/task_does_not_exist');
    await snap(page, 'e03-task-detail-not-found');
  });

  test('e04-save-conflict-409', async ({ page }) => {
    await visit(page, '/tasks/task_dev_002');
    // Inject 409 on next PATCH
    await page.route('**/api/v1/tasks/task_dev_002', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ code: 4090, message: 'Version conflict', trace_id: 'tr_test', data: null }) });
      }
      return route.continue();
    });
    // Edit detail textarea — more reliable than range slider for triggering dirty state
    const detail = page.locator('textarea#edit_detail');
    await detail.fill('已修改的描述（用于触发 409 测试）');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '保存' }).first().click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(900); // toast appears
    await snap(page, 'e04-save-conflict-409');
  });

  test('e05-create-failed-server-500', async ({ page }) => {
    await page.route(`**/api/v1/tasks`, (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ code: 5000, message: 'Internal server error', trace_id: 'tr_test', data: null }) });
      }
      return route.continue();
    });
    // Take advanced create page (already has all fields wired); inject server fail.
    await visit(page, '/tasks/create');
    await page.locator('input#title').fill('错误注入测试任务');
    // Try to submit — error message will appear in red banner
    const submitBtn = page.getByRole('button', { name: '创建任务' });
    if (await submitBtn.isEnabled().catch(() => false)) {
      await submitBtn.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    // Whether or not submit clicked, snapshot what user sees (form likely still has validation errors)
    await snap(page, 'e05-create-failed-server-500');
  });

  test('e06-network-offline-stale', async ({ page, context }) => {
    await visit(page, '/tasks');
    // Go offline AFTER initial load so we capture cached UI + any error toast that surfaces
    await context.setOffline(true);
    // Trigger a refetch by clicking a filter
    await page.getByRole('button', { name: '已完成' }).click().catch(() => {});
    await page.waitForTimeout(1500);
    await snap(page, 'e06-network-offline-stale');
    await context.setOffline(false);
  });

  test('e07-unauthenticated-loading', async ({ page, context }) => {
    // Block the OAuth redirect so we capture the LoadingScreen rather than the
    // post-redirect blank page (browser can't reach Feishu OAuth from CI).
    await page.route('**/api/v1/auth/feishu/callback**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>OAuth would happen here</body></html>' }),
    );
    await context.clearCookies();
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    // Snap before the 800ms redirect timer fires
    await page.waitForTimeout(400);
    await snap(page, 'e07-unauthenticated-loading');
  });
});
