import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit, API_URL } from './helpers';
import {
  createDb,
  quarterCycle,
  quarterTask,
  quarterSheet,
  quarterSheetItem,
  quarterResult,
  quarterResultRevision,
  quarterAppeal,
  peerAssignment,
} from '@leader-sync/db';
import { and, eq, inArray } from 'drizzle-orm';

// P3 评分会 + 合成/公示/申诉 截图审计。
//
// 去 flake（2026-07-15）：不再依赖 dev 库既有 2026-Q2 数据与真实日期。beforeAll 通过 **API** 自建一个
// 专用测试周期（'2099-Q1'）并驱动出确定性状态：
//   - 王五(carol)：scored → compute → 一条 **draft** 结果（供「改分弹窗」，公示后禁改故须留 draft）
//   - 张三(alice)：scored → compute → **改分留痕** → 随公示转 published（供「评分会调整记录」）
//   - 李四(bob) ：scored → compute → 随公示转 published，**新鲜申诉窗口**（供「本人申诉表单」+「我的成绩」）
// publish 是周期级：alice+bob 一起公示得到新鲜 appeal_deadline（真实"公示+3工作日" > 运行时刻）；
// carol 在公示之后再 compute，故保持 draft。
// beforeAll/afterAll 均通过 DB 清空该周期数据（无删除 API），做到「每次运行全绿、与运行日期无关、不累积、不污染 2026 展示数据」。
// 独立测试用户为 dev 假用户 alice/bob/carol；独立 quarter '2099-Q1'。

const OUT = 'screenshots/quarter-p3-audit';
const QUARTER = '2099-Q1';
const DB_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev';

// quarterly_employee 模板四软项（1–10），goal_score ≤ 45。
const EMP_ITEMS = [
  { dimension_code: 'expertise', raw: 8 },
  { dimension_code: 'initiative', raw: 8 },
  { dimension_code: 'collaboration', raw: 8 },
  { dimension_code: 'learning', raw: 8 },
];

const db = createDb(DB_URL);

// 由 beforeAll 填充，供各 test 引用（与运行环境的既有 uid 解耦）。
let CYCLE = '';
let ALICE_RESULT = '';
let BOB_RESULT = '';

async function apiLogin(userId: string): Promise<string> {
  const r = await fetch(`${API_URL}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!r.ok) throw new Error(`dev-login ${userId} failed ${r.status}`);
  const j: any = await r.json();
  const token = j?.data?.token ?? j?.token;
  if (!token) throw new Error(`no token for ${userId}`);
  return token;
}

async function apiCall(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `token=${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await r.json().catch(() => null);
  if (r.status >= 400) {
    throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json)}`);
  }
  return json?.data ?? json;
}

/** 删除某 quarter 对应周期的全部数据（无 DB 外键，按 cycle 逐表清）。幂等。 */
async function cleanupQuarter(quarter: string) {
  const cycles = await db.select().from(quarterCycle).where(eq(quarterCycle.quarter, quarter));
  for (const c of cycles) {
    const sheets = await db
      .select({ sheetUid: quarterSheet.sheetUid })
      .from(quarterSheet)
      .where(eq(quarterSheet.cycleUid, c.cycleUid));
    const sheetUids = sheets.map((s) => s.sheetUid);
    if (sheetUids.length) await db.delete(quarterSheetItem).where(inArray(quarterSheetItem.sheetUid, sheetUids));

    const results = await db
      .select({ resultUid: quarterResult.resultUid })
      .from(quarterResult)
      .where(eq(quarterResult.cycleUid, c.cycleUid));
    const resultUids = results.map((r) => r.resultUid);
    if (resultUids.length) {
      await db.delete(quarterResultRevision).where(inArray(quarterResultRevision.resultUid, resultUids));
      await db.delete(quarterAppeal).where(inArray(quarterAppeal.resultUid, resultUids));
    }

    await db.delete(quarterResult).where(eq(quarterResult.cycleUid, c.cycleUid));
    await db.delete(quarterSheet).where(eq(quarterSheet.cycleUid, c.cycleUid));
    await db.delete(quarterTask).where(eq(quarterTask.cycleUid, c.cycleUid));
    await db.delete(peerAssignment).where(eq(peerAssignment.cycleUid, c.cycleUid));
    await db.delete(quarterCycle).where(eq(quarterCycle.cycleUid, c.cycleUid));
  }
}

/** 驱动某被评人的 employee 任务到 scored（self 本人 + manager 直属提交），返回其 taskUid。 */
async function driveToScored(cycleUid: string, rateeUserId: string): Promise<string> {
  const [task] = await db
    .select()
    .from(quarterTask)
    .where(and(eq(quarterTask.cycleUid, cycleUid), eq(quarterTask.rateeUserId, rateeUserId)));
  if (!task) throw new Error(`task not found for ${rateeUserId} in ${cycleUid}`);
  if (task.sheetType !== 'employee') {
    throw new Error(`ratee ${rateeUserId} 非 employee（${task.sheetType}），本审计仅驱动员工任务`);
  }
  const sheets = await db.select().from(quarterSheet).where(eq(quarterSheet.taskUid, task.taskUid));
  const selfSheet = sheets.find((s) => s.raterRole === 'self');
  const mgrSheet = sheets.find((s) => s.raterRole === 'manager');
  if (!selfSheet || !mgrSheet) throw new Error(`missing self/manager sheet for ${rateeUserId}`);

  // self：登录本人（= self.raterUserId）提交（先自评才解锁直属）。
  const selfTok = await apiLogin(selfSheet.raterUserId);
  await apiCall(selfTok, 'PATCH', `/api/v1/quarter/sheets/${selfSheet.sheetUid}`, {
    items: EMP_ITEMS,
    version: selfSheet.version,
  });
  // manager：登录直属（= manager.raterUserId，dev 库真实关系，勿硬编码）提交 + 目标分。
  const mgrTok = await apiLogin(mgrSheet.raterUserId);
  const res = await apiCall(mgrTok, 'PATCH', `/api/v1/quarter/sheets/${mgrSheet.sheetUid}`, {
    items: EMP_ITEMS,
    goal_score: 40,
    version: mgrSheet.version,
  });
  if (res?.stage !== 'scored') {
    throw new Error(`${rateeUserId} 未达 scored（stage=${res?.stage}）`);
  }
  return task.taskUid;
}

test.beforeAll(async () => {
  // 建库+驱动多为经 SSH 隧道的 API 往返，单次可达十余秒 → 给足 hook 预算（默认 60s 不够）。
  test.setTimeout(240_000);

  // 幂等：先清空历史遗留的同 quarter 数据，保证每次全新（公示时刻→新鲜申诉窗口）。
  await cleanupQuarter(QUARTER);

  const harvey = await apiLogin('ou_dev_harvey'); // admin：开周期/合成/改分/公示
  const created = await apiCall(harvey, 'POST', '/api/v1/quarter/cycles', { quarter: QUARTER });
  CYCLE = created?.cycle?.cycleUid;
  if (!CYCLE) throw new Error(`create cycle 失败：${JSON.stringify(created)}`);

  // 三人相互独立，并行驱动到 scored（各自 self→manager 内部仍串行）。
  const [aliceTask, bobTask, carolTask] = await Promise.all([
    driveToScored(CYCLE, 'ou_dev_alice'),
    driveToScored(CYCLE, 'ou_dev_bob'),
    driveToScored(CYCLE, 'ou_dev_carol'),
  ]);

  // alice：compute → draft → 改分留痕（评分会调整记录）。
  const aliceRes = await apiCall(harvey, 'POST', `/api/v1/quarter/tasks/${aliceTask}/result/compute`, {});
  ALICE_RESULT = aliceRes.resultUid;
  await apiCall(harvey, 'PATCH', `/api/v1/quarter/results/${ALICE_RESULT}`, {
    field: 'goal_score',
    after: '42',
    reason: '评分会现场调整目标分',
  });

  // bob：compute → draft。
  const bobRes = await apiCall(harvey, 'POST', `/api/v1/quarter/tasks/${bobTask}/result/compute`, {});
  BOB_RESULT = bobRes.resultUid;

  // 公示（周期级）：alice+bob 转 published，appeal_deadline = 公示 + 3 工作日（新鲜 > 运行时刻）。
  await apiCall(harvey, 'POST', `/api/v1/quarter/cycles/${CYCLE}/publish`);

  // carol：公示之后再 compute → 保持 draft（供 panel 改分弹窗）。
  await apiCall(harvey, 'POST', `/api/v1/quarter/tasks/${carolTask}/result/compute`, {});
});

test.afterAll(async () => {
  await cleanupQuarter(QUARTER);
});

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
  // 断言本次自建的 2099-Q1 成绩卡（dev 库可能另有历史季度成绩卡，故按周期精确匹配，避免 strict 违规）。
  await expect(page.getByText(`${QUARTER} 我的成绩`)).toBeVisible();
});

test('/quarter 管理区（周期管理 + 评分会看板入口）', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey');
  await setTheme(page, 'dark');
  await visit(page, '/quarter');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/6-quarter-admin.png`, fullPage: true });
  await expect(page.getByRole('link', { name: '评分会看板 →' }).first()).toBeVisible();
});
