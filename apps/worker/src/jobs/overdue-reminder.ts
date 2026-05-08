import { createDb } from '@leader-sync/db';
import { task, orgCache, userNotificationPreference } from '@leader-sync/db';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { buildOverdueCard } from '../services/message-builder';

const db = createDb(config.databaseUrl);

export async function runOverdueReminder(): Promise<void> {
  const DONE_STATUSES = ['done', 'shelved', 'closed'];

  // 1. Refresh derived fields for ALL non-deleted tasks (incl. done/shelved/closed),
  // so that completed tasks have is_overdue=false and days_to_due=null even if the
  // service-layer write paths didn't reset them (defense in depth + self-healing).
  await db.execute(sql`
    UPDATE task SET
      days_to_due = CASE WHEN status IN ('done', 'shelved', 'closed') THEN NULL
                         ELSE CEIL(EXTRACT(EPOCH FROM (due_at - NOW())) / 86400)::int END,
      is_overdue = CASE WHEN due_at < NOW() AND status NOT IN ('done', 'shelved', 'closed') THEN true ELSE false END,
      overdue_notified_leader_at = CASE WHEN status IN ('done', 'shelved', 'closed') THEN NULL
                                        ELSE overdue_notified_leader_at END,
      updated_at = NOW()
    WHERE deleted_at IS NULL
  `);

  // 2. Get all overdue tasks
  const overdueTasks = await db.select().from(task)
    .where(and(
      eq(task.isOverdue, true),
      notInArray(task.status, DONE_STATUSES),
      isNull(task.deletedAt),
    ));

  if (overdueTasks.length === 0) {
    console.log('  No overdue tasks.');
    return;
  }

  // 3. Group by assignee -> send reminder (skip users who opted out)
  const byUser = new Map<string, typeof overdueTasks>();
  for (const t of overdueTasks) {
    if (!byUser.has(t.assigneeUserId)) byUser.set(t.assigneeUserId, []);
    byUser.get(t.assigneeUserId)!.push(t);
  }

  let sent = 0, skippedOptOut = 0;

  for (const [userId, tasks] of byUser) {
    if (!userId.startsWith('ou_')) continue;

    // Check user's notification preference (absent row = default true)
    const [pref] = await db
      .select()
      .from(userNotificationPreference)
      .where(eq(userNotificationPreference.userId, userId));
    if (pref && !pref.dailyOverdueEnabled) {
      skippedOptOut++;
      continue;
    }

    const users = await db.select().from(orgCache).where(eq(orgCache.userId, userId));
    const userName = users[0]?.userName || userId;

    const card = buildOverdueCard(
      userName,
      tasks.map(t => ({
        title: t.title,
        dueAt: t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '',
        daysOverdue: t.daysToDue || 0,
      })),
    );
    await feishuApi.sendCardMessage(userId, card);
    sent++;
  }

  console.log(`  Overdue: ${overdueTasks.length} tasks, sent to ${sent} assignees, ${skippedOptOut} opted out`);
}
