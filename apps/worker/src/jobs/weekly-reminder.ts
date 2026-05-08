import { createDb } from '@leader-sync/db';
import { task, orgCache, userNotificationPreference } from '@leader-sync/db';
import { and, eq, gte, lte, isNull, notInArray, sql } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { buildWeeklyReminderCard, buildLeaderWeeklyOverdueDigest } from '../services/message-builder';

const db = createDb(config.databaseUrl);

const DONE_STATUSES = ['done', 'shelved', 'closed'];

export async function runWeeklyReminder(): Promise<void> {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  // ---- Part 1: assignee weekly digest (existing behaviour) ----
  const dueTasks = await db.select().from(task)
    .where(and(
      gte(task.dueAt, monday),
      lte(task.dueAt, sunday),
      notInArray(task.status, DONE_STATUSES),
      isNull(task.deletedAt),
    ));

  const overdueTasks = await db.select().from(task)
    .where(and(
      eq(task.isOverdue, true),
      notInArray(task.status, DONE_STATUSES),
      isNull(task.deletedAt),
    ));

  const byUser = new Map<string, { due: typeof dueTasks; overdue: typeof overdueTasks }>();
  for (const t of dueTasks) {
    if (!byUser.has(t.assigneeUserId)) byUser.set(t.assigneeUserId, { due: [], overdue: [] });
    byUser.get(t.assigneeUserId)!.due.push(t);
  }
  for (const t of overdueTasks) {
    if (!byUser.has(t.assigneeUserId)) byUser.set(t.assigneeUserId, { due: [], overdue: [] });
    byUser.get(t.assigneeUserId)!.overdue.push(t);
  }

  let assigneeSent = 0, assigneeOptOut = 0;
  for (const [userId, tasks] of byUser) {
    if (!userId.startsWith('ou_')) continue;

    const [pref] = await db
      .select()
      .from(userNotificationPreference)
      .where(eq(userNotificationPreference.userId, userId));
    if (pref && !pref.weeklySummaryEnabled) {
      assigneeOptOut++;
      continue;
    }

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
    assigneeSent++;
  }

  // ---- Part 2: leader weekly digest (NEW; not user-toggleable) ----
  // Aggregate overdue tasks by leader (primary task.leader_user_id ∪ task_leader extras),
  // then by assignee within each leader, counting task_uid uniquely.
  const leaderRows = await db.execute<{
    leader_user_id: string;
    assignee_user_id: string;
    assignee_name: string;
    overdue_count: number;
  }>(sql`
    WITH overdue AS (
      SELECT t.task_uid, t.assignee_user_id, t.assignee_name, t.leader_user_id
      FROM task t
      WHERE t.deleted_at IS NULL
        AND t.is_overdue = true
        AND t.status NOT IN ('done', 'shelved', 'closed')
    ),
    leader_pairs AS (
      SELECT leader_user_id, task_uid, assignee_user_id, assignee_name FROM overdue
      UNION
      SELECT tl.leader_user_id, o.task_uid, o.assignee_user_id, o.assignee_name
      FROM overdue o JOIN task_leader tl ON tl.task_uid = o.task_uid
    )
    SELECT leader_user_id, assignee_user_id, assignee_name, COUNT(*)::int AS overdue_count
    FROM leader_pairs
    GROUP BY leader_user_id, assignee_user_id, assignee_name
    ORDER BY leader_user_id, overdue_count DESC
  `);

  // Group rows by leader
  type Row = { leader_user_id: string; assignee_user_id: string; assignee_name: string; overdue_count: number };
  const byLeader = new Map<string, Array<{ memberName: string; overdueCount: number }>>();
  for (const r of leaderRows as unknown as Row[]) {
    if (!r.leader_user_id?.startsWith('ou_')) continue;
    if (!byLeader.has(r.leader_user_id)) byLeader.set(r.leader_user_id, []);
    byLeader.get(r.leader_user_id)!.push({
      memberName: r.assignee_name || r.assignee_user_id,
      overdueCount: r.overdue_count,
    });
  }

  let leaderSent = 0;
  for (const [leaderId, members] of byLeader) {
    if (members.length === 0) continue;
    const users = await db.select().from(orgCache).where(eq(orgCache.userId, leaderId));
    const leaderName = users[0]?.userName || leaderId;
    const card = buildLeaderWeeklyOverdueDigest(leaderName, members);
    await feishuApi.sendCardMessage(leaderId, card);
    leaderSent++;
  }

  console.log(
    `  Weekly: assignee sent ${assigneeSent} (${assigneeOptOut} opted out, ${dueTasks.length} due+${overdueTasks.length} overdue tasks); leader digest sent ${leaderSent}`,
  );
}
