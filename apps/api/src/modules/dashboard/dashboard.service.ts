import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, monthlySnapshot, orgCache } from '@leader-sync/db';
import { eq, and, sql, inArray } from 'drizzle-orm';

const DONE_STATUSES = ['done', 'shelved', 'closed'];

export interface MemberEntry {
  readonly userId: string;
  readonly name: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
}

export interface LeaderEntry {
  readonly name: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
  readonly members: MemberEntry[];
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async getBossDashboard(month?: string) {
    const targetMonth = month || this.getCurrentMonth();

    const tasks = await this.db
      .select()
      .from(task)
      .where(and(eq(task.monthBucket, targetMonth), sql`${task.deletedAt} IS NULL`));

    // Group by leader, then by member within each leader
    const leaderMap = new Map<string, LeaderEntry>();

    for (const t of tasks) {
      const leaderId = t.leaderUserId || 'unknown';
      const prev = leaderMap.get(leaderId) ?? {
        name: t.leaderName || '',
        total: 0,
        done: 0,
        overdue: 0,
        carryOver: 0,
        members: [],
      };

      const isDone = t.status === 'done';
      const isOverdue = t.isOverdue && !DONE_STATUSES.includes(t.status);
      const isCarry = (t.carryOverCount ?? 0) >= 1;

      // Update member entry
      const members = [...prev.members];
      const memberIdx = members.findIndex((m) => m.userId === t.assigneeUserId);
      if (memberIdx >= 0) {
        const m = members[memberIdx];
        members[memberIdx] = {
          ...m,
          total: m.total + 1,
          done: m.done + (isDone ? 1 : 0),
          overdue: m.overdue + (isOverdue ? 1 : 0),
        };
      } else {
        members.push({
          userId: t.assigneeUserId,
          name: t.assigneeName || t.assigneeUserId,
          total: 1,
          done: isDone ? 1 : 0,
          overdue: isOverdue ? 1 : 0,
        });
      }

      leaderMap.set(leaderId, {
        name: prev.name || t.leaderName || '',
        total: prev.total + 1,
        done: prev.done + (isDone ? 1 : 0),
        overdue: prev.overdue + (isOverdue ? 1 : 0),
        carryOver: prev.carryOver + (isCarry ? 1 : 0),
        members,
      });
    }

    const leaderSummary = [...leaderMap.entries()]
      .map(([id, data]) => ({
        leaderId: id,
        leaderName: data.name || id,
        total: data.total,
        done: data.done,
        overdue: data.overdue,
        carryOver: data.carryOver,
        doneRate: data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
        members: data.members.sort((a, b) => b.overdue - a.overdue),
      }))
      .sort((a, b) => b.total - a.total);

    // Risk tasks
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
        leaderName: t.leaderName,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        daysToDue: t.daysToDue,
        isOverdue: t.isOverdue,
        carryOverCount: t.carryOverCount ?? 0,
      }))
      .sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));

    // Stats
    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.status === 'done').length;
    const overdueTasks = tasks.filter(
      (t) => t.isOverdue && !DONE_STATUSES.includes(t.status),
    ).length;
    const carryOverTasks = tasks.filter(
      (t) => (t.carryOverCount ?? 0) >= 1,
    ).length;

    // Snapshot
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
        doneRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
        overdueRate: totalTasks > 0 ? Math.round((overdueTasks / totalTasks) * 100) : 0,
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
