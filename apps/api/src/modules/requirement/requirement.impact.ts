/**
 * P0/变更 影响评估（R3）：纯函数，给定窗口内项目范围的在飞任务，
 * 算出哪些人会被挤压、谁该被通知。口径：只「算影响 + 给通知名单」，不静默改期——人工确认。
 */
const DAY = 24 * 60 * 60 * 1000;

export interface ImpactTask {
  taskUid: string;
  title: string;
  assigneeUserId: string;
  assigneeName: string;
  startAt: Date | string | null;
  dueAt: Date | string | null;
  allocationPct: number | null;
  requirementUid: string | null;
  projectUid: string | null;
}

export interface ProjectMeta {
  projectUid: string;
  name: string;
  picUserId: string | null;
  ownerName: string | null;
}

export interface ImpactInput {
  scopeUids: string[];
  windowStart: number; // ms
  windowEnd: number;   // ms
  tasks: readonly ImpactTask[];
  projects: readonly ProjectMeta[];
  picNames: ReadonlyMap<string, string>;
}

export interface AffectedPerson {
  userId: string;
  userName: string;
  peakLoadPct: number;
  level: 'ok' | 'tight' | 'overloaded';
  tasks: { taskUid: string; title: string; dueAt: string | null; allocationPct: number; requirementUid: string | null }[];
}

export interface NotifyTarget {
  name: string;
  reason: string;
}

export interface ImpactResult {
  windowStart: string;
  windowEnd: string;
  affectedPeople: AffectedPerson[];
  notify: NotifyTarget[];
  summary: { peopleCount: number; taskCount: number; overloadedCount: number };
}

function ms(v: Date | string | null): number | null {
  if (v == null) return null;
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}
function span(t: ImpactTask): { start: number; end: number } | null {
  const s = ms(t.startAt);
  const e = ms(t.dueAt);
  if (s === null && e === null) return null;
  return { start: s ?? (e as number) - 7 * DAY, end: e ?? (s as number) + 7 * DAY };
}
function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function level(peak: number): AffectedPerson['level'] {
  if (peak > 100) return 'overloaded';
  if (peak >= 80) return 'tight';
  return 'ok';
}

export function computeImpact(input: ImpactInput): ImpactResult {
  const { scopeUids, windowStart, windowEnd, tasks, projects, picNames } = input;
  const scope = new Set(scopeUids);

  // 命中：范围内 + 区间与窗口相交的在飞任务
  const hit = tasks.filter((t) => {
    if (!t.projectUid || !scope.has(t.projectUid)) return false;
    const sp = span(t);
    return sp !== null && sp.end >= windowStart && sp.start <= windowEnd;
  });

  // 按负责人聚合
  const byUser = new Map<string, AffectedPerson>();
  for (const t of hit) {
    const p = byUser.get(t.assigneeUserId) ?? {
      userId: t.assigneeUserId, userName: t.assigneeName, peakLoadPct: 0, level: 'ok' as const, tasks: [],
    };
    p.tasks.push({
      taskUid: t.taskUid, title: t.title,
      dueAt: t.dueAt ? (t.dueAt instanceof Date ? t.dueAt.toISOString() : t.dueAt) : null,
      allocationPct: t.allocationPct ?? 0, requirementUid: t.requirementUid,
    });
    byUser.set(t.assigneeUserId, p);
  }

  // 每人窗口内每日峰值负载 = Σ当天活跃任务投入度
  const winStart = startOfDay(windowStart);
  for (const p of byUser.values()) {
    const userTasks = hit.filter((t) => t.assigneeUserId === p.userId);
    let peak = 0;
    for (let d = winStart; d <= windowEnd; d += DAY) {
      let load = 0;
      for (const t of userTasks) {
        const sp = span(t);
        if (sp && d >= startOfDay(sp.start) && d <= sp.end) load += t.allocationPct ?? 0;
      }
      if (load > peak) peak = load;
    }
    p.peakLoadPct = peak;
    p.level = level(peak);
  }

  const affectedPeople = Array.from(byUser.values()).sort((a, b) => b.peakLoadPct - a.peakLoadPct);

  // 通知名单：受影响负责人（任务可能顺延）+ 范围项目 PIC/负责人（相关链路）
  const notify: NotifyTarget[] = [];
  const seen = new Set<string>();
  const push = (name: string | null | undefined, reason: string) => {
    if (!name) return;
    const key = `${name}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    notify.push({ name, reason });
  };
  for (const p of affectedPeople) push(p.userName, '负责任务可能顺延');
  for (const pr of projects) {
    if (pr.picUserId) push(picNames.get(pr.picUserId) ?? pr.picUserId, `${pr.name} PIC`);
    push(pr.ownerName, `${pr.name} 负责人`);
  }

  return {
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
    affectedPeople,
    notify,
    summary: {
      peopleCount: affectedPeople.length,
      taskCount: hit.length,
      overloadedCount: affectedPeople.filter((p) => p.level === 'overloaded').length,
    },
  };
}
