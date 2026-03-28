import { createDb } from '@leader-sync/db';
import { task, monthlySnapshot, externalMapping, orgCache } from '@leader-sync/db';
import { and, eq, isNull } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { generateTaskUid, generateSnapshotUid } from '@leader-sync/domain-core';
import { taskToBitableFields, computeHash } from '../services/sync-engine';
import { buildMonthlyReportCard } from '../services/message-builder';
import crypto from 'node:crypto';

const db = createDb(config.databaseUrl);

export async function runMonthlyClose(): Promise<void> {
  const now = new Date();
  // Last month
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthStart = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); // last day of previous month
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  console.log(`  Monthly close for ${lastMonth} (freeze: ${lastMonthEnd.toISOString()})`);

  const DONE_STATUSES = ['done', 'shelved', 'closed'];

  // --- Step 2: Extract last month's tasks ---
  const lastMonthTasks = await db.select().from(task)
    .where(and(eq(task.monthBucket, lastMonth), isNull(task.deletedAt)));

  if (lastMonthTasks.length === 0) {
    console.log('  No tasks for last month. Skipping.');
    return;
  }

  // --- Step 3: Calculate stats ---
  const monthOpenCount = lastMonthTasks.filter(t =>
    t.createdAt && new Date(t.createdAt) < lastMonthStart
  ).length;

  const monthNewCount = lastMonthTasks.filter(t =>
    t.createdAt && new Date(t.createdAt) >= lastMonthStart && new Date(t.createdAt) <= lastMonthEnd
  ).length;

  const monthDueCount = lastMonthTasks.filter(t =>
    t.dueAt && new Date(t.dueAt) >= lastMonthStart && new Date(t.dueAt) <= lastMonthEnd
    && t.status !== 'shelved'
  ).length;

  const monthDoneCount = lastMonthTasks.filter(t =>
    t.completedAt && new Date(t.completedAt) >= lastMonthStart && new Date(t.completedAt) <= lastMonthEnd
  ).length;

  const monthOverdueCount = lastMonthTasks.filter(t =>
    t.dueAt && new Date(t.dueAt) <= lastMonthEnd
    && !DONE_STATUSES.includes(t.status)
  ).length;

  // Carry-over candidates: not done, not shelved, not closed
  const carryOverCandidates = lastMonthTasks.filter(t =>
    !DONE_STATUSES.includes(t.status)
  );
  const monthCarryOverCount = carryOverCandidates.length;

  const doneRate = monthDueCount > 0 ? monthDoneCount / monthDueCount : 0;
  const overdueRate = monthDueCount > 0 ? monthOverdueCount / monthDueCount : 0;

  console.log(`  Stats: open=${monthOpenCount} new=${monthNewCount} due=${monthDueCount} done=${monthDoneCount} overdue=${monthOverdueCount} carry=${monthCarryOverCount}`);
  console.log(`  Rates: done=${(doneRate * 100).toFixed(1)}% overdue=${(overdueRate * 100).toFixed(1)}%`);

  // --- Step 4: Generate snapshot (company level) ---
  const runId = `run_${crypto.randomBytes(8).toString('hex')}`;
  await db.insert(monthlySnapshot).values({
    snapshotUid: generateSnapshotUid(),
    snapshotRunId: runId,
    snapshotVersion: 1,
    isLatest: true,
    snapshotMonth: lastMonth,
    roleScope: 'company',
    monthOpenCount,
    monthNewCount,
    monthDueCount,
    monthDoneCount,
    monthOverdueCount,
    monthCarryOverCount,
    doneRate: doneRate.toFixed(4),
    overdueRate: overdueRate.toFixed(4),
    generatedAt: now,
  });

  // Per-assignee snapshots
  const byAssignee = new Map<string, typeof lastMonthTasks>();
  for (const t of lastMonthTasks) {
    if (!byAssignee.has(t.assigneeUserId)) byAssignee.set(t.assigneeUserId, []);
    byAssignee.get(t.assigneeUserId)!.push(t);
  }

  for (const [userId, userTasks] of byAssignee) {
    const uDue = userTasks.filter(t => t.dueAt && new Date(t.dueAt) >= lastMonthStart && new Date(t.dueAt) <= lastMonthEnd && t.status !== 'shelved').length;
    const uDone = userTasks.filter(t => t.completedAt && new Date(t.completedAt) >= lastMonthStart && new Date(t.completedAt) <= lastMonthEnd).length;
    const uOverdue = userTasks.filter(t => t.dueAt && new Date(t.dueAt) <= lastMonthEnd && !DONE_STATUSES.includes(t.status)).length;
    const uCarry = userTasks.filter(t => !DONE_STATUSES.includes(t.status)).length;

    const users = await db.select().from(orgCache).where(eq(orgCache.userId, userId));

    await db.insert(monthlySnapshot).values({
      snapshotUid: generateSnapshotUid(),
      snapshotRunId: runId,
      snapshotVersion: 1,
      isLatest: true,
      snapshotMonth: lastMonth,
      roleScope: 'employee',
      ownerUserId: userId,
      ownerName: users[0]?.userName || null,
      monthOpenCount: userTasks.filter(t => t.createdAt && new Date(t.createdAt) < lastMonthStart).length,
      monthNewCount: userTasks.filter(t => t.createdAt && new Date(t.createdAt) >= lastMonthStart && new Date(t.createdAt) <= lastMonthEnd).length,
      monthDueCount: uDue,
      monthDoneCount: uDone,
      monthOverdueCount: uOverdue,
      monthCarryOverCount: uCarry,
      doneRate: (uDue > 0 ? uDone / uDue : 0).toFixed(4),
      overdueRate: (uDue > 0 ? uOverdue / uDue : 0).toFixed(4),
      generatedAt: now,
    });
  }

  console.log(`  Snapshots: 1 company + ${byAssignee.size} employees`);

  // --- Step 5: Carry over ---
  let carriedCount = 0;
  for (const t of carryOverCandidates) {
    const newTaskUid = generateTaskUid();
    const newTask = {
      taskUid: newTaskUid,
      title: t.title,
      detail: t.detail,
      taskType: 'carry_over' as const,
      priority: t.priority,
      status: t.status === 'stalled' ? 'stalled' : 'not_started',
      progressPercent: 0,
      latestProgress: null as string | null,
      assigneeUserId: t.assigneeUserId,
      assigneeName: t.assigneeName,
      assigneeManagerUserId: t.assigneeManagerUserId,
      assigneeManagerName: t.assigneeManagerName,
      assigneeDeptName: t.assigneeDeptName,
      leaderUserId: t.leaderUserId,
      issuerUserId: t.issuerUserId,
      assignerUserId: t.assignerUserId,
      assignmentType: 'carry_over' as const,
      dueAt: t.dueAt,
      startAt: t.startAt,
      monthBucket: thisMonth,
      sourceMonth: t.sourceMonth || t.monthBucket,
      isCarriedOver: true,
      carriedFromTaskUid: t.taskUid,
      carryOverCount: (t.carryOverCount || 0) + 1,
      bossAttentionFlag: t.bossAttentionFlag,
      version: 1,
      createdBy: 'monthly_close',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(task).values(newTask);

    // Create Bitable record for carried-over task
    const bitableFields = taskToBitableFields({ ...newTask, isOverdue: false, daysToDue: null });
    try {
      const recordIds = await feishuApi.createBitableRecords([{ fields: bitableFields }]);
      if (recordIds[0]) {
        await db.insert(externalMapping).values({
          taskUid: newTaskUid,
          sourceType: 'bitable',
          externalObjectId: recordIds[0],
          externalParentId: `${config.bitableAppToken}/${config.bitableTableId}`,
          syncVersion: 1,
          lastSyncHash: computeHash(bitableFields),
          lastSyncAt: now,
          syncStatus: 'success',
        });
      }
    } catch (err) {
      console.warn(`  Failed to create Bitable record for carried task ${newTaskUid}:`, (err as Error).message);
    }

    carriedCount++;
  }
  console.log(`  Carried over: ${carriedCount} tasks to ${thisMonth}`);

  // --- Step 6: Send monthly reports ---
  let reportsSent = 0;
  for (const [userId, userTasks] of byAssignee) {
    if (!userId.startsWith('ou_')) continue;
    const users = await db.select().from(orgCache).where(eq(orgCache.userId, userId));
    const userName = users[0]?.userName || userId;
    const uDue = userTasks.filter(t => t.dueAt && new Date(t.dueAt) >= lastMonthStart && new Date(t.dueAt) <= lastMonthEnd && t.status !== 'shelved').length;
    const uDone = userTasks.filter(t => t.completedAt && new Date(t.completedAt) >= lastMonthStart && new Date(t.completedAt) <= lastMonthEnd).length;
    const uOverdue = userTasks.filter(t => t.dueAt && new Date(t.dueAt) <= lastMonthEnd && !DONE_STATUSES.includes(t.status)).length;
    const uCarry = userTasks.filter(t => !DONE_STATUSES.includes(t.status)).length;

    const card = buildMonthlyReportCard(userName, lastMonth, {
      done: uDone,
      overdue: uOverdue,
      carryOver: uCarry,
      total: userTasks.length,
      doneRate: uDue > 0 ? `${(uDone / uDue * 100).toFixed(0)}%` : 'N/A',
    });
    await feishuApi.sendCardMessage(userId, card);
    reportsSent++;
  }

  console.log(`  Monthly reports sent to ${reportsSent} users`);
  console.log(`  Monthly close for ${lastMonth} completed.`);
}
