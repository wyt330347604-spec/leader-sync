// 统计口径主权（单一来源）。被 worker（月结快照）与 api（驾驶舱实时）共同引用，避免口径漂移。
// 文档：docs/02-data/metrics-definition.md（累计口径，2026-06 起生效）。

/** 终态：不参与继承、不计入逾期分子、不计入应完成分母。 */
export const TERMINAL_STATUSES = ['done', 'shelved', 'closed'] as const;

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

/** monthly_snapshot.done_rate / overdue_rate 列为 numeric(5,4)，绝对值上限 9.9999。 */
const RATE_MAX = 9.9999;

/** 把比率钳制到 [0, 9.9999]，NaN→0，Infinity→上限。写库前兜底防 22003 overflow。 */
export function clampRate(n: number): number {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 0 : RATE_MAX;
  return Math.min(RATE_MAX, Math.max(0, n));
}

/** 完成率（整数百分比，0 分母安全）。统一前后端 done/total 口径。 */
export function completionRate(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function asDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface CumulativeCounts {
  /** 应完成全集：due_at ≤ periodEnd 且非 shelved（含已完成）。作为完成率/延期率统一分母。 */
  total: number;
  /** 其中已完成：due_at ≤ periodEnd 且 status=done。 */
  done: number;
  /** 其中逾期未完成：due_at ≤ periodEnd 且 status ∉ {done,shelved,closed}。 */
  overdue: number;
}

/**
 * 累计口径计数（单一权威实现）。调用方自行剔除 deleted_at（仅传活跃任务）。
 * 完成率 + 延期率 ≈ 1（差额来自 closed 等终态）。
 */
export function cumulativeCounts(tasks: any[], periodEnd: Date): CumulativeCounts {
  let total = 0;
  let done = 0;
  let overdue = 0;
  for (const t of tasks) {
    const d = asDate(t.dueAt);
    if (d === null || d > periodEnd) continue;
    if (t.status === 'shelved') continue; // shelved 不入分母
    total++;
    if (t.status === 'done') done++;
    else if (!TERMINAL_SET.has(t.status)) overdue++; // closed 既不算 done 也不算 overdue
  }
  return { total, done, overdue };
}

/** 单条任务是否计入「截至 periodEnd 的应完成全集」（用于分组累加保持口径一致）。 */
export function isInDueSet(task: any, periodEnd: Date): boolean {
  const d = asDate(task.dueAt);
  return d !== null && d <= periodEnd && task.status !== 'shelved';
}

export interface MonthlyStats extends CumulativeCounts {
  monthOpenCount: number;
  monthNewCount: number;
  monthDueCount: number;
  monthDoneCount: number;
  monthOverdueCount: number;
  monthCarryOverCount: number;
  doneRate: number;
  overdueRate: number;
  carryOverCandidates: any[];
}

/**
 * 月结快照统计（累计口径）。monthCarryOverCount = 非终态任务数（将顺延到下月的候选）。
 */
export function computeStats(tasks: any[], monthStart: Date, monthEnd: Date): MonthlyStats {
  const monthOpenCount = tasks.filter((t) => {
    const c = asDate(t.createdAt);
    return c !== null && c < monthStart;
  }).length;

  const monthNewCount = tasks.filter((t) => {
    const c = asDate(t.createdAt);
    return c !== null && c >= monthStart && c <= monthEnd;
  }).length;

  const { total, done, overdue } = cumulativeCounts(tasks, monthEnd);

  const carryOverCandidates = tasks.filter((t) => !TERMINAL_SET.has(t.status));
  const monthCarryOverCount = carryOverCandidates.length;

  const doneRate = total > 0 ? done / total : 0;
  const overdueRate = total > 0 ? overdue / total : 0;

  return {
    total,
    done,
    overdue,
    monthOpenCount,
    monthNewCount,
    monthDueCount: total,
    monthDoneCount: done,
    monthOverdueCount: overdue,
    monthCarryOverCount,
    doneRate,
    overdueRate,
    carryOverCandidates,
  };
}
