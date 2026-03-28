import { createDb } from '@leader-sync/db';
import { task, orgCache } from '@leader-sync/db';
import { and, eq, gte, lte, isNull, notInArray } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { buildWeeklyReminderCard } from '../services/message-builder';

const db = createDb(config.databaseUrl);

export async function runWeeklyReminder(): Promise<void> {
  const now = new Date();
  // Calculate this week's Monday 00:00 and Sunday 23:59
  const dayOfWeek = now.getDay() || 7; // Sunday = 7
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const DONE_STATUSES = ['done', 'shelved', 'closed'];

  // Tasks due this week (not completed)
  const dueTasks = await db.select().from(task)
    .where(and(
      gte(task.dueAt, monday),
      lte(task.dueAt, sunday),
      notInArray(task.status, DONE_STATUSES),
      isNull(task.deletedAt),
    ));

  // Overdue tasks
  const overdueTasks = await db.select().from(task)
    .where(and(
      eq(task.isOverdue, true),
      notInArray(task.status, DONE_STATUSES),
      isNull(task.deletedAt),
    ));

  // Group by assignee
  const byUser = new Map<string, { due: typeof dueTasks; overdue: typeof overdueTasks }>();

  for (const t of dueTasks) {
    if (!byUser.has(t.assigneeUserId)) byUser.set(t.assigneeUserId, { due: [], overdue: [] });
    byUser.get(t.assigneeUserId)!.due.push(t);
  }
  for (const t of overdueTasks) {
    if (!byUser.has(t.assigneeUserId)) byUser.set(t.assigneeUserId, { due: [], overdue: [] });
    byUser.get(t.assigneeUserId)!.overdue.push(t);
  }

  let sent = 0;
  for (const [userId, tasks] of byUser) {
    if (!userId.startsWith('ou_')) continue;

    // Look up user name
    const users = await db.select().from(orgCache).where(eq(orgCache.userId, userId));
    const userName = users[0]?.userName || userId;

    const card = buildWeeklyReminderCard(
      userName,
      tasks.due.map(t => ({
        title: t.title,
        dueAt: t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '',
      })),
      tasks.overdue.map(t => ({
        title: t.title,
        dueAt: t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '',
        daysOverdue: t.daysToDue || 0,
      })),
    );

    await feishuApi.sendCardMessage(userId, card);
    sent++;
  }

  console.log(`  Weekly reminder: sent to ${sent} users (${dueTasks.length} due, ${overdueTasks.length} overdue)`);
}
