import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, monthlySnapshot, orgCache } from '@leader-sync/db';
import { eq, and, sql, inArray } from 'drizzle-orm';

interface LeaderEntry {
  readonly name: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async getBossDashboard(month?: string) {
    const targetMonth = month || this.getCurrentMonth();
    const DONE_STATUSES = ['done', 'shelved', 'closed'];

    // 1. All tasks for the target month (non-deleted)
    const tasks = await this.db
      .select()
      .from(task)
      .where(and(eq(task.monthBucket, targetMonth), sql`${task.deletedAt} IS NULL`));

    // 2. Leader summary - group by leaderUserId
    const leaderMap = new Map<string, LeaderEntry>();

    for (const t of tasks) {
      const leaderId = t.leaderUserId || t.assigneeManagerUserId || 'unknown';
      const prev = leaderMap.get(leaderId) ?? {
        name: t.leaderName || t.assigneeManagerName || '',
        total: 0,
        done: 0,
        overdue: 0,
        carryOver: 0,
      };

      leaderMap.set(leaderId, {
        name: prev.name || t.leaderName || t.assigneeManagerName || '',
        total: prev.total + 1,
        done: prev.done + (t.status === 'done' ? 1 : 0),
        overdue:
          prev.overdue +
          (t.isOverdue && !DONE_STATUSES.includes(t.status) ? 1 : 0),
        carryOver: prev.carryOver + ((t.carryOverCount ?? 0) >= 1 ? 1 : 0),
      });
    }

    // Resolve leader names from org_cache
    const leaderIds = [...leaderMap.keys()].filter((id) => id.startsWith('ou_'));
    if (leaderIds.length > 0) {
      const leaders = await this.db
        .select()
        .from(orgCache)
        .where(inArray(orgCache.userId, leaderIds));

      for (const l of leaders) {
        const entry = leaderMap.get(l.userId);
        if (entry) {
          leaderMap.set(l.userId, {
            ...entry,
            name: l.userName || l.userId,
          });
        }
      }
    }

    const leaderSummary = [...leaderMap.entries()]
      .map(([id, data]) => ({
        leaderId: id,
        leaderName: data.name || id,
        total: data.total,
        done: data.done,
        overdue: data.overdue,
        carryOver: data.carryOver,
        doneRate:
          data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.overdue - a.overdue);

    // 3. Risk tasks: overdue OR carry_over_count >= 2, status not in done/shelved/closed
    const riskTasks = tasks
      .filter(
        (t) =>
          !DONE_STATUSES.includes(t.status) &&
          (t.isOverdue || (t.carryOverCount ?? 0) >= 2),
      )
      .map((t) => ({
        taskUid: t.taskUid,
        title: t.title,
        assigneeName: t.assigneeName,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        daysToDue: t.daysToDue,
        isOverdue: t.isOverdue,
        carryOverCount: t.carryOverCount ?? 0,
      }))
      .sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));

    // 4. Monthly stats
    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.status === 'done').length;
    const overdueTasks = tasks.filter(
      (t) => t.isOverdue && !DONE_STATUSES.includes(t.status),
    ).length;
    const carryOverTasks = tasks.filter(
      (t) => (t.carryOverCount ?? 0) >= 1,
    ).length;

    // 5. Snapshot (historical data)
    const snapshots = await this.db
      .select()
      .from(monthlySnapshot)
      .where(
        and(
          eq(monthlySnapshot.snapshotMonth, targetMonth),
          eq(monthlySnapshot.roleScope, 'company'),
          eq(monthlySnapshot.isLatest, true),
        ),
      );
    const snapshot = snapshots[0] ?? null;

    return {
      month: targetMonth,
      leaderSummary,
      riskTasks,
      stats: {
        total: totalTasks,
        done: doneTasks,
        overdue: overdueTasks,
        carryOver: carryOverTasks,
        doneRate:
          totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
        overdueRate:
          totalTasks > 0 ? Math.round((overdueTasks / totalTasks) * 100) : 0,
      },
      snapshot: snapshot
        ? {
            doneRate: snapshot.doneRate,
            overdueRate: snapshot.overdueRate,
            monthDoneCount: snapshot.monthDoneCount,
            monthOverdueCount: snapshot.monthOverdueCount,
            monthCarryOverCount: snapshot.monthCarryOverCount,
          }
        : null,
    };
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
