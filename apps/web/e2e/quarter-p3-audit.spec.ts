import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

// P3 评分会 + 合成/公示/申诉 截图审计（依赖 dev 库 2026-Q2：alice 结果 draft、bob 结果 published）。
const OUT = 'screenshots/quarter-p3-audit';
const CYCLE = 'qc_4OuApRWKaqK-';
const ALICE_RESULT = 'qr_o8ZC9HYC-Tvw';
const BOB_RESULT = 'qr_shBzdc4s5Bji';

test('panel 全貌（管理层看板）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, `/quarter/panel?cycle=${CYCLE}`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/1-panel.png`, fullPage: true });
  await expect(page.getByRole('heading', { name: '评分会看板' })).toBeVisible();
});

test('改分弹窗', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, `/quarter/panel?cycle=${CYCLE}`);
  await page.getByRole('button', { name: '改分' }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/2-revise-dialog.png`, fullPage: true });
  await expect(page.getByText('改动字段')).toBeVisible();
});

test('结果详情：管理视角（含评分会调整记录 + 管理层个人分）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, `/quarter/result/${ALICE_RESULT}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/3-result-detail-revision.png`, fullPage: true });
  await expect(page.getByText('评分会调整记录')).toBeVisible();
});

test('结果详情：本人视角（含申诉表单）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_bob');
  await setTheme(page, 'dark');
  await visit(page, `/quarter/result/${BOB_RESULT}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/4-result-self-appeal.png`, fullPage: true });
  await expect(page.getByText('提交申诉')).toBeVisible();
});

test('/quarter 我的成绩卡（本人）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_bob');
  await setTheme(page, 'dark');
  await visit(page, '/quarter');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/5-quarter-scorecard.png`, fullPage: true });
  await expect(page.getByText('我的成绩')).toBeVisible();
});

test('/quarter 管理区（周期管理 + 评分会看板入口）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/quarter');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/6-quarter-admin.png`, fullPage: true });
  await expect(page.getByRole('link', { name: '评分会看板 →' }).first()).toBeVisible();
});
