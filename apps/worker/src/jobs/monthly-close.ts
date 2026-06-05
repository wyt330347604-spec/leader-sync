import { createDb, type Database } from '@leader-sync/db';
import { task, monthlySnapshot, externalMapping, orgCache } from '@leader-sync/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { generateSnapshotUid } from '@leader-sync/domain-core';
import { taskToBitableFields } from '../services/sync-engine';
import { buildMonthlyReportCard } from '../services/message-builder';
import { computeStats, clampRate, type MonthlyStats } from './monthly-close-stats';
import crypto from 'node:crypto';

// 默认依赖惰性初始化：测试注入 db/feishu 时不会触发真实连接。
let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

interface FeishuDeps {
  updateBitableRecord: (recordId: string, fields: Record<string, any>) => Promise<void>;
  sendCardMessage: (userId: string, card: object) => Promise<void>;
}

export interface MonthlyCloseOptions {
  /** 逻辑当前时间（默认 new Date()）；上月 = now 的上一个自然月。测试/补救可注入。 */
  now?: Date;
  /** 只计算与日志，不写库、不发通知。 */
  dryRun?: boolean;
  /** 不发送任何飞书卡片（月报 + 打分窗口）。数据补救重跑用。 */
  skipNotifications?: boolean;
  db?: Database;
  feishu?: FeishuDeps;
}

export interface MonthlyCloseResult {
  lastMonth: string;
  thisMonth: string;
  taskCount: number;
  carriedCount: number;
  snapshotOk: boolean;
  reportsSent: number;
  dryRun: boolean;
}

/** 有界并发执行（无外部依赖），用于把数百个 Bitable HTTP 更新并行化。 */
async function runPooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

export async function runMonthlyClose(opts: MonthlyCloseOptions = {}): Promise<MonthlyCloseResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const skipNotifications = opts.skipNotifications ?? false;
  const db = opts.db ?? defaultDb();
  const feishu = opts.feishu ?? feishuApi;

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthStart = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); // 上月最后一刻
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  console.log(`  Monthly close for ${lastMonth} (freeze: ${lastMonthEnd.toISOString()})${dryRun ? ' [DRY-RUN]' : ''}`);

  // --- Step 1: 提取上月任务（排除私有：私有个人 to-do 不计数/不快照/不继承）---
  const lastMonthTasks = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.monthBucket, lastMonth),
        isNull(task.deletedAt),
        sql`${task.visibility} <> 'private'`,
      ),
    );

  if (lastMonthTasks.length === 0) {
    console.log('  No tasks for last month. Skipping.');
    return { lastMonth, thisMonth, taskCount: 0, carriedCount: 0, snapshotOk: true, reportsSent: 0, dryRun };
  }

  // --- Step 2: 统计（累计口径，纯函数）---
  const stats = computeStats(lastMonthTasks, lastMonthStart, lastMonthEnd);
  console.log(
    `  Stats: open=${stats.monthOpenCount} new=${stats.monthNewCount} due=${stats.monthDueCount} ` +
      `done=${stats.monthDoneCount} overdue=${stats.monthOverdueCount} carry=${stats.monthCarryOverCount}`,
  );
  console.log(`  Rates: done=${(stats.doneRate * 100).toFixed(1)}% overdue=${(stats.overdueRate * 100).toFixed(1)}%`);

  // 按 assignee 分组；每人 stats 只算一次（快照 + 月报复用，避免重复扫描）。
  const byAssignee = new Map<string, any[]>();
  for (const t of lastMonthTasks) {
    if (!byAssignee.has(t.assigneeUserId)) byAssignee.set(t.assigneeUserId, []);
    byAssignee.get(t.assigneeUserId)!.push(t);
  }
  const statsByAssignee = new Map<string, MonthlyStats>();
  for (const [userId, userTasks] of byAssignee) {
    statsByAssignee.set(userId, computeStats(userTasks, lastMonthStart, lastMonthEnd));
  }

  // org_cache 一次性批量拉取（含 userName + managerUserId），各步骤复用，避免 per-user N 次查询。
  const orgById = new Map<string, any>();
  const assigneeIds = [...byAssignee.keys()];
  if (assigneeIds.length > 0) {
    const rows = await db.select().from(orgCache).where(inArray(orgCache.userId, assigneeIds));
    for (const r of rows) orgById.set(r.userId, r);
  }

  // --- Step 3: 生成快照（非阻塞：失败不得影响继承）---
  let snapshotOk = true;
  if (!dryRun) {
    try {
      const runId = `run_${crypto.randomBytes(8).toString('hex')}`;
      // #1: 重跑幂等 — 先把本月旧快照置为非最新，再插入新快照，避免多行 isLatest=true。
      await db
        .update(monthlySnapshot)
        .set({ isLatest: false })
        .where(and(eq(monthlySnapshot.snapshotMonth, lastMonth), eq(monthlySnapshot.isLatest, true)));

      await db.insert(monthlySnapshot).values({
        snapshotUid: generateSnapshotUid(),
        snapshotRunId: runId,
        snapshotVersion: 1,
        isLatest: true,
        snapshotMonth: lastMonth,
        roleScope: 'company',
        monthOpenCount: stats.monthOpenCount,
        monthNewCount: stats.monthNewCount,
        monthDueCount: stats.monthDueCount,
        monthDoneCount: stats.monthDoneCount,
        monthOverdueCount: stats.monthOverdueCount,
        monthCarryOverCount: stats.monthCarryOverCount,
        doneRate: clampRate(stats.doneRate).toFixed(4),
        overdueRate: clampRate(stats.overdueRate).toFixed(4),
        generatedAt: now,
      });

      for (const [userId, us] of statsByAssignee) {
        await db.insert(monthlySnapshot).values({
          snapshotUid: generateSnapshotUid(),
          snapshotRunId: runId,
          snapshotVersion: 1,
          isLatest: true,
          snapshotMonth: lastMonth,
          roleScope: 'employee',
          ownerUserId: userId,
          ownerName: orgById.get(userId)?.userName || null,
          monthOpenCount: us.monthOpenCount,
          monthNewCount: us.monthNewCount,
          monthDueCount: us.monthDueCount,
          monthDoneCount: us.monthDoneCount,
          monthOverdueCount: us.monthOverdueCount,
          monthCarryOverCount: us.monthCarryOverCount,
          doneRate: clampRate(us.doneRate).toFixed(4),
          overdueRate: clampRate(us.overdueRate).toFixed(4),
          generatedAt: now,
        });
      }
      console.log(`  Snapshots: 1 company + ${statsByAssignee.size} employees`);
    } catch (err) {
      snapshotOk = false;
      console.warn('  [Step 3] Snapshot generation failed (non-blocking):', (err as Error).message);
    }
  }

  // --- Step 4: 继承（MOVE 策略 — 更新 month_bucket，不新建记录）。核心步骤，永不被前面阻断。---
  let carriedCount = 0;
  if (!dryRun) {
    const candidates = stats.carryOverCandidates;
    // #7: 一次性预取所有候选任务的 bitable 映射，避免 per-task SELECT。
    const mappingByTask = new Map<string, string>();
    if (candidates.length > 0) {
      const candidateUids = candidates.map((t) => t.taskUid);
      const mappings = await db
        .select()
        .from(externalMapping)
        .where(and(inArray(externalMapping.taskUid, candidateUids), eq(externalMapping.sourceType, 'bitable')));
      for (const m of mappings) mappingByTask.set(m.taskUid, m.externalObjectId);
    }

    // 先完成 DB 月份迁移（核心、必须全部成功），收集需要回写 bitable 的任务。
    const bitableJobs: { recordId: string; fields: Record<string, any> }[] = [];
    for (const t of candidates) {
      await db
        .update(task)
        .set({
          monthBucket: thisMonth,
          sourceMonth: t.sourceMonth || t.monthBucket,
          taskType: 'carry_over',
          isCarriedOver: true,
          carryOverCount: (t.carryOverCount || 0) + 1,
          updatedAt: now,
        })
        .where(eq(task.taskUid, t.taskUid));
      carriedCount++;

      const recordId = mappingByTask.get(t.taskUid);
      if (recordId) {
        const updatedTask = { ...t, monthBucket: thisMonth, taskType: 'carry_over', isCarriedOver: true };
        bitableJobs.push({ recordId, fields: taskToBitableFields({ ...updatedTask, isOverdue: false, daysToDue: null }) });
      }
    }
    console.log(`  Carried over (moved): ${carriedCount} tasks to ${thisMonth}`);

    // bitable 回写是网络 I/O 大头：有界并发（8）替代逐条 await。
    if (bitableJobs.length > 0) {
      await runPooled(bitableJobs, 8, async (job) => {
        try {
          await feishu.updateBitableRecord(job.recordId, job.fields);
        } catch (err) {
          console.warn(`  Failed to update Bitable record ${job.recordId}:`, (err as Error).message);
        }
      });
    }
  }

  // --- Step 5: 发送月报（非阻塞 + 可跳过）---
  let reportsSent = 0;
  if (!dryRun && !skipNotifications) {
    try {
      for (const [userId, userTasks] of byAssignee) {
        if (!userId.startsWith('ou_')) continue;
        const us = statsByAssignee.get(userId)!;
        const userName = orgById.get(userId)?.userName || userId;
        const card = buildMonthlyReportCard(userName, lastMonth, {
          done: us.monthDoneCount,
          overdue: us.monthOverdueCount,
          carryOver: us.monthCarryOverCount,
          total: userTasks.length,
          doneRate: us.monthDueCount > 0 ? `${(us.doneRate * 100).toFixed(0)}%` : 'N/A',
        });
        await feishu.sendCardMessage(userId, card);
        reportsSent++;
      }
      console.log(`  Monthly reports sent to ${reportsSent} users`);
    } catch (err) {
      console.warn('  [Step 5] Monthly report send failed (non-blocking):', (err as Error).message);
    }
  }

  // --- Step 6: 创建 monthly_score 草稿 + 推送「打分窗口开启」通知 ---
  // #2: 依赖 Step 3 写入的 employee 快照；快照失败则跳过并告警，避免静默生成 0 条打分。
  if (!dryRun && !skipNotifications) {
    if (!snapshotOk) {
      console.warn('  [Step 6] Skipped: snapshot generation failed, scoring window NOT opened for', lastMonth);
    } else {
      try {
        const { monthlyScore } = await import('@leader-sync/db');
        const { generateScoreUid } = await import('../lib/uid');
        const { buildScoreWindowCard } = await import('../services/message-builder');

        const deadlineDate = new Date(now);
        deadlineDate.setDate(deadlineDate.getDate() + 7);
        const deadlineStr = deadlineDate.toISOString().slice(0, 10);

        const employeeSnapshots = await db
          .select()
          .from(monthlySnapshot)
          .where(
            sql`${monthlySnapshot.snapshotMonth} = ${lastMonth}
              AND ${monthlySnapshot.roleScope} = 'employee'
              AND ${monthlySnapshot.isLatest} = true
              AND ${monthlySnapshot.ownerUserId} IS NOT NULL`,
          );

        // rater 信息：先复用已批量拉取的 orgById，缺失的 rater 再批量补一次。
        const raterIds = new Set<string>();
        for (const snap of employeeSnapshots) {
          if (!snap.ownerUserId) continue;
          const org = orgById.get(snap.ownerUserId);
          const raterUserId: string = (org as any)?.managerUserId ?? (org as any)?.manager_user_id ?? '';
          if (raterUserId && !orgById.has(raterUserId)) raterIds.add(raterUserId);
        }
        if (raterIds.size > 0) {
          const raterRows = await db.select().from(orgCache).where(inArray(orgCache.userId, [...raterIds]));
          for (const r of raterRows) orgById.set(r.userId, r);
        }

        const raterNotifyMap = new Map<string, { raterUserId: string; raterName: string; rateeList: string[] }>();
        for (const snap of employeeSnapshots) {
          if (!snap.ownerUserId) continue;
          const org = orgById.get(snap.ownerUserId);
          const raterUserId: string = (org as any)?.managerUserId ?? (org as any)?.manager_user_id ?? '';
          if (!raterUserId) continue;

          await db
            .insert(monthlyScore)
            .values({
              scoreUid: generateScoreUid(),
              scoreMonth: lastMonth,
              rateeUserId: snap.ownerUserId,
              rateeName: snap.ownerName ?? null,
              raterUserId,
              raterName: null,
              score: null,
              status: 'draft',
              snapshotRef: snap.snapshotUid,
              version: 1,
              createdBy: 'system',
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing();

          if (!raterNotifyMap.has(raterUserId)) {
            raterNotifyMap.set(raterUserId, {
              raterUserId,
              raterName: orgById.get(raterUserId)?.userName ?? raterUserId,
              rateeList: [],
            });
          }
          raterNotifyMap.get(raterUserId)!.rateeList.push(snap.ownerName ?? snap.ownerUserId);
        }

        let cardsSent = 0;
        for (const { raterUserId, raterName, rateeList } of raterNotifyMap.values()) {
          if (!raterUserId.startsWith('ou_')) continue;
          const card = buildScoreWindowCard(raterName, lastMonth, rateeList.length, deadlineStr);
          await feishu.sendCardMessage(raterUserId, card);
          cardsSent++;
        }
        console.log(`  [Step 6] Score drafts for ${employeeSnapshots.length} employees; cards sent to ${cardsSent} leaders`);
      } catch (err) {
        console.warn('  [Step 6] Score window setup failed (non-blocking):', (err as Error).message);
      }
    }
  }

  console.log(`  Monthly close for ${lastMonth} completed.`);
  return { lastMonth, thisMonth, taskCount: lastMonthTasks.length, carriedCount, snapshotOk, reportsSent, dryRun };
}
