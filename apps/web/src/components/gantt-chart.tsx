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
  if (isOverdue) return 'bg-[#ef4444]';
  switch (status) {
    case 'done':
      return 'bg-[#22c55e]';
    case 'in_progress':
      return 'bg-[#3b82f6]';
    case 'stalled':
      return 'bg-[#ef4444]';
    case 'pending':
    case 'not_started':
      return 'bg-[#5a5a6e]';
    default:
      return 'bg-[#5a5a6e]';
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
    <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 text-xs text-[#e4e4e7] shadow-xl pointer-events-none">
      <p className="font-medium">{task.title}</p>
      <p className="mt-1 text-[#8b8b9e]">
        {task.assigneeName} &middot; {getStatusLabel(task.status)}
      </p>
      <p className="text-[#8b8b9e]">
        {startStr} - {dueStr}
      </p>
      <p className="text-[#8b8b9e]">
        进度: {task.progressPercent}%
        {task.isOverdue ? ' (已延期)' : ''}
      </p>
      {task.bossAttentionFlag && (
        <p className="text-[#f59e0b]">重点任务</p>
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
            <span className="shrink-0 text-[10px] text-[#f59e0b]" title="重点任务">
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

    const minDate = toStartOfDay(new Date(data.timeRange.min));
    const maxDate = toStartOfDay(new Date(data.timeRange.max));
    const totalDays = daysBetween(minDate, maxDate);

    if (totalDays <= 0) return null;

    const markers = buildMarkers(minDate, maxDate);

    const today = toStartOfDay(new Date());
    const todayPct = daysBetween(minDate, today) / totalDays * 100;
    const showToday = todayPct >= 0 && todayPct <= 100;

    const activeFilterPersons = filterPersons ?? [];
    const activeFilterTitle = filterTaskTitle ?? '';

    const groups: ComputedLeaderGroup[] = data.groups.map((group) => {
      // Filter tasks first
      const filteredTasks = group.tasks.filter((task) => {
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
        const bars = tasks.map((task) => {
          const start = toStartOfDay(new Date(task.startAt));
          const due = toStartOfDay(new Date(task.dueAt));

          let leftPct = (daysBetween(minDate, start) / totalDays) * 100;
          let widthPct = (daysBetween(start, due) / totalDays) * 100;

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

          return { task, leftPct, widthPct };
        });

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

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[#5a5a6e]">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[#ef4444]">加载失败: {error.message}</p>
      </div>
    );
  }

  if (!computed || !data?.groups?.length) {
    return (
      <p className="py-12 text-center text-[#5a5a6e]">暂无甘特图数据</p>
    );
  }

  const { groups, markerPositions, showToday, todayPct } = computed;
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

  return (
    <div className="overflow-hidden rounded-2xl bg-[#12121a] border border-[#2a2a3a]">
      {/* Chart header with task count and expand/collapse toggle */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a3a]">
        <p className="text-sm text-[#5a5a6e]">{totalTasks} 项任务</p>
        <button
          onClick={() => {
            if (allExpanded) {
              setExpandedPersons(new Set());
            } else {
              setExpandedPersons(new Set(allPersonKeys));
            }
          }}
          className="text-xs text-[#5a5a6e] hover:text-[#e4e4e7] transition-colors"
        >
          {allExpanded ? '全部收起' : '全部展开'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 800 }}>
          {/* Timeline header */}
          <div className="flex border-b border-[#2a2a3a]">
            <div
              className="shrink-0 bg-[#1e1e2e] px-4 py-3 text-xs font-medium text-[#5a5a6e]"
              style={{ width: LEADER_COL_WIDTH }}
            >
              Leader / 人员
            </div>
            <div className="relative flex-1 bg-[#1e1e2e] py-3">
              {markerPositions.map((m, i) => (
                <span
                  key={`${m.label}-${i}`}
                  className="absolute top-1/2 -translate-y-1/2 text-[10px] text-[#5a5a6e] font-medium"
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
              className="border-b border-[#2a2a3a] last:border-b-0"
            >
              {/* Leader header row */}
              <div className="flex bg-[#0a0a0f] border-b border-[#2a2a3a]">
                <div
                  className="shrink-0 px-4 py-3 text-sm font-semibold text-[#e4e4e7]"
                  style={{ width: LEADER_COL_WIDTH }}
                >
                  {group.leaderName}
                </div>
                <div className="relative flex-1 py-3">
                  {/* Grid lines in header */}
                  {markerPositions.map((m, i) => (
                    <div
                      key={`leader-grid-${m.label}-${i}`}
                      className="absolute top-0 bottom-0 w-px bg-[#1e1e2e]"
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
                        className="shrink-0 px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-[#1a1a2e] transition-colors duration-150"
                        style={{ width: LEADER_COL_WIDTH }}
                        onClick={() => togglePerson(personGroup.personKey)}
                      >
                        <span className="text-[#5a5a6e] text-xs">{expanded ? '▼' : '▶'}</span>
                        <span className="text-sm font-medium text-[#e4e4e7] truncate">{personGroup.personName}</span>
                        <span className="text-[10px] text-[#5a5a6e] whitespace-nowrap">({taskCount})</span>
                      </div>
                      <div className="relative flex-1 py-2">
                        {/* Grid lines */}
                        {markerPositions.map((m, i) => (
                          <div
                            key={`person-grid-${m.label}-${i}`}
                            className="absolute top-0 bottom-0 w-px bg-[#1e1e2e]"
                            style={{ left: `${m.leftPct}%` }}
                          />
                        ))}
                        {/* Today line */}
                        {showToday && (
                          <div
                            className="absolute top-0 bottom-0 w-px border-l border-dashed border-[#ef4444] z-10"
                            style={{ left: `${todayPct}%` }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Expanded task bars */}
                    {expanded && (
                      <div className="border-t border-[#2a2a3a]/50">
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
                                  className="absolute top-0 bottom-0 w-px bg-[#1e1e2e]"
                                  style={{ left: `${m.leftPct}%` }}
                                />
                              ))}
                              {/* Today line */}
                              {showToday && (
                                <div
                                  className="absolute top-0 bottom-0 w-px border-l border-dashed border-[#ef4444] z-10"
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
                  <span className="text-[10px] text-[#5a5a6e]">无任务</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
