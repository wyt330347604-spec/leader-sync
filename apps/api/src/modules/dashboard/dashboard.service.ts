import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, monthlySnapshot, orgCache } from '@leader-sync/db';
import { eq, and, sql, inArray } from 'drizzle-orm';

const DONE_STATUSES = ['done', 'shelved', 'closed'];

export interface DashboardPeriod {
  readonly type: 'month' | 'quarter' | 'year';
  readonly value?: string;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthBuckets(period: DashboardPeriod): readonly string[] {
  if (period.type === 'year' && period.value) {
    return Array.from({ length: 12 }, (_, i) => `${period.value}-${String(i + 1).padStart(2, '0')}`);
  }
  if (period.type === 'quarter' && period.value) {
    const [y, q] = period.value.split('-Q');
    const startMonth = (parseInt(q, 10) - 1) * 3 + 1;
    return [0, 1, 2].map((i) => `${y}-${String(startMonth + i).padStart(2, '0')}`);
  }
  const m = period.value || getCurrentMonth();
  return [m];
}

function getPeriodLabel(period: DashboardPeriod, monthBuckets: readonly string[]): string {
  if (period.type === 'year' && period.value) {
    return `${period.value}年`;
  }
  if (period.type === 'quarter' && period.value) {
    const [y, q] = period.value.split('-Q');
    return `${y}年Q${q}`;
  }
  return `${monthBuckets[0].split('-')[0]}年${parseInt(monthBuckets[0].split('-')[1], 10)}月`;
}

type RiskReason = 'overdue' | 'carry_over' | 'stalled' | 'near_due' | 'important_no_progress';

function getThisMonday(): Date {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function computeRiskReasons(t: {
  readonly isOverdue: boolean | null;
  readonly status: string;
  readonly carryOverCount: number | null;
  readonly daysToDue: number | null;
  readonly bossAttentionFlag: boolean | null;
  readonly progressPercent: number | null;
}): readonly RiskReason[] {
  const reasons: RiskReason[] = [];
  const isDoneStatus = DONE_STATUSES.includes(t.status);

  // A. Overdue and not in a done status
  if (t.isOverdue && !isDoneStatus) {
    reasons.push('overdue');
  }

  // B. Carry-over count >= 2
  if ((t.carryOverCount ?? 0) >= 2) {
    reasons.push('carry_over');
  }

  // C. Status is stalled
  if (t.status === 'stalled') {
    reasons.push('stalled');
  }

  // D. Near due: due within 3 days and not done/shelved/closed
  if (t.daysToDue !== null && t.daysToDue >= 0 && t.daysToDue <= 3 && !isDoneStatus) {
    reasons.push('near_due');
  }

  // E. Important task with zero progress and not done/shelved/closed
  if (t.bossAttentionFlag && (t.progressPercent ?? 0) === 0 && !isDoneStatus) {
    reasons.push('important_no_progress');
  }

  return reasons;
}

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
  readonly riskCount: number;
  readonly weeklyNewCount: number;
  readonly members: MemberEntry[];
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async getBossDashboard(period: DashboardPeriod = { type: 'month' }) {
    const monthBuckets = getMonthBuckets(period);

    const tasks = await this.db
      .select()
      .from(task)
      .where(and(inArray(task.monthBucket, [...monthBuckets]), sql`${task.deletedAt} IS NULL`));

    // Group by leader, then by member within each leader
    const leaderMap = new Map<string, LeaderEntry>();
    const thisMonday = getThisMonday();

    for (const t of tasks) {
      const leaderId = t.leaderUserId || 'unknown';
      const prev = leaderMap.get(leaderId) ?? {
        name: t.leaderName || '',
        total: 0,
        done: 0,
        overdue: 0,
        carryOver: 0,
        riskCount: 0,
        weeklyNewCount: 0,
        members: [],
      };

      const isDone = t.status === 'done';
      const isOverdue = t.isOverdue && !DONE_STATUSES.includes(t.status);
      const isCarry = (t.carryOverCount ?? 0) >= 1;
      const riskReasons = computeRiskReasons(t);
      const isRisk = riskReasons.length > 0;
      const isWeeklyNew = t.createdAt >= thisMonday;

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
        riskCount: prev.riskCount + (isRisk ? 1 : 0),
        weeklyNewCount: prev.weeklyNewCount + (isWeeklyNew ? 1 : 0),
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
        riskCount: data.riskCount,
        weeklyNewCount: data.weeklyNewCount,
        doneRate: data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
        members: data.members.sort((a, b) => b.overdue - a.overdue),
      }))
      .sort((a, b) => b.total - a.total);

    // Risk tasks: any task matching at least one of the 5 risk conditions
    const riskTasks = tasks
      .map((t) => ({
        task: t,
        riskReasons: computeRiskReasons(t),
      }))
      .filter(({ riskReasons }) => riskReasons.length > 0)
      .map(({ task: t, riskReasons }) => ({
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
        bossAttentionFlag: t.bossAttentionFlag ?? false,
        progressPercent: t.progressPercent ?? 0,
        riskReasons: [...riskReasons],
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

    // Snapshot — fetch for all month buckets in the period
    const snapshots = await this.db
      .select()
      .from(monthlySnapshot)
      .where(
        and(
          inArray(monthlySnapshot.snapshotMonth, [...monthBuckets]),
          eq(monthlySnapshot.roleScope, 'company'),
          eq(monthlySnapshot.isLatest, true),
        ),
      );
    const snapshot = snapshots[0] ?? null;

    const periodLabel = getPeriodLabel(period, monthBuckets);

    return {
      month: monthBuckets[0],
      periodLabel,
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

}
