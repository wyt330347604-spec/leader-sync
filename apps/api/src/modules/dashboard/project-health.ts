import { TERMINAL_STATUSES, completionRate } from '@leader-sync/shared-types';

const TERMINAL = new Set<string>(TERMINAL_STATUSES);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const AT_RISK_GAP = 0.2; // 已耗时间比例 − 完成比例 超过此值 = 进度落后

export type ProjectHealth = 'on_track' | 'at_risk' | 'overdue';

export interface TaskLike {
  status: string;
  dueAt?: Date | string | null;
  startAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface ProjectRollup {
  progress: number;                 // 0-100 完成率（done/total，剔除 shelved）
  counts: { total: number; done: number; overdue: number };
  spanStart: Date | null;
  spanEnd: Date | null;
  health: ProjectHealth;
}

function asDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 计算项目/子项目的滚动汇总（健康度、进度、任务计数、时间线区间）。纯函数，便于单测。 */
export function rollupProject(tasks: TaskLike[], now: Date): ProjectRollup {
  let total = 0, done = 0, overdue = 0;
  let spanStartMs: number | null = null;
  let spanEndMs: number | null = null;

  for (const t of tasks) {
    if (t.status === 'shelved') continue; // shelved 不入分母（与现有口径一致）
    total++;
    const due = asDate(t.dueAt);
    if (t.status === 'done') done++;
    else if (due && due.getTime() < now.getTime() && !TERMINAL.has(t.status)) overdue++;

    const start = asDate(t.startAt) ?? asDate(t.createdAt);
    if (start) spanStartMs = spanStartMs === null ? start.getTime() : Math.min(spanStartMs, start.getTime());
    if (due) spanEndMs = spanEndMs === null ? due.getTime() : Math.max(spanEndMs, due.getTime());
  }

  const progress = completionRate(done, total);
  const spanStart = spanStartMs === null ? null : new Date(spanStartMs);
  const spanEnd = spanEndMs === null ? null : new Date(spanEndMs);
  const health = computeHealth({ progress, overdue, spanStart, spanEnd, now });

  return { progress, counts: { total, done, overdue }, spanStart, spanEnd, health };
}

function computeHealth(args: {
  progress: number;
  overdue: number;
  spanStart: Date | null;
  spanEnd: Date | null;
  now: Date;
}): ProjectHealth {
  const { progress, overdue, spanStart, spanEnd, now } = args;
  if (overdue > 0) return 'overdue';

  const completion = progress / 100;
  // 已耗时间比例（无区间则视为 0）
  let elapsed = 0;
  if (spanStart && spanEnd) {
    const span = spanEnd.getTime() - spanStart.getTime();
    elapsed = span <= 0 ? 1 : Math.max(0, Math.min(1, (now.getTime() - spanStart.getTime()) / span));
  }
  const behindSchedule = elapsed - completion > AT_RISK_GAP;
  const nearDeadlineLowProgress =
    !!spanEnd && spanEnd.getTime() - now.getTime() <= WEEK_MS && spanEnd.getTime() >= now.getTime() && progress < 80;

  return behindSchedule || nearDeadlineLowProgress ? 'at_risk' : 'on_track';
}
