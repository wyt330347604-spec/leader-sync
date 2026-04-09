import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, taskLeader, monthlySnapshot, orgCache, project } from '@leader-sync/db';
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

export interface PersonTask {
  readonly taskUid: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: Date | null;
  readonly daysToDue: number | null;
  readonly isOverdue: boolean;
  readonly bossAttentionFlag: boolean;
  readonly progressPercent: number;
  readonly version: number | null;
}

export interface GanttTask {
  readonly taskUid: string;
  readonly title: string;
  readonly assigneeName: string;
  readonly status: string;
  readonly priority: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly completedAt: Date | null;
  readonly progressPercent: number;
  readonly isOverdue: boolean;
  readonly bossAttentionFlag: boolean;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /**
   * Fetch all task_leader entries for the given task UIDs,
   * keyed by taskUid for easy lookup.
   */
  private async fetchExtraLeaders(
    taskUids: readonly string[],
  ): Promise<ReadonlyMap<string, readonly { leaderUserId: string; leaderName: string | null }[]>> {
    if (taskUids.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(taskLeader)
      .where(inArray(taskLeader.taskUid, [...taskUids]));

    const map = new Map<string, { leaderUserId: string; leaderName: string | null }[]>();
    for (const r of rows) {
      const existing = map.get(r.taskUid) ?? [];
      map.set(r.taskUid, [...existing, { leaderUserId: r.leaderUserId, leaderName: r.leaderName }]);
    }
    return map;
  }

  /**
   * For a given task, return all leader IDs it should be grouped under:
   * the primary leaderUserId plus any additional leaders from task_leader.
   */
  private getLeaderIdsForTask(
    t: { readonly leaderUserId: string; readonly leaderName: string | null; readonly taskUid: string },
    extraLeadersMap: ReadonlyMap<string, readonly { leaderUserId: string; leaderName: string | null }[]>,
  ): readonly { leaderId: string; leaderName: string | null }[] {
    const primary = { leaderId: t.leaderUserId || 'unknown', leaderName: t.leaderName ?? null };
    const extras = extraLeadersMap.get(t.taskUid) ?? [];

    const seen = new Set<string>([primary.leaderId]);
    const result = [primary];

    for (const e of extras) {
      if (!seen.has(e.leaderUserId)) {
        seen.add(e.leaderUserId);
        result.push({ leaderId: e.leaderUserId, leaderName: e.leaderName });
      }
    }

    return result;
  }

  async getBossDashboard(period: DashboardPeriod = { type: 'month' }) {
    const monthBuckets = getMonthBuckets(period);

    const tasks = await this.db
      .select()
      .from(task)
      .where(and(inArray(task.monthBucket, [...monthBuckets]), sql`${task.deletedAt} IS NULL`));

    // Fetch extra leaders from task_leader table
    const taskUids = tasks.map((t) => t.taskUid);
    const extraLeadersMap = await this.fetchExtraLeaders(taskUids);

    // Group by leader, then by member within each leader
    const leaderMap = new Map<string, LeaderEntry>();
    const thisMonday = getThisMonday();

    for (const t of tasks) {
      const isDone = t.status === 'done';
      const isOverdue = t.isOverdue && !DONE_STATUSES.includes(t.status);
      const isCarry = (t.carryOverCount ?? 0) >= 1;
      const riskReasons = computeRiskReasons(t);
      const isRisk = riskReasons.length > 0;
      const isWeeklyNew = t.createdAt >= thisMonday;

      // Each task may belong to multiple leaders
      const leaderEntries = this.getLeaderIdsForTask(t, extraLeadersMap);

      for (const { leaderId, leaderName: lName } of leaderEntries) {
        const prev = leaderMap.get(leaderId) ?? {
          name: lName || '',
          total: 0,
          done: 0,
          overdue: 0,
          carryOver: 0,
          riskCount: 0,
          weeklyNewCount: 0,
          members: [],
        };

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
          name: prev.name || lName || '',
          total: prev.total + 1,
          done: prev.done + (isDone ? 1 : 0),
          overdue: prev.overdue + (isOverdue ? 1 : 0),
          carryOver: prev.carryOver + (isCarry ? 1 : 0),
          riskCount: prev.riskCount + (isRisk ? 1 : 0),
          weeklyNewCount: prev.weeklyNewCount + (isWeeklyNew ? 1 : 0),
          members,
        });
      }
    }

    // After the leader loop, resolve any remaining empty names
    // NOTE: Tasks with empty leader_name should also be backfilled in the DB via a data migration script.
    for (const [leaderId, entry] of leaderMap.entries()) {
      if (!entry.name || entry.name === leaderId) {
        // Try to find name from any task with this leader
        const taskWithName = tasks.find(t =>
          (t.leaderUserId === leaderId || t.assigneeManagerUserId === leaderId) &&
          t.leaderName && t.leaderName !== ''
        );
        if (taskWithName?.leaderName) {
          leaderMap.set(leaderId, { ...entry, name: taskWithName.leaderName });
        } else if (taskWithName?.assigneeManagerName) {
          leaderMap.set(leaderId, { ...entry, name: taskWithName.assigneeManagerName });
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
        riskCount: data.riskCount,
        weeklyNewCount: data.weeklyNewCount,
        doneRate: data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
        members: data.members.sort((a, b) => b.overdue - a.overdue),
      }))
      .sort((a, b) => b.total - a.total);

    // Per-person flat summary (all individuals regardless of leader grouping)
    const personMap = new Map<
      string,
      { name: string; leaderName: string; total: number; done: number; overdue: number; riskCount: number; weeklyNewCount: number; tasks: PersonTask[] }
    >();

    for (const t of tasks) {
      const userId = t.assigneeUserId;
      const prev = personMap.get(userId) ?? {
        name: t.assigneeName || userId,
        leaderName: t.leaderName || '',
        total: 0,
        done: 0,
        overdue: 0,
        riskCount: 0,
        weeklyNewCount: 0,
        tasks: [],
      };

      const isDone = t.status === 'done';
      const isOverdue = t.isOverdue && !DONE_STATUSES.includes(t.status);
      const riskReasons = computeRiskReasons(t);
      const isRisk = riskReasons.length > 0;
      const isWeeklyNew = t.createdAt >= thisMonday;

      const personTask: PersonTask = {
        taskUid: t.taskUid,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        daysToDue: t.daysToDue,
        isOverdue: !!(t.isOverdue && !DONE_STATUSES.includes(t.status)),
        bossAttentionFlag: t.bossAttentionFlag ?? false,
        progressPercent: t.progressPercent ?? 0,
        version: t.version ?? null,
      };

      personMap.set(userId, {
        name: prev.name || t.assigneeName || '',
        leaderName: prev.leaderName || t.leaderName || '',
        total: prev.total + 1,
        done: prev.done + (isDone ? 1 : 0),
        overdue: prev.overdue + (isOverdue ? 1 : 0),
        riskCount: prev.riskCount + (isRisk ? 1 : 0),
        weeklyNewCount: prev.weeklyNewCount + (isWeeklyNew ? 1 : 0),
        tasks: [...prev.tasks, personTask],
      });
    }

    const personSummary = [...personMap.entries()]
      .map(([userId, data]) => ({
        userId,
        name: data.name || userId,
        leaderName: data.leaderName,
        total: data.total,
        done: data.done,
        overdue: data.overdue,
        riskCount: data.riskCount,
        weeklyNewCount: data.weeklyNewCount,
        doneRate: data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
        tasks: data.tasks,
      }))
      .sort((a, b) => b.total - a.total);

    // Group by project
    const projectMap = new Map<string, { name: string; total: number; done: number; overdue: number; riskCount: number }>();
    for (const t of tasks) {
      const pUid = t.projectUid || 'default';
      const prev = projectMap.get(pUid) ?? { name: '', total: 0, done: 0, overdue: 0, riskCount: 0 };
      const isDone = t.status === 'done';
      const isOverdue = t.isOverdue && !DONE_STATUSES.includes(t.status);
      const riskReasons = computeRiskReasons(t);

      projectMap.set(pUid, {
        name: prev.name,
        total: prev.total + 1,
        done: prev.done + (isDone ? 1 : 0),
        overdue: prev.overdue + (isOverdue ? 1 : 0),
        riskCount: prev.riskCount + (riskReasons.length > 0 ? 1 : 0),
      });
    }

    // Resolve project names
    const projectUids = [...projectMap.keys()].filter(k => k !== 'default');
    if (projectUids.length > 0) {
      const projects = await this.db.select().from(project).where(inArray(project.projectUid, projectUids));
      for (const p of projects) {
        const entry = projectMap.get(p.projectUid);
        if (entry) projectMap.set(p.projectUid, { ...entry, name: p.name });
      }
    }
    // Default project name
    const defEntry = projectMap.get('default');
    if (defEntry) projectMap.set('default', { ...defEntry, name: '公司建设' });

    const projectSummary = [...projectMap.entries()].map(([uid, data]) => ({
      projectUid: uid,
      projectName: data.name || uid,
      total: data.total,
      done: data.done,
      overdue: data.overdue,
      riskCount: data.riskCount,
      doneRate: data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);

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
    const riskTaskCount = riskTasks.length;
    const weeklyNewTasks = tasks.filter((t) => t.createdAt >= thisMonday).length;
    const weeklyDoneTasks = tasks.filter(
      (t) => t.status === 'done' && t.completedAt && t.completedAt >= thisMonday,
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
      personSummary,
      projectSummary,
      riskTasks,
      stats: {
        total: totalTasks,
        done: doneTasks,
        overdue: overdueTasks,
        carryOver: carryOverTasks,
        riskCount: riskTaskCount,
        weeklyNewCount: weeklyNewTasks,
        weeklyDoneCount: weeklyDoneTasks,
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

  async getGanttData(period: DashboardPeriod) {
    const monthBuckets = getMonthBuckets(period);

    const tasks = await this.db
      .select()
      .from(task)
      .where(and(inArray(task.monthBucket, [...monthBuckets]), sql`${task.deletedAt} IS NULL`));

    // Fetch extra leaders from task_leader table
    const taskUids = tasks.map((t) => t.taskUid);
    const extraLeadersMap = await this.fetchExtraLeaders(taskUids);

    // Group by leader — a task with multiple leaders appears in each group
    const groups = new Map<string, { leaderName: string; tasks: GanttTask[] }>();

    for (const t of tasks) {
      const ganttTask: GanttTask = {
        taskUid: t.taskUid,
        title: t.title,
        assigneeName: t.assigneeName,
        status: t.status,
        priority: t.priority,
        startAt: t.startAt ?? t.createdAt,
        dueAt: t.dueAt,
        completedAt: t.completedAt,
        progressPercent: t.progressPercent ?? 0,
        isOverdue: t.isOverdue ?? false,
        bossAttentionFlag: t.bossAttentionFlag ?? false,
      };

      const leaderEntries = this.getLeaderIdsForTask(t, extraLeadersMap);

      for (const { leaderId, leaderName: lName } of leaderEntries) {
        const existing = groups.get(leaderId);
        if (existing) {
          groups.set(leaderId, {
            leaderName: existing.leaderName || lName || leaderId,
            tasks: [...existing.tasks, ganttTask],
          });
        } else {
          groups.set(leaderId, {
            leaderName: lName || leaderId,
            tasks: [ganttTask],
          });
        }
      }
    }

    // Resolve any remaining empty leader names in Gantt groups
    for (const [leaderId, group] of groups.entries()) {
      if (!group.leaderName || group.leaderName === leaderId) {
        const taskWithName = tasks.find(t =>
          (t.leaderUserId === leaderId || t.assigneeManagerUserId === leaderId) &&
          t.leaderName && t.leaderName !== ''
        );
        if (taskWithName?.leaderName) {
          groups.set(leaderId, { ...group, leaderName: taskWithName.leaderName });
        } else if (taskWithName?.assigneeManagerName) {
          groups.set(leaderId, { ...group, leaderName: taskWithName.assigneeManagerName });
        }
      }
    }

    // Sort tasks within each group by startAt
    const ganttGroups = [...groups.entries()].map(([leaderId, group]) => ({
      leaderId,
      leaderName: group.leaderName,
      tasks: [...group.tasks].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      ),
    }));

    // Calculate overall time range
    const allDates = tasks
      .flatMap((t) => [t.startAt ?? t.createdAt, t.dueAt])
      .filter(Boolean)
      .map((d) => new Date(d!).getTime());

    const minDate = allDates.length > 0 ? new Date(Math.min(...allDates)).toISOString() : null;
    const maxDate = allDates.length > 0 ? new Date(Math.max(...allDates)).toISOString() : null;

    const periodLabel = getPeriodLabel(period, monthBuckets);

    return {
      periodLabel,
      timeRange: { min: minDate, max: maxDate },
      groups: ganttGroups,
      totalTasks: tasks.length,
    };
  }
}
