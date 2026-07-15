/**
 * convene-panel-check.ts
 *
 * 评分会自动召集检查（"该开评分会了"的自动触发）。cron 每日 09:20。
 * spec 2026-07-08 performance-review-module §5：scoring → panel。
 *
 * 逻辑：对处于 scoring 的周期，若其**全部 enrolled 任务都已 scored**（且至少一条参评任务），
 * 则把 cycle status 置为 panel、写 panel_at=now，并给全部 is_management 成员发评分会召集卡
 * （buildPanelConveneCard）。与 API 手动端点 POST /quarter/cycles/:uid/convene-panel 同口径
 * （API 侧 QuarterService.convenePanel），跨进程各落 glue（与 open-quarter-window/materializeCycle 一致）。
 *
 * 触发条件保守（全 scored 才召集）：具体时间/阈值口径待全面测试后再收（先能跑能测）。
 * 幂等：只选 status=scoring 的周期；召集后 status 变 panel，重复执行不再命中。
 * 通知失败仅告警不阻塞；open_id 解析不到 warn 跳过。
 * 支持 dry-run（只计数不写库/不发卡）+ 单测 + scripts/run-convene-panel-check-once.ts。
 */

import { createDb, type Database } from '@leader-sync/db';
import { quarterCycle, quarterTask, perfRole, orgCache } from '@leader-sync/db';
import { and, eq, inArray } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { buildPanelConveneCard } from '../services/message-builder';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

interface FeishuDeps {
  sendCardMessage: (userId: string, card: object) => Promise<void>;
}

export interface ConvenePanelCheckOptions {
  now?: Date;
  dryRun?: boolean;
  db?: Database;
  feishu?: FeishuDeps;
}

export interface ConvenePanelCheckResult {
  cyclesChecked: number; // status=scoring 的周期数
  convened: number; // 本次召集（转 panel）的周期数
  notified: number; // 发出的召集卡数（去重后按管理层成员）
  dryRun: boolean;
}

/** org 行的 ou_ 句柄（openId 优先），无 ou_ 返回 null。 */
function ouHandleOf(row: any): string | null {
  if (row?.openId?.startsWith('ou_')) return row.openId;
  if (row?.userId?.startsWith('ou_')) return row.userId;
  return null;
}

export async function runConvenePanelCheck(
  opts: ConvenePanelCheckOptions = {},
): Promise<ConvenePanelCheckResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();
  const feishu = opts.feishu ?? feishuApi;

  const cycles: any[] = await db.select().from(quarterCycle).where(eq(quarterCycle.status, 'scoring'));
  const result: ConvenePanelCheckResult = { cyclesChecked: cycles.length, convened: 0, notified: 0, dryRun };
  if (cycles.length === 0) {
    console.log(`  [convene-panel-check] cycles=0 convened=0 notified=0${dryRun ? ' [DRY-RUN]' : ''}`);
    return result;
  }

  const cycleUids = cycles.map((c) => c.cycleUid);
  const tasks: any[] = await db
    .select()
    .from(quarterTask)
    .where(and(inArray(quarterTask.cycleUid, cycleUids), eq(quarterTask.enrolled, true)));

  // 仅看参评任务（DB WHERE 已过滤 enrolled；JS 再兜一层，判定口径与效率两不误）。
  const tasksByCycle = new Map<string, any[]>();
  for (const t of tasks) {
    if (!t.enrolled) continue;
    const arr = tasksByCycle.get(t.cycleUid);
    if (arr) arr.push(t);
    else tasksByCycle.set(t.cycleUid, [t]);
  }

  // 保守触发：至少一条 enrolled 任务且全部 scored。
  const eligible = cycles.filter((c) => {
    const ts = tasksByCycle.get(c.cycleUid) ?? [];
    return ts.length > 0 && ts.every((t) => t.stage === 'scored');
  });
  if (eligible.length === 0) {
    console.log(`  [convene-panel-check] cycles=${result.cyclesChecked} convened=0 notified=0${dryRun ? ' [DRY-RUN]' : ''}`);
    return result;
  }

  // 管理层成员 + 姓名/open_id 解析（org_cache）。
  const mgmt: any[] = await db.select().from(perfRole).where(eq(perfRole.isManagement, true));
  const orgRows: any[] = await db.select().from(orgCache);
  const nameByAnyId = new Map<string, string | null>();
  const openByAnyId = new Map<string, string | null>();
  for (const r of orgRows) {
    const ou = ouHandleOf(r);
    if (r.userId) {
      nameByAnyId.set(r.userId, r.userName ?? null);
      openByAnyId.set(r.userId, ou);
    }
    if (r.openId) {
      if (!nameByAnyId.has(r.openId)) nameByAnyId.set(r.openId, r.userName ?? null);
      if (!openByAnyId.has(r.openId)) openByAnyId.set(r.openId, ou);
    }
  }

  for (const c of eligible) {
    result.convened += 1;
    if (!dryRun) {
      await db
        .update(quarterCycle)
        .set({ status: 'panel', panelAt: now })
        .where(eq(quarterCycle.cycleUid, c.cycleUid));
    }
    const pendingCount = (tasksByCycle.get(c.cycleUid) ?? []).filter((t) => t.mgmtRequired).length;
    for (const m of mgmt) {
      const target = ouHandleOf(m) ?? openByAnyId.get(m.userId) ?? null;
      if (!target) {
        console.warn(`  [convene-panel-check] 管理层成员 ${m.userId} 解析不到 open_id，跳过`);
        continue;
      }
      const name = nameByAnyId.get(m.userId) ?? (m.openId ? nameByAnyId.get(m.openId) ?? null : null) ?? target;
      if (!dryRun) {
        const card = buildPanelConveneCard(name, c.quarter, c.cycleUid, pendingCount);
        await feishu.sendCardMessage(target, card);
      }
      result.notified += 1;
    }
  }

  console.log(
    `  [convene-panel-check] cycles=${result.cyclesChecked} convened=${result.convened} notified=${result.notified}${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
