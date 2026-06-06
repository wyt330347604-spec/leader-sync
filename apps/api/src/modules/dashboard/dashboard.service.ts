import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, taskLeader, monthlySnapshot, orgCache, project, incident, requirement } from '@leader-sync/db';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { BusinessException } from '../../common/exceptions/business.exception';
import { TERMINAL_STATUSES, cumulativeCounts, isInDueSet, completionRate } from '@leader-sync/shared-types';
import { rollupProject } from './project-health';

// 口径主权统一到 shared-types。保留本名以最小化改动；widen 成 string[] 便于 .includes(任意 status)。
const DONE_STATUSES: readonly string[] = TERMINAL_STATUSES;

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

/** 该周期最后一刻（最后一个月份桶的月末 23:59:59.999），用于累计口径的到期判定。 */
function getPeriodEnd(monthBuckets: readonly string[]): Date {
  const last = monthBuckets[monthBuckets.length - 1];
  const [y, mo] = last.split('-').map((n) => parseInt(n, 10));
  return new Date(y, mo, 0, 23, 59, 59, 999); // 下月第 0 天 = 本月最后一天（本地时区，与月结一致）
}

/**
 * 归属月份区间谓词：一条任务在某月份桶里出现过，当且仅当它的存活区间
 * [source_month（最初归属月；未继承则=自身桶）.. month_bucket（当前桶）]
 * 与周期 [periodStart..periodEnd] 相交。
 *
 * ⚠️ 不能用 source_month = M 等值：source_month 是「最初归属月」，多次继承的任务其值会早于
 * 回看月（carry_over_count=4 → source=4 个月前），等值判断会漏掉长期积压任务。
 * monthBuckets 由 getMonthBuckets 返回，按月份升序，故首尾即区间端点。
 */
function belongsToMonths(monthBuckets: readonly string[]) {
  const periodStart = monthBuckets[0];
  const periodEnd = monthBuckets[monthBuckets.length - 1];
  return and(
    sql`${task.monthBucket} >= ${periodStart}`,
    sql`COALESCE(${task.sourceMonth}, ${task.monthBucket}) <= ${periodEnd}`,
    // 私有任务不计入任何驾驶舱统计/分解。
    sql`${task.visibility} <> 'private'`,
  );
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

/**
 * Returns Monday 00:00:00 Asia/Shanghai for the current week as a UTC Date.
 * Asia/Shanghai = UTC+8, so Monday 00:00 Shanghai = Sunday 16:00 UTC of prior week.
 */
function getThisWeekMondayShanghai(): Date {
  // Work in UTC offset +8 by shifting the current time
  const now = new Date();
  const shangHaiOffsetMs = 8 * 60 * 60 * 1000;
  const localMs = now.getTime() + shangHaiOffsetMs;
  const localDate = new Date(localMs);
  const dayOfWeek = localDate.getUTCDay() || 7; // Monday=1 … Sunday=7
  const mondayLocal = new Date(localMs);
  mondayLocal.setUTCDate(localDate.getUTCDate() - dayOfWeek + 1);
  mondayLocal.setUTCHours(0, 0, 0, 0);
  // Convert back to UTC
  return new Date(mondayLocal.getTime() - shangHaiOffsetMs);
}

/**
 * Returns Sunday 23:59:59.999 Asia/Shanghai for the week starting at the given Monday (UTC).
 */
function getThisWeekSundayShanghai(monday: Date): Date {
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 3600 * 1000 + 59 * 60 * 1000 + 59 * 1000 + 999);
  return sunday;
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

    // 归属月份区间口径（含被继承走的任务）。详见 belongsToMonths 注释。
    const tasks = await this.db
      .select()
      .from(task)
      .where(and(belongsToMonths(monthBuckets), sql`${task.deletedAt} IS NULL`));

    // Fetch extra leaders from task_leader table
    const taskUids = tasks.map((t) => t.taskUid);
    const extraLeadersMap = await this.fetchExtraLeaders(taskUids);

    // 周期末（累计口径到期时点），子表与顶部统计统一使用。
    const periodEnd = getPeriodEnd(monthBuckets);

    // Group by leader, then by member within each leader
    const leaderMap = new Map<string, LeaderEntry>();
    const thisMonday = getThisMonday();

    for (const t of tasks) {
      // 累计口径：仅 due_at ≤ 周期末 且非 shelved 的任务计入分母，与顶部/月结一致（#4）。
      const inDue = isInDueSet(t, periodEnd);
      const isDone = inDue && t.status === 'done';
      const isOverdue = inDue && !DONE_STATUSES.includes(t.status);
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
            total: m.total + (inDue ? 1 : 0),
            done: m.done + (isDone ? 1 : 0),
            overdue: m.overdue + (isOverdue ? 1 : 0),
          };
        } else {
          members.push({
            userId: t.assigneeUserId,
            name: t.assigneeName || t.assigneeUserId,
            total: inDue ? 1 : 0,
            done: isDone ? 1 : 0,
            overdue: isOverdue ? 1 : 0,
          });
        }

        leaderMap.set(leaderId, {
          name: prev.name || lName || '',
          total: prev.total + (inDue ? 1 : 0),
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
        doneRate: completionRate(data.done, data.total),
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

      const inDue = isInDueSet(t, periodEnd);
      const isDone = inDue && t.status === 'done';
      const isOverdue = inDue && !DONE_STATUSES.includes(t.status);
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
        total: prev.total + (inDue ? 1 : 0),
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
        doneRate: completionRate(data.done, data.total),
        tasks: data.tasks,
      }))
      .sort((a, b) => b.total - a.total);

    // Group by project
    const projectMap = new Map<string, { name: string; total: number; done: number; overdue: number; riskCount: number }>();
    for (const t of tasks) {
      const pUid = t.projectUid || 'default';
      const prev = projectMap.get(pUid) ?? { name: '', total: 0, done: 0, overdue: 0, riskCount: 0 };
      const inDue = isInDueSet(t, periodEnd);
      const isDone = inDue && t.status === 'done';
      const isOverdue = inDue && !DONE_STATUSES.includes(t.status);
      const riskReasons = computeRiskReasons(t);

      projectMap.set(pUid, {
        name: prev.name,
        total: prev.total + (inDue ? 1 : 0),
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
      doneRate: completionRate(data.done, data.total),
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

    // 实时累计口径（当前/未结月份用），与 shared-types.cumulativeCounts 单一来源一致。
    const live = cumulativeCounts(tasks, periodEnd);
    // 继承数 = 携带进本期的任务（carryOverCount>=1）。始终用此口径，不被快照覆盖，
    // 避免与快照里「将顺延出去」(monthCarryOverCount) 的语义混淆（#3）。
    const carryOver = tasks.filter((t) => (t.carryOverCount ?? 0) >= 1).length;
    const riskTaskCount = riskTasks.length;
    const weeklyNewTasks = tasks.filter((t) => t.createdAt >= thisMonday).length;
    const weeklyDoneTasks = tasks.filter(
      (t) => t.status === 'done' && t.completedAt && t.completedAt >= thisMonday,
    ).length;

    // Snapshot — 已结月份的冻结口径。#1: 按 generatedAt 倒序取最新一条，避免重跑后多行 isLatest 的非确定性。
    const snapshots = await this.db
      .select()
      .from(monthlySnapshot)
      .where(
        and(
          inArray(monthlySnapshot.snapshotMonth, [...monthBuckets]),
          eq(monthlySnapshot.roleScope, 'company'),
          eq(monthlySnapshot.isLatest, true),
        ),
      )
      .orderBy(desc(monthlySnapshot.generatedAt))
      .limit(1);
    const snapshot = snapshots[0] ?? null;

    // 冻结快照优先：已结单月的总/完成/延期取自快照（与月报口径一致，不随后续状态漂移）。
    // 当前/未结月份或多月周期用实时累计口径。snapshot 计数列为 NOT NULL，故无需 ?? 兜底。
    const useSnapshot = monthBuckets.length === 1 && snapshot != null;
    const total = useSnapshot ? snapshot.monthDueCount : live.total;
    const done = useSnapshot ? snapshot.monthDoneCount : live.done;
    const overdue = useSnapshot ? snapshot.monthOverdueCount : live.overdue;

    const periodLabel = getPeriodLabel(period, monthBuckets);

    return {
      month: monthBuckets[0],
      periodLabel,
      leaderSummary,
      personSummary,
      projectSummary,
      riskTasks,
      stats: {
        total,
        done,
        overdue,
        carryOver,
        riskCount: riskTaskCount,
        weeklyNewCount: weeklyNewTasks,
        weeklyDoneCount: weeklyDoneTasks,
        doneRate: completionRate(done, total),
        overdueRate: completionRate(overdue, total),
      },
      snapshot: snapshot
        ? {
            doneRate: snapshot.doneRate,
            overdueRate: snapshot.overdueRate,
            monthDueCount: snapshot.monthDueCount,
            monthDoneCount: snapshot.monthDoneCount,
            monthOverdueCount: snapshot.monthOverdueCount,
            monthCarryOverCount: snapshot.monthCarryOverCount,
          }
        : null,
    };
  }

  async getGanttData(period: DashboardPeriod) {
    const monthBuckets = getMonthBuckets(period);

    // 归属月份区间口径（含被继承走的任务），详见 belongsToMonths 注释。
    const tasks = await this.db
      .select()
      .from(task)
      .where(and(belongsToMonths(monthBuckets), sql`${task.deletedAt} IS NULL`));

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

  // ---------------------------------------------------------------------------
  // 项目驱动 V1a：项目组合视图（项目→子项目 两级树 + 健康度/进度/区间滚动汇总）
  // ---------------------------------------------------------------------------
  async getProjectPortfolio(now: Date = new Date()) {
    const projects = await this.db.select().from(project).orderBy(project.createdAt);
    // PIC 显示名映射（user_id → user_name）
    const orgUsers = await this.db.select({ userId: orgCache.userId, userName: orgCache.userName }).from(orgCache);
    const nameOf = new Map(orgUsers.map((u) => [u.userId, u.userName]));
    // 活跃、非私有任务（项目视图=公司/团队执行口径，私有任务不计入）
    const tasks = await this.db
      .select({
        taskUid: task.taskUid,
        title: task.title,
        projectUid: task.projectUid,
        status: task.status,
        progressPercent: task.progressPercent,
        dueAt: task.dueAt,
        startAt: task.startAt,
        createdAt: task.createdAt,
      })
      .from(task)
      .where(and(sql`${task.deletedAt} IS NULL`, sql`${task.visibility} <> 'private'`));

    const byProject = new Map<string, typeof tasks>();
    for (const t of tasks) {
      if (!t.projectUid) continue;
      const arr = byProject.get(t.projectUid);
      if (arr) arr.push(t);
      else byProject.set(t.projectUid, [t]);
    }
    const childrenOf = new Map<string, typeof projects>();
    for (const p of projects) {
      if (!p.parentProjectUid) continue;
      const arr = childrenOf.get(p.parentProjectUid);
      if (arr) arr.push(p);
      else childrenOf.set(p.parentProjectUid, [p]);
    }
    const directTasks = (uid: string) => byProject.get(uid) ?? [];

    // 关联事故计数（V2）：未删除、未驳回的事故，按 related_project_uid 聚合
    const incidents = await this.db
      .select({ relatedProjectUid: incident.relatedProjectUid })
      .from(incident)
      .where(and(sql`${incident.deletedAt} IS NULL`, sql`${incident.confirmStatus} <> 'rejected'`));
    const incByProject = new Map<string, number>();
    for (const i of incidents) {
      if (!i.relatedProjectUid) continue;
      incByProject.set(i.relatedProjectUid, (incByProject.get(i.relatedProjectUid) ?? 0) + 1);
    }
    const directIncidents = (uid: string) => incByProject.get(uid) ?? 0;

    // 需求计数（R1c 联动）：未删除需求按归属聚合。挂 app 的归 app；挂业务线本身的归业务线直接计数。
    const reqs = await this.db
      .select({ businessLineUid: requirement.businessLineUid, appProjectUid: requirement.appProjectUid })
      .from(requirement)
      .where(sql`${requirement.deletedAt} IS NULL`);
    const reqByApp = new Map<string, number>();
    const reqOnLine = new Map<string, number>();
    for (const r of reqs) {
      if (r.appProjectUid) reqByApp.set(r.appProjectUid, (reqByApp.get(r.appProjectUid) ?? 0) + 1);
      else reqOnLine.set(r.businessLineUid, (reqOnLine.get(r.businessLineUid) ?? 0) + 1);
    }

    const meta = (p: (typeof projects)[number]) => ({
      projectUid: p.projectUid,
      name: p.name,
      category: p.category,
      region: p.region,
      ownerName: p.ownerName,
      picUserId: p.picUserId,
      picName: p.picUserId ? nameOf.get(p.picUserId) ?? null : null,
      isDefault: p.isDefault,
      parentProjectUid: p.parentProjectUid,
    });
    // 任务的轻量展示视图（供分层甘特画 task bar）。
    const nowMs = now.getTime();
    const taskView = (t: (typeof tasks)[number]) => ({
      taskUid: t.taskUid,
      title: t.title,
      status: t.status,
      progressPercent: t.progressPercent ?? 0,
      startAt: t.startAt,
      dueAt: t.dueAt,
      overdue: !!t.dueAt && new Date(t.dueAt as any).getTime() < nowMs && !TERMINAL_STATUSES.includes(t.status as any),
    });
    // rollupTasks 用于汇总口径（顶级含子项目）；displayTasks 是本节点直接任务（画 bar/下钻）。
    const buildNode = (
      p: (typeof projects)[number],
      rollupTasks: typeof tasks,
      displayTasks: typeof tasks = rollupTasks,
    ) => ({
      ...meta(p),
      ...rollupProject(rollupTasks as any, now),
      tasks: displayTasks.map(taskView),
    });

    return projects
      .filter((p) => !p.parentProjectUid)
      .map((p) => {
        const subs = childrenOf.get(p.projectUid) ?? [];
        const subProjects = subs.map((s) => ({
          ...buildNode(s, directTasks(s.projectUid)),
          incidentCount: directIncidents(s.projectUid),
          requirementCount: reqByApp.get(s.projectUid) ?? 0,
        }));
        // 顶级项目滚动汇总 = 直接任务 + 所有子项目任务（传递）；直接任务用于本行 bar/下钻。
        const direct = directTasks(p.projectUid);
        const allTasks = [...direct, ...subs.flatMap((s) => directTasks(s.projectUid))];
        // 事故数 = 本项目 + 所有子项目（传递）
        const incidentCount = directIncidents(p.projectUid) + subs.reduce((n, s) => n + directIncidents(s.projectUid), 0);
        const node = { ...buildNode(p, allTasks, direct), incidentCount, subProjects };
        // R0 业务线语义：业务线永续、无交付日。健康度=最差子项目(app)；附 app 计数。
        const atRiskCount = subProjects.filter((s) => s.health === 'at_risk').length;
        const overdueCount = subProjects.filter((s) => s.health === 'overdue').length;
        const blHealth = subProjects.length > 0
          ? (overdueCount > 0 ? 'overdue' : atRiskCount > 0 ? 'at_risk' : 'on_track')
          : node.health;
        // 需求：挂业务线本身 + 各 app 之和（业务线概览同时展示两者）
        const reqOnLineCount = reqOnLine.get(p.projectUid) ?? 0;
        const requirementCount = reqOnLineCount + subProjects.reduce((n, s) => n + s.requirementCount, 0);
        return {
          ...node, isBusinessLine: true, appCount: subProjects.length, atRiskCount, overdueCount, health: blHealth,
          requirementCount, requirementOnLineCount: reqOnLineCount,
        };
      });
  }

  // ---------------------------------------------------------------------------
  // NEW: getLeaderMonthly — §2.1
  // Returns aggregated monthly stats for all members under the given leader.
  // ---------------------------------------------------------------------------
  async getLeaderMonthly(leaderId: string, leaderName: string, month?: string) {
    const bucket = month || getCurrentMonth();

    // 归属月份区间口径：含被继承走的任务（回看上月时不丢）。详见 belongsToMonths 注释。
    const allTasks = await this.db
      .select()
      .from(task)
      .where(and(belongsToMonths([bucket]), sql`${task.deletedAt} IS NULL`));

    const taskUids = allTasks.map((t) => t.taskUid);
    const extraLeadersMap = await this.fetchExtraLeaders(taskUids);

    // Filter to tasks that belong to the requesting leader (primary or extra)
    const leaderTasks = allTasks.filter((t) => {
      if (t.leaderUserId === leaderId) return true;
      const extras = extraLeadersMap.get(t.taskUid) ?? [];
      return extras.some((e) => e.leaderUserId === leaderId);
    });

    // 累计口径（与驾驶舱顶部/月结一致，#4）：仅 due_at ≤ 月末 且非 shelved 计入分母。
    const periodEnd = getPeriodEnd([bucket]);

    // Aggregate per member
    const memberMap = new Map<
      string,
      { name: string; total: number; done: number; overdue: number }
    >();

    for (const t of leaderTasks) {
      const inDue = isInDueSet(t, periodEnd);
      const isDone = inDue && t.status === 'done';
      const isOverdue = inDue && !DONE_STATUSES.includes(t.status);
      const prev = memberMap.get(t.assigneeUserId) ?? {
        name: t.assigneeName || t.assigneeUserId,
        total: 0,
        done: 0,
        overdue: 0,
      };
      memberMap.set(t.assigneeUserId, {
        name: prev.name,
        total: prev.total + (inDue ? 1 : 0),
        done: prev.done + (isDone ? 1 : 0),
        overdue: prev.overdue + (isOverdue ? 1 : 0),
      });
    }

    const members = [...memberMap.entries()].map(([userId, data]) => ({
      userId,
      name: data.name,
      total: data.total,
      done: data.done,
      overdue: data.overdue,
      completionRate: completionRate(data.done, data.total),
    }));

    const { total, done, overdue } = cumulativeCounts(leaderTasks, periodEnd);

    return {
      month: bucket,
      leaderId,
      leaderName,
      total,
      done,
      overdue,
      completionRate: completionRate(done, total),
      members,
    };
  }

  // ---------------------------------------------------------------------------
  // NEW: getLeaderMemberTasks — §2.2
  // Returns task detail list for a specific member under the requesting leader.
  // Throws 1002 NO_PERMISSION if the leader has no task association with the member.
  // ---------------------------------------------------------------------------
  async getLeaderMemberTasks(
    requestingLeaderId: string,
    memberUserId: string,
    month?: string,
  ) {
    const bucket = month || getCurrentMonth();

    // 归属月份区间口径：含被继承走的任务（回看上月时不丢）。详见 belongsToMonths 注释。
    const memberTasks = await this.db
      .select()
      .from(task)
      .where(
        and(
          eq(task.assigneeUserId, memberUserId),
          belongsToMonths([bucket]),
          sql`${task.deletedAt} IS NULL`,
        ),
      );

    const taskUids = memberTasks.map((t) => t.taskUid);
    const extraLeadersMap = await this.fetchExtraLeaders(taskUids);

    // Permission check: at least one task must be under the requesting leader
    const hasAccess = memberTasks.some((t) => {
      if (t.leaderUserId === requestingLeaderId) return true;
      const extras = extraLeadersMap.get(t.taskUid) ?? [];
      return extras.some((e) => e.leaderUserId === requestingLeaderId);
    });

    if (!hasAccess) {
      throw new BusinessException(1002, 'NO_PERMISSION', HttpStatus.FORBIDDEN);
    }

    const userName = memberTasks[0]?.assigneeName || memberUserId;
    // 汇总用累计口径（#4）；任务明细列表仍展示全部归属任务。
    const { total, done, overdue } = cumulativeCounts(memberTasks, getPeriodEnd([bucket]));

    const taskDetails = memberTasks.map((t) => ({
      taskUid: t.taskUid,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      isOverdue: !!(t.isOverdue && !DONE_STATUSES.includes(t.status)),
      progressPercent: t.progressPercent ?? 0,
      bossAttentionFlag: t.bossAttentionFlag ?? false,
      delayCount: t.delayCount ?? 0,
      carryOverCount: t.carryOverCount ?? 0,
    }));

    return {
      month: bucket,
      userId: memberUserId,
      userName,
      summary: {
        total,
        done,
        overdue,
        completionRate: completionRate(done, total),
      },
      tasks: taskDetails,
    };
  }

  // ---------------------------------------------------------------------------
  // NEW: getLeaderWeekly — §2.3
  // Returns weekly progress for all members under the requesting leader.
  // "This week" is Mon 00:00 to Sun 23:59:59 Asia/Shanghai.
  // ---------------------------------------------------------------------------
  async getLeaderWeekly(leaderId: string, leaderName: string) {
    const thisMonday = getThisWeekMondayShanghai();
    const thisSunday = getThisWeekSundayShanghai(thisMonday);

    // Fetch all non-deleted tasks (weekly view can span month boundaries)
    const allTasks = await this.db
      .select()
      .from(task)
      .where(sql`${task.deletedAt} IS NULL`);

    const taskUids = allTasks.map((t) => t.taskUid);
    const extraLeadersMap = await this.fetchExtraLeaders(taskUids);

    // Filter to tasks that belong to the requesting leader
    const leaderTasks = allTasks.filter((t) => {
      if (t.leaderUserId === leaderId) return true;
      const extras = extraLeadersMap.get(t.taskUid) ?? [];
      return extras.some((e) => e.leaderUserId === leaderId);
    });

    // Aggregate per member
    const memberMap = new Map<
      string,
      { name: string; newCount: number; doneCount: number; overdueCount: number }
    >();

    for (const t of leaderTasks) {
      const isNewThisWeek = t.createdAt >= thisMonday && t.createdAt <= thisSunday;
      const isDoneThisWeek =
        t.status === 'done' && t.completedAt != null && t.completedAt >= thisMonday;
      const isOverdueActive = !!(t.isOverdue && !DONE_STATUSES.includes(t.status));

      const prev = memberMap.get(t.assigneeUserId) ?? {
        name: t.assigneeName || t.assigneeUserId,
        newCount: 0,
        doneCount: 0,
        overdueCount: 0,
      };
      memberMap.set(t.assigneeUserId, {
        name: prev.name,
        newCount: prev.newCount + (isNewThisWeek ? 1 : 0),
        doneCount: prev.doneCount + (isDoneThisWeek ? 1 : 0),
        overdueCount: prev.overdueCount + (isOverdueActive ? 1 : 0),
      });
    }

    const members = [...memberMap.entries()].map(([userId, data]) => {
      const total = data.doneCount + data.overdueCount;
      return {
        userId,
        name: data.name,
        newCount: data.newCount,
        doneCount: data.doneCount,
        overdueCount: data.overdueCount,
        completionRate: total > 0 ? Math.round((data.doneCount / total) * 100) : 0,
      };
    });

    const teamNewCount = members.reduce((s, m) => s + m.newCount, 0);
    const teamDoneCount = members.reduce((s, m) => s + m.doneCount, 0);
    const teamOverdueCount = members.reduce((s, m) => s + m.overdueCount, 0);
    const teamTotal = teamDoneCount + teamOverdueCount;

    return {
      weekStart: thisMonday.toISOString(),
      weekEnd: thisSunday.toISOString(),
      leaderId,
      leaderName,
      members,
      teamSummary: {
        newCount: teamNewCount,
        doneCount: teamDoneCount,
        overdueCount: teamOverdueCount,
        completionRate: teamTotal > 0 ? Math.round((teamDoneCount / teamTotal) * 100) : 0,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // NEW: getMyMonthly — §2.4
  // Returns current user's own monthly task summary.
  // ---------------------------------------------------------------------------
  async getMyMonthly(userId: string, userName: string, month?: string) {
    const bucket = month || getCurrentMonth();

    // 归属月份区间口径：含被继承走的任务（回看上月时不丢）。详见 belongsToMonths 注释。
    const userTasks = await this.db
      .select()
      .from(task)
      .where(
        and(
          eq(task.assigneeUserId, userId),
          belongsToMonths([bucket]),
          sql`${task.deletedAt} IS NULL`,
        ),
      );

    // 累计口径（#4）：分母 = due_at ≤ 月末 且非 shelved。
    const { total, done, overdue } = cumulativeCounts(userTasks, getPeriodEnd([bucket]));
    const inProgress = userTasks.filter((t) => t.status === 'in_progress').length;
    const carriedOver = userTasks.filter((t) => (t.carryOverCount ?? 0) >= 1).length;
    const delayTotal = userTasks.reduce((s, t) => s + (t.delayCount ?? 0), 0);

    return {
      month: bucket,
      userId,
      userName,
      total,
      done,
      inProgress,
      overdue,
      completionRate: completionRate(done, total),
      carriedOver,
      delayTotal,
    };
  }
}
