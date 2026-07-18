/**
 * open-quarter-window.ts
 *
 * 季度结束次日开窗（Harvey 定：季度结束后才开窗）。cron '5 8 1 1,4,7,10 *'
 * （每季首日 08:05 = 上一季结束次日）。
 * spec 2026-07-08 performance-review-module §3.3 §5 §10.8。
 *
 * 逻辑：算刚结束的季度 → 建 quarter_cycle（幂等，已存在跳过）→ 对 org_cache 全员
 * （score_exempt 跳过）生成 quarter_task（开窗盖章模板、enrolled 新人规则、
 * stage=pending_self、stage_deadlines）+ self/manager/peer 打分表。
 *
 * 决策逻辑（enrolled/模板/mgmt_required/stage_deadlines/sheet 集）一律走
 * domain-core 纯函数 assembleQuarterMembers + planQuarterTasks，与 API 手动开周期
 * 完全一致（抽公共函数、勿复制粘贴）；本 job 只做读库/写库 glue。
 *
 * 幂等：cycle 有唯一 quarter；task 有唯一 (cycle,ratee)；sheet 有唯一
 * (task,rater,role) + onConflictDoNothing。重复执行只补缺失，不产生重复。
 *
 * 支持 dry-run（只计数不写库）+ 单测 + scripts/run-open-quarter-window-once.ts。
 */

import { createDb, type Database } from '@leader-sync/db';
import { quarterCycle, quarterTask, quarterSheet, orgCache, perfRole, peerAssignment, scoreTemplate } from '@leader-sync/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  assembleQuarterMembers,
  planQuarterTasks,
  endedQuarterOn,
} from '@leader-sync/domain-core';
import { config } from '../config';
import { generateUid } from '../lib/uid';
import { feishuApi } from '../services/feishu-api';
import { buildQuarterSelfWindowCard } from '../services/message-builder';

let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

const WINDOW_SPAN_DAYS = 12; // 自评 3 + 同事/直属 5 + 管理层 4

interface FeishuDeps {
  sendCardMessage: (userId: string, card: object) => Promise<void>;
}

export interface OpenQuarterWindowOptions {
  /** 逻辑当前时间。默认 new Date()。 */
  now?: Date;
  /** 显式季度 'YYYY-QN'（补跑）；默认按 now 算刚结束的季度。 */
  quarter?: string;
  /** 只计算与日志，不写库。 */
  dryRun?: boolean;
  /** 给新参评被评人发「待自评」卡片。cron 传 true；默认 false（补跑不打扰）。 */
  sendCards?: boolean;
  db?: Database;
  feishu?: FeishuDeps;
}

export interface OpenQuarterWindowResult {
  quarter: string;
  cycleUid: string;
  cycleCreated: boolean;
  memberCount: number;
  taskCount: number; // 规划出的任务总数
  newTaskCount: number; // 本次新建（补缺）任务数
  sheetCount: number; // 建/尝试建的 sheet 数
  enrolledCount: number;
  skippedNewbie: number; // 新人不足 2 完整月
  noManager: number;
  noPeer: number;
  cardsSent: number; // 发出的「待自评」卡片数
  dryRun: boolean;
}

/** org 行的 ou_ 规范句柄（openId 优先），无 ou_ 返回 null。 */
function ouHandleOf(row: any): string | null {
  if (row?.openId?.startsWith('ou_')) return row.openId;
  if (row?.userId?.startsWith('ou_')) return row.userId;
  return null;
}

export async function runOpenQuarterWindow(opts: OpenQuarterWindowOptions = {}): Promise<OpenQuarterWindowResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const sendCards = opts.sendCards ?? false;
  const db = opts.db ?? defaultDb();
  const feishu = opts.feishu ?? feishuApi;
  const quarter = opts.quarter ?? endedQuarterOn(now);

  // 1. cycle（幂等：查 → 无则建）
  const existingCycles: any[] = await db.select().from(quarterCycle).where(eq(quarterCycle.quarter, quarter));
  const cycle = existingCycles[0] ?? null;
  let cycleCreated = false;
  let cycleUid: string;
  if (cycle) {
    cycleUid = cycle.cycleUid;
  } else {
    cycleUid = generateUid('qc');
    cycleCreated = true;
    if (!dryRun) {
      await db
        .insert(quarterCycle)
        .values({
          cycleUid,
          quarter,
          status: 'scoring',
          openAt: now,
          deadlineAt: new Date(now.getTime() + WINDOW_SPAN_DAYS * 86_400_000),
        })
        .onConflictDoNothing();
    }
  }
  const openAt = cycle?.openAt ?? now;

  // 2. 读装配所需数据
  const [orgRows, perfRoles, peers, templateRows, existingTasks] = await Promise.all([
    db.select().from(orgCache),
    db.select().from(perfRole),
    cycle ? db.select().from(peerAssignment).where(eq(peerAssignment.cycleUid, cycleUid)) : Promise.resolve([] as any[]),
    db
      .select()
      .from(scoreTemplate)
      .where(and(inArray(scoreTemplate.code, ['quarterly_employee', 'quarterly_leader']), eq(scoreTemplate.active, true))),
    cycle ? db.select().from(quarterTask).where(eq(quarterTask.cycleUid, cycleUid)) : Promise.resolve([] as any[]),
  ]);

  const tplByCode = new Map<string, string>((templateRows as any[]).map((t) => [t.code, t.templateUid]));

  // 3. 装配 + 规划（domain-core 纯函数）
  const members = assembleQuarterMembers({
    orgRows: (orgRows as any[]).map((r) => ({
      userId: r.userId,
      openId: r.openId,
      userName: r.userName,
      managerUserId: r.managerUserId,
      joinedAt: r.joinedAt,
      scoreExempt: r.scoreExempt,
      leftAt: r.leftAt,
      hiddenAt: r.hiddenAt,
    })),
    perfRoles: (perfRoles as any[]).map((r) => ({ userId: r.userId, openId: r.openId, isLeader: r.isLeader })),
    peers: (peers as any[]).map((p) => ({ rateeUserId: p.rateeUserId, peerUserId: p.peerUserId, peerName: p.peerName })),
  });

  const planned = planQuarterTasks({
    quarter,
    openAt,
    members,
    employeeTemplateUid: tplByCode.get('quarterly_employee') ?? null,
    leaderTemplateUid: tplByCode.get('quarterly_leader') ?? null,
  });

  // 4. 组装写库行（复用已存在 task 的 uid）
  const existingByRatee = new Map<string, any>((existingTasks as any[]).map((t) => [t.rateeUserId, t]));
  const newTaskRows: any[] = [];
  const sheetRows: any[] = [];
  // 新参评被评人的「待自评」通知目标（仅新建任务，避免补跑/重跑重复打扰）。
  const selfNotify: { rateeUserId: string; rateeName: string | null; selfSheetUid: string; deadline: string | null }[] = [];
  const result: OpenQuarterWindowResult = {
    quarter,
    cycleUid,
    cycleCreated,
    memberCount: members.length,
    taskCount: planned.length,
    newTaskCount: 0,
    sheetCount: 0,
    enrolledCount: 0,
    skippedNewbie: 0,
    noManager: 0,
    noPeer: 0,
    cardsSent: 0,
    dryRun,
  };

  for (const p of planned) {
    if (p.enrolled) result.enrolledCount++;
    else result.skippedNewbie++;
    if (p.warnings.includes('no-manager')) result.noManager++;
    if (p.warnings.includes('no-peer')) result.noPeer++;

    const existing = existingByRatee.get(p.rateeUserId);
    const taskUid = existing?.taskUid ?? generateUid('qt');
    if (!existing) {
      newTaskRows.push({
        taskUid,
        cycleUid,
        rateeUserId: p.rateeUserId,
        rateeName: p.rateeName,
        sheetType: p.sheetType,
        templateUid: p.templateUid,
        mgmtRequired: p.mgmtRequired,
        mgmtReason: p.mgmtReason,
        enrolled: p.enrolled,
        skipReason: p.skipReason,
        stage: p.stage,
        stageDeadlines: p.stageDeadlines,
      });
    }
    for (const s of p.sheets) {
      const sheetUid = generateUid('qs');
      sheetRows.push({
        sheetUid,
        cycleUid,
        taskUid,
        rateeUserId: p.rateeUserId,
        raterUserId: s.raterUserId,
        raterName: s.raterName,
        raterRole: s.raterRole,
        status: 'draft',
      });
      // 仅新参评任务的自评 sheet 记入通知目标。
      if (!existing && p.enrolled && s.raterRole === 'self') {
        selfNotify.push({
          rateeUserId: p.rateeUserId,
          rateeName: p.rateeName,
          selfSheetUid: sheetUid,
          deadline: p.stageDeadlines?.self ? String(p.stageDeadlines.self).slice(0, 10) : null,
        });
      }
    }
  }
  result.newTaskCount = newTaskRows.length;
  result.sheetCount = sheetRows.length;

  // 5. 写库
  if (!dryRun) {
    if (newTaskRows.length > 0) await db.insert(quarterTask).values(newTaskRows).onConflictDoNothing();
    if (sheetRows.length > 0) await db.insert(quarterSheet).values(sheetRows).onConflictDoNothing();
  }

  // 6. 发「待自评」卡片（best-effort，失败不阻塞开窗）。
  if (sendCards && !dryRun && selfNotify.length > 0) {
    const orgOpenById = new Map<string, string | null>();
    for (const r of orgRows as any[]) {
      const ou = ouHandleOf(r);
      if (r.userId) orgOpenById.set(r.userId, ou);
      if (r.openId && !orgOpenById.has(r.openId)) orgOpenById.set(r.openId, ou);
    }
    for (const n of selfNotify) {
      const target = orgOpenById.get(n.rateeUserId) ?? (n.rateeUserId.startsWith('ou_') ? n.rateeUserId : null);
      if (!target) continue;
      const card = buildQuarterSelfWindowCard(n.rateeName ?? n.rateeUserId, quarter, n.deadline ?? '', n.selfSheetUid);
      await feishu.sendCardMessage(target, card);
      result.cardsSent++;
    }
  }

  console.log(
    `  [open-quarter-window] quarter=${result.quarter} cycle=${cycleUid}${cycleCreated ? '(new)' : ''} ` +
      `members=${result.memberCount} tasks=${result.taskCount} newTasks=${result.newTaskCount} sheets=${result.sheetCount} ` +
      `enrolled=${result.enrolledCount} newbie-skip=${result.skippedNewbie} no-manager=${result.noManager} no-peer=${result.noPeer}` +
      `${dryRun ? ' [DRY-RUN]' : ''}`,
  );
  return result;
}
