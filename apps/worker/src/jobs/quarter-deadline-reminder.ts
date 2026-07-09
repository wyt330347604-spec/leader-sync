/**
 * quarter-deadline-reminder.ts
 *
 * 季度评分截止 T-2d 催办（spec 2026-07-08 performance-review-module §7）。cron 每日。
 * 对处于 scoring 的周期，找当前环节截止落在「未来 2 天内」的未完成任务，
 * 给该环节仍未提交 sheet 的评分人发催办卡（buildQuarterDeadlineCard）。
 *   pending_self          → self sheet 未提交 → 发被评人本人
 *   pending_peer_manager  → peer / manager sheet 未提交 → 发对应评分人
 *   pending_mgmt          → management sheet 未提交 → 发对应管理层
 * 同一人跨任务多张未完成 sheet 合并为一张卡（取最近截止 + 累计条数）。
 *
 * 幂等/无副作用：只读 + 发卡，不写库；重复执行只会重复提醒（cron 每日一次，可接受）。
 * 失败仅告警，绝不抛（沿用通知不阻塞契约）。
 * 支持 dry-run + 单测 + scripts/run-quarter-deadline-reminder-once.ts。
 */

import { createDb, type Database } from '@leader-sync/db';
import { quarterCycle, quarterTask, quarterSheet, orgCache } from '@leader-sync/db';
import { and, eq, inArray } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { buildQuarterDeadlineCard } from '../services/message-builder';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

interface FeishuDeps {
  sendCardMessage: (userId: string, card: object) => Promise<void>;
}

export interface QuarterDeadlineReminderOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
  feishu?: FeishuDeps;
}

export interface QuarterDeadlineReminderResult {
  cyclesChecked: number;
  tasksDueSoon: number; // 当前环节落在 T-2d 窗内的未完成任务数
  remindersSent: number; // 发出的催办卡数（去重后按人）
  dryRun: boolean;
}

const REMINDER_WINDOW_MS = 2 * 86_400_000; // T-2d

// 当前 stage → (stage_deadlines key, 需催办的 sheet 角色集)
const STAGE_MAP: Record<string, { deadlineKey: 'self' | 'peer_manager' | 'mgmt'; roles: string[] }> = {
  pending_self: { deadlineKey: 'self', roles: ['self'] },
  pending_peer_manager: { deadlineKey: 'peer_manager', roles: ['peer', 'manager'] },
  pending_mgmt: { deadlineKey: 'mgmt', roles: ['management'] },
};

function ouHandleOf(row: any): string | null {
  if (row?.openId?.startsWith('ou_')) return row.openId;
  if (row?.userId?.startsWith('ou_')) return row.userId;
  return null;
}

export async function runQuarterDeadlineReminder(
  opts: QuarterDeadlineReminderOptions = {},
): Promise<QuarterDeadlineReminderResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();
  const feishu = opts.feishu ?? feishuApi;

  const cycles: any[] = await db.select().from(quarterCycle).where(eq(quarterCycle.status, 'scoring'));
  const result: QuarterDeadlineReminderResult = { cyclesChecked: cycles.length, tasksDueSoon: 0, remindersSent: 0, dryRun };
  if (cycles.length === 0) return result;

  const quarterByCycle = new Map<string, string>(cycles.map((c) => [c.cycleUid, c.quarter]));
  const cycleUids = cycles.map((c) => c.cycleUid);

  const tasks: any[] = await db
    .select()
    .from(quarterTask)
    .where(and(inArray(quarterTask.cycleUid, cycleUids), eq(quarterTask.enrolled, true)));

  // 当前环节截止落在 (now, now+2d] 内的未完成任务
  const dueTasks = tasks.filter((t) => {
    const map = STAGE_MAP[t.stage];
    if (!map) return false; // scored / 未知 → 跳过
    const dlStr = t.stageDeadlines?.[map.deadlineKey];
    if (!dlStr) return false;
    const dl = new Date(dlStr);
    if (Number.isNaN(dl.getTime())) return false;
    return dl.getTime() > now.getTime() && dl.getTime() - now.getTime() <= REMINDER_WINDOW_MS;
  });
  result.tasksDueSoon = dueTasks.length;
  if (dueTasks.length === 0) return result;

  const taskUids = dueTasks.map((t) => t.taskUid);
  const sheets: any[] = await db.select().from(quarterSheet).where(inArray(quarterSheet.taskUid, taskUids));
  const sheetsByTask = new Map<string, any[]>();
  for (const s of sheets) {
    const arr = sheetsByTask.get(s.taskUid);
    if (arr) arr.push(s);
    else sheetsByTask.set(s.taskUid, [s]);
  }

  // 按评分人聚合未完成 sheet
  interface Pending { quarter: string; count: number; nearestDeadline: number }
  const byRater = new Map<string, Pending>();
  for (const t of dueTasks) {
    const map = STAGE_MAP[t.stage];
    const quarter = quarterByCycle.get(t.cycleUid) ?? '';
    const dl = new Date(t.stageDeadlines[map.deadlineKey]).getTime();
    const ts = sheetsByTask.get(t.taskUid) ?? [];
    for (const s of ts) {
      if (!map.roles.includes(s.raterRole)) continue;
      if (s.status === 'submitted') continue;
      const cur = byRater.get(s.raterUserId);
      if (cur) {
        cur.count += 1;
        cur.nearestDeadline = Math.min(cur.nearestDeadline, dl);
      } else {
        byRater.set(s.raterUserId, { quarter, count: 1, nearestDeadline: dl });
      }
    }
  }
  if (byRater.size === 0) return result;

  // 解析评分人 open_id + 姓名
  const raterIds = [...byRater.keys()];
  const orgRows: any[] = await db
    .select()
    .from(orgCache)
    .where(inArray(orgCache.userId, raterIds));
  // 双命名空间兜底：openId 也可能是 rater id
  const orgRows2: any[] = await db
    .select()
    .from(orgCache)
    .where(inArray(orgCache.openId, raterIds));
  const nameById = new Map<string, string | null>();
  const openById = new Map<string, string | null>();
  for (const r of [...orgRows, ...orgRows2]) {
    const ou = ouHandleOf(r);
    if (r.userId) { nameById.set(r.userId, r.userName ?? null); openById.set(r.userId, ou); }
    if (r.openId) { if (!nameById.has(r.openId)) nameById.set(r.openId, r.userName ?? null); if (!openById.has(r.openId)) openById.set(r.openId, ou); }
  }

  for (const [raterUserId, p] of byRater) {
    const target = openById.get(raterUserId) ?? (raterUserId.startsWith('ou_') ? raterUserId : null);
    if (!target) continue;
    const name = nameById.get(raterUserId) ?? raterUserId;
    const deadlineDate = new Date(p.nearestDeadline).toISOString().slice(0, 10);
    if (!dryRun) {
      const card = buildQuarterDeadlineCard(name, p.quarter, p.count, deadlineDate);
      await feishu.sendCardMessage(target, card);
    }
    result.remindersSent++;
  }

  console.log(
    `  [quarter-deadline-reminder] cycles=${result.cyclesChecked} dueTasks=${result.tasksDueSoon} reminders=${result.remindersSent}${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
