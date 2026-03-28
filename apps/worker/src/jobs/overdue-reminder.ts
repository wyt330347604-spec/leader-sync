import { createDb } from '@leader-sync/db';
import { task, orgCache } from '@leader-sync/db';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { buildOverdueCard, buildLeaderOverdueNotice } from '../services/message-builder';

const db = createDb(config.databaseUrl);

export async function runOverdueReminder(): Promise<void> {
  const now = new Date();
  const DONE_STATUSES = ['done', 'shelved', 'closed'];

  // 1. Refresh derived fields: is_overdue and days_to_due for all active tasks
  await db.execute(sql`
    UPDATE task SET
      days_to_due = CEIL(EXTRACT(EPOCH FROM (due_at - NOW())) / 86400)::int,
      is_overdue = CASE WHEN due_at < NOW() AND status NOT IN ('done', 'shelved', 'closed') THEN true ELSE false END,
      updated_at = NOW()
    WHERE deleted_at IS NULL AND status NOT IN ('done', 'shelved', 'closed')
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

  // 3. Group by assignee -> send reminder to each person
  const byUser = new Map<string, typeof overdueTasks>();
  for (const t of overdueTasks) {
    if (!byUser.has(t.assigneeUserId)) byUser.set(t.assigneeUserId, []);
    byUser.get(t.assigneeUserId)!.push(t);
  }

  let sentToAssignee = 0, sentToLeader = 0;

  for (const [userId, tasks] of byUser) {
    if (!userId.startsWith('ou_')) continue;

    const users = await db.select().from(orgCache).where(eq(orgCache.userId, userId));
    const userName = users[0]?.userName || userId;

    // Send overdue card to assignee
    const card = buildOverdueCard(
      userName,
      tasks.map(t => ({
        title: t.title,
        dueAt: t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '',
        daysOverdue: t.daysToDue || 0,
      })),
    );
    await feishuApi.sendCardMessage(userId, card);
    sentToAssignee++;

    // 4. Notify leader for FIRST-TIME overdue only
    for (const t of tasks) {
      if (t.overdueNotifiedLeaderAt) continue; // already notified
      if (!t.assigneeManagerUserId?.startsWith('ou_')) continue; // no leader

      const leaderUsers = await db.select().from(orgCache).where(eq(orgCache.userId, t.assigneeManagerUserId));
      const leaderName = leaderUsers[0]?.userName || t.assigneeManagerUserId;

      const notice = buildLeaderOverdueNotice(
        leaderName,
        userName,
        t.title,
        t.daysToDue || 0,
      );
      await feishuApi.sendCardMessage(t.assigneeManagerUserId, notice);

      // Mark as notified
      await db.update(task)
        .set({ overdueNotifiedLeaderAt: now })
        .where(eq(task.taskUid, t.taskUid));

      sentToLeader++;
    }
  }

  console.log(`  Overdue: ${overdueTasks.length} tasks, sent to ${sentToAssignee} assignees, ${sentToLeader} leader notices`);
}
