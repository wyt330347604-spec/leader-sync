import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit, API_URL } from './helpers';
const OUT = 'screenshots/v2c-audit';

test('事故表单：关联项目选择器', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/incidents/create');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/incident-form.png`, fullPage: true });
  await expect(page.getByText('关联项目（可选）')).toBeVisible();
});

test('事故列表：按项目过滤（含无涉及人事故，不崩溃）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/incidents?project=proj_dev_indo');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/incidents-filtered.png`, fullPage: true });
  await expect(page.getByText('已按项目过滤关联事故')).toBeVisible();
});

test('V2d：逾期任务 → 建议登记事故', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  const res = await context.request.post(`${API_URL}/api/v1/tasks`, {
    data: { title: '逾期演示任务', priority: 'urgent_important', assignee_user_id: 'ou_dev_harvey', due_at: '2026-01-15' },
  });
  const body = await res.json();
  const uid = body?.data?.taskUid ?? body?.data?.task_uid;
  await visit(page, `/tasks?task=${uid}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/suggest-incident.png`, fullPage: true });
  await expect(page.getByText('建议登记事故', { exact: false })).toBeVisible();
});
