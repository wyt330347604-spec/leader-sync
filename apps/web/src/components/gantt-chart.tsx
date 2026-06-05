'use client';
import { useMemo, useState } from 'react';

/* ---------- Types ---------- */

interface GanttTask {
  readonly taskUid: string;
  readonly title: string;
  readonly assigneeName: string;
  readonly status: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly completedAt: string | null;
  readonly progressPercent: number;
  readonly isOverdue: boolean;
  readonly bossAttentionFlag: boolean;
}

interface GanttGroup {
  readonly leaderId: string;
  readonly leaderName: string;
  readonly tasks: readonly GanttTask[];
}

interface GanttData {
  readonly groups: readonly GanttGroup[];
  readonly timeRange: { readonly min: string; readonly max: string };
}

interface GanttChartProps {
  readonly data: GanttData | null | undefined;
  readonly isLoading: boolean;
  readonly error: Error | null | undefined;
  readonly filterPersons?: readonly string[];
  readonly filterTaskTitle?: string;
}

/* ---------- Helpers ---------- */

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function toStartOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateShort(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function getBarColor(status: string, isOverdue: boolean): string {
  if (isOverdue) return 'bg-[var(--accent-red)]';
  switch (status) {
    case 'done':
      return 'bg-[var(--accent-green)]';
    case 'in_progress':
      return 'bg-[var(--accent-blue)]';
    case 'stalled':
      return 'bg-[var(--accent-red)]';
    case 'pending':
    case 'not_started':
      return 'bg-[var(--text-muted)]';
    default:
      return 'bg-[var(--text-muted)]';
  }
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待办',
    not_started: '待开始',
    in_progress: '进行中',
    stalled: '已停滞',
    done: '已完成',
    shelved: '已搁置',
    pending_review: '待验收',
    reopened: '重新打开',
    closed: '已归档',
  };
  return labels[status] ?? status;
}

/** Generate date markers for timeline header */
function buildMarkers(minDate: Date, maxDate: Date): readonly { date: Date; label: string }[] {
  const totalDays = daysBetween(minDate, maxDate);
  const markers: { date: Date; label: string }[] = [];

  if (totalDays <= 0) return markers;

  // For ranges <= 60 days, mark every Monday; otherwise mark 1st and 15th of each month
  if (totalDays <= 60) {
    const cursor = new Date(minDate);
    // Advance to next Monday
    const dayOfWeek = cursor.getDay();
    const daysUntilMon = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
    cursor.setDate(cursor.getDate() + daysUntilMon);
    while (cursor <= maxDate) {
      markers.push({ date: new Date(cursor), label: formatDateShort(cursor) });
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (cursor <= maxDate) {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      if (first >= minDate && first <= maxDate) {
        markers.push({ date: first, label: `${first.getMonth() + 1}/1` });
      }
      const fifteenth = new Date(cursor.getFullYear(), cursor.getMonth(), 15);
      if (fifteenth >= minDate && fifteenth <= maxDate) {
        markers.push({ date: fifteenth, label: `${fifteenth.getMonth() + 1}/15` });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return markers;
}

/* ---------- Sub-group by person within a leader group ---------- */

interface PersonSubGroup {
  readonly personName: string;
  readonly personKey: string; // `${leaderId}-${assigneeName}`
  readonly bars: readonly { task: GanttTask; leftPct: number; widthPct: number }[];
}

interface ComputedLeaderGroup {
  readonly leaderId: string;
  readonly leaderName: string;
  readonly personSubGroups: readonly PersonSubGroup[];
}

/* ---------- Tooltip ---------- */

function TaskTooltip({
  task,
  visible,
}: {
  readonly task: GanttTask;
  readonly visible: boolean;
}) {
  if (!visible) return null;

  const startStr = new Date(task.startAt).toLocaleDateString('zh-CN');
  const dueStr = new Date(task.dueAt).toLocaleDateString('zh-CN');

  return (
    <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-xl pointer-events-none">
      <p className="font-medium">{task.title}</p>
      <p className="mt-1 text-[var(--text-secondary)]">
        {task.assigneeName} &middot; {getStatusLabel(task.status)}
      </p>
      <p className="text-[var(--text-secondary)]">
        {startStr} - {dueStr}
      </p>
      <p className="text-[var(--text-secondary)]">
        进度: {task.progressPercent}%
        {task.isOverdue ? ' (已延期)' : ''}
      </p>
      {task.bossAttentionFlag && (
        <p className="text-[var(--accent-orange)]">重点任务</p>
      )}
    </div>
  );
}

/* ---------- Task Bar ---------- */

function TaskBar({
  task,
  leftPct,
  widthPct,
}: {
  readonly task: GanttTask;
  readonly leftPct: number;
  readonly widthPct: number;
}) {
  const [hovered, setHovered] = useState(false);
  const barColor = getBarColor(task.status, task.isOverdue);
  const pulseClass = task.isOverdue ? 'animate-pulse' : '';

  return (
    <div
      className="relative h-7 my-0.5"
      style={{ marginLeft: `${leftPct}%`, width: `${widthPct}%` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TaskTooltip task={task} visible={hovered} />
      {/* Outer bar */}
      <div
        className={`relative h-full rounded ${barColor} ${pulseClass} overflow-hidden cursor-pointer`}
        style={{ opacity: task.isOverdue ? undefined : 0.85 }}
      >
        {/* Progress fill */}
        {task.progressPercent > 0 && task.progressPercent < 100 && (
          <div
            className="absolute inset-y-0 left-0 rounded bg-white/20"
            style={{ width: `${task.progressPercent}%` }}
          />
        )}
        {/* Label */}
        <div className="absolute inset-0 flex items-center gap-1 px-1.5 overflow-hidden">
          {task.bossAttentionFlag && (
            <span className="shrink-0 text-[10px] text-[var(--accent-orange)]" title="重点任务">
              ★
            </span>
          )}
          <span className="truncate text-[10px] font-medium text-white leading-none">
            {task.title}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main Component ---------- */

export function GanttChart({ data, isLoading, error, filterPersons, filterTaskTitle }: GanttChartProps) {
  const [expandedPersons, setExpandedPersons] = useState<Set<string>>(() => new Set());

  const computed = useMemo(() => {
    if (!data?.groups || !data.timeRange) return null;

    if (!data.timeRange.min || !data.timeRange.max) return null;

    const minDate = toStartOfDay(new Date(data.timeRange.min));
    const maxDate = toStartOfDay(new Date(data.timeRange.max));

    if (isNaN(minDate.getTime()) || isNaN(maxDate.getTime())) return null;

    const totalDays = daysBetween(minDate, maxDate);

    if (totalDays <= 0) return null;

    const markers = buildMarkers(minDate, maxDate);

    const today = toStartOfDay(new Date());
    const todayPct = daysBetween(minDate, today) / totalDays * 100;
    const showToday = todayPct >= 0 && todayPct <= 100;

    const activeFilterPersons = filterPersons ?? [];
    const activeFilterTitle = filterTaskTitle ?? '';

    const groups: ComputedLeaderGroup[] = data.groups.map((group) => {
      // Filter tasks: skip tasks without dueAt and apply user filters
      const filteredTasks = group.tasks.filter((task) => {
        // Skip tasks that have no dueAt — can't render a bar without an end date
        if (!task.dueAt) return false;
        if (activeFilterPersons.length > 0 && !activeFilterPersons.includes(task.assigneeName)) {
          return false;
        }
        if (activeFilterTitle && !task.title.toLowerCase().includes(activeFilterTitle.toLowerCase())) {
          return false;
        }
        return true;
      });

      // Sub-group by assigneeName
      const personMap = new Map<string, GanttTask[]>();
      for (const task of filteredTasks) {
        const name = task.assigneeName || '未分配';
        const existing = personMap.get(name);
        if (existing) {
          existing.push(task);
        } else {
          personMap.set(name, [task]);
        }
      }

      const personSubGroups: PersonSubGroup[] = Array.from(personMap.entries()).map(([personName, tasks]) => {
        const bars = tasks.reduce<{ task: GanttTask; leftPct: number; widthPct: number }[]>((acc, task) => {
          const dueMs = new Date(task.dueAt).getTime();
          if (!dueMs || isNaN(dueMs)) return acc;

          // If startAt is missing, use dueAt - 7 days as a 1-week default bar
          const rawStartAt = task.startAt || undefined;
          const startMs = rawStartAt ? new Date(rawStartAt).getTime() : dueMs - 7 * 24 * 60 * 60 * 1000;
          if (isNaN(startMs)) return acc;

          const start = toStartOfDay(new Date(startMs));
          const due = toStartOfDay(new Date(dueMs));

          let leftPct = (daysBetween(minDate, start) / totalDays) * 100;
          let widthPct = (daysBetween(start, due) / totalDays) * 100;

          // Protect against NaN
          if (isNaN(leftPct) || isNaN(widthPct)) return acc;

          // Clamp to visible area
          if (leftPct < 0) {
            widthPct = widthPct + leftPct;
            leftPct = 0;
          }
          if (leftPct + widthPct > 100) {
            widthPct = 100 - leftPct;
          }

          // Minimum width
          if (widthPct < 2) widthPct = 2;

          acc.push({ task, leftPct, widthPct });
          return acc;
        }, []);

        return {
          personName,
          personKey: `${group.leaderId}-${personName}`,
          bars,
        };
      });

      return { leaderId: group.leaderId, leaderName: group.leaderName, personSubGroups };
    });

    // Filter out leader groups with no person sub-groups
    const nonEmptyGroups = groups.filter((g) => g.personSubGroups.length > 0);

    const markerPositions = markers.map((m) => ({
      label: m.label,
      leftPct: (daysBetween(minDate, m.date) / totalDays) * 100,
    }));

    return { groups: nonEmptyGroups, markerPositions, showToday, todayPct };
  }, [data, filterPersons, filterTaskTitle]);

  const togglePerson = (personKey: string) => {
    setExpandedPersons((prev) => {
      const next = new Set(prev);
      if (next.has(personKey)) {
        next.delete(personKey);
      } else {
        next.add(personKey);
      }
      return next;
    });
  };

  const groups = computed?.groups ?? [];
  const markerPositions = computed?.markerPositions ?? [];
  const showToday = computed?.showToday ?? false;
  const todayPct = computed?.todayPct ?? 0;
  const LEADER_COL_WIDTH = 150;

  const allPersonKeys = useMemo(() => {
    const keys: string[] = [];
    for (const group of groups) {
      for (const pg of group.personSubGroups) {
        keys.push(pg.personKey);
      }
    }
    return keys;
  }, [groups]);

  const allExpanded = allPersonKeys.length > 0 && allPersonKeys.every(k => expandedPersons.has(k));

  const totalTasks = useMemo(() => {
    let count = 0;
    for (const group of groups) {
      for (const pg of group.personSubGroups) {
        count += pg.bars.length;
      }
    }
    return count;
  }, [groups]);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[var(--text-muted)]">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[var(--accent-red)]">加载失败: {error.message}</p>
      </div>
    );
  }

  if (!computed || !data?.groups?.length) {
    return (
      <p className="py-12 text-center text-[var(--text-muted)]">暂无甘特图数据</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
      {/* Chart header with task count and expand/collapse toggle */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <p className="text-sm text-[var(--text-muted)]">{totalTasks} 项任务</p>
        <button
          onClick={() => {
            if (allExpanded) {
              setExpandedPersons(new Set());
            } else {
              setExpandedPersons(new Set(allPersonKeys));
            }
          }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {allExpanded ? '全部收起' : '全部展开'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 800 }}>
          {/* Timeline header */}
          <div className="flex border-b border-[var(--border)]">
            <div
              className="shrink-0 bg-[var(--bg-surface)] px-4 py-3 text-xs font-medium text-[var(--text-muted)]"
              style={{ width: LEADER_COL_WIDTH }}
            >
              Leader / 人员
            </div>
            <div className="relative flex-1 bg-[var(--bg-surface)] py-3">
              {markerPositions.map((m, i) => (
                <span
                  key={`${m.label}-${i}`}
                  className="absolute top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] font-medium"
                  style={{ left: `${m.leftPct}%` }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {/* Swim lanes */}
          {groups.map((group) => (
            <div
              key={group.leaderId}
              className="border-b border-[var(--border)] last:border-b-0"
            >
              {/* Leader header row */}
              <div className="flex bg-[var(--bg-page)] border-b border-[var(--border)]">
                <div
                  className="shrink-0 px-4 py-3 text-sm font-semibold text-[var(--text-primary)]"
                  style={{ width: LEADER_COL_WIDTH }}
                >
                  {group.leaderName}
                </div>
                <div className="relative flex-1 py-3">
                  {/* Grid lines in header */}
                  {markerPositions.map((m, i) => (
                    <div
                      key={`leader-grid-${m.label}-${i}`}
                      className="absolute top-0 bottom-0 w-px bg-[var(--border-strong)]"
                      style={{ left: `${m.leftPct}%` }}
                    />
                  ))}
                </div>
              </div>

              {/* Person sub-groups within this leader */}
              {group.personSubGroups.map((personGroup) => {
                const expanded = expandedPersons.has(personGroup.personKey);
                const taskCount = personGroup.bars.length;

                return (
                  <div key={personGroup.personKey}>
                    {/* Person row (collapsible header) */}
                    <div className="flex">
                      <div
                        className="shrink-0 px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors duration-150"
                        style={{ width: LEADER_COL_WIDTH }}
                        onClick={() => togglePerson(personGroup.personKey)}
                      >
                        <span className="text-[var(--text-muted)] text-xs">{expanded ? '▼' : '▶'}</span>
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{personGroup.personName}</span>
                        <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">({taskCount})</span>
                      </div>
                      <div className="relative flex-1 py-2">
                        {/* Grid lines */}
                        {markerPositions.map((m, i) => (
                          <div
                            key={`person-grid-${m.label}-${i}`}
                            className="absolute top-0 bottom-0 w-px bg-[var(--border-strong)]"
                            style={{ left: `${m.leftPct}%` }}
                          />
                        ))}
                        {/* Today line */}
                        {showToday && (
                          <div
                            className="absolute top-0 bottom-0 w-px border-l border-dashed border-[var(--accent-red)] z-10"
                            style={{ left: `${todayPct}%` }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Expanded task bars */}
                    {expanded && (
                      <div className="border-t border-[var(--border)]/50">
                        {personGroup.bars.map((bar) => (
                          <div key={bar.task.taskUid} className="flex">
                            <div
                              className="shrink-0"
                              style={{ width: LEADER_COL_WIDTH }}
                            />
                            <div className="relative flex-1 py-0.5">
                              {/* Grid lines */}
                              {markerPositions.map((m, i) => (
                                <div
                                  key={`bar-grid-${m.label}-${i}`}
                                  className="absolute top-0 bottom-0 w-px bg-[var(--border-strong)]"
                                  style={{ left: `${m.leftPct}%` }}
                                />
                              ))}
                              {/* Today line */}
                              {showToday && (
                                <div
                                  className="absolute top-0 bottom-0 w-px border-l border-dashed border-[var(--accent-red)] z-10"
                                  style={{ left: `${todayPct}%` }}
                                />
                              )}
                              <TaskBar
                                task={bar.task}
                                leftPct={bar.leftPct}
                                widthPct={bar.widthPct}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Empty state if leader has no person sub-groups after filtering */}
              {group.personSubGroups.length === 0 && (
                <div className="flex items-center h-8 px-4">
                  <span className="text-[10px] text-[var(--text-muted)]">无任务</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
