'use client';
import { useMemo } from 'react';
import { monthTicks, pos, ms, rangeOf, dayStamps, DAY } from '@/lib/gantt-scale';
import type { CapacityPerson, CapacityTask } from '@/hooks/use-requirements';

/** 任务有效区间：[startAt | dueAt-7d, dueAt | startAt+7d]。 */
function taskSpan(t: CapacityTask): { start: number; end: number } | null {
  const s = ms(t.startAt);
  const e = ms(t.dueAt);
  if (s === null && e === null) return null;
  return { start: s ?? (e as number) - 7 * DAY, end: e ?? (s as number) + 7 * DAY };
}

/** 某天负载 = 当天活跃任务投入度之和（%）。 */
function loadColor(load: number): string {
  if (load === 0) return 'transparent';
  if (load > 100) return 'var(--accent-red)';
  if (load >= 80) return 'var(--accent-orange)';
  return 'var(--accent-green)';
}

interface Props {
  people: readonly CapacityPerson[];
  onSelectTask?: (requirementUid: string | null) => void;
}

/** 人力容量甘特：一人多任务并行，每日负载=Σ投入度，>100% 过载标红（MS Project / Float 口径）。 */
export function CapacityGantt({ people, onSelectTask }: Props) {
  const range = useMemo(() => {
    const spans = people.flatMap((p) => p.tasks.map(taskSpan).filter(Boolean) as { start: number; end: number }[]);
    return rangeOf(spans.map((s) => ({ start: s.start, end: s.end })));
  }, [people]);

  const days = useMemo(() => (range ? dayStamps(range.min, range.max) : []), [range]);

  const perPerson = useMemo(() => {
    return people.map((p) => {
      const spans = p.tasks.map((t) => ({ t, span: taskSpan(t) }));
      const loads = days.map((d) => {
        let load = 0;
        for (const { t, span } of spans) {
          if (span && d >= startOfDay(span.start) && d <= span.end) load += t.allocationPct ?? 0;
        }
        return load;
      });
      const peak = loads.length ? Math.max(...loads) : 0;
      return { person: p, loads, peak };
    });
  }, [people, days]);

  if (!range) return <div className="flex min-h-[20vh] items-center justify-center text-[var(--text-muted)]">暂无投入度数据（需求拆解任务时填写投入度后显示）</div>;
  const ticks = monthTicks(range.min, range.max);

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex border-b border-[var(--border)] bg-[var(--bg-surface)]/50">
        <div className="w-[200px] shrink-0 px-3 py-2 text-xs font-medium text-[var(--text-muted)]">负责人 / 任务</div>
        <div className="relative h-8 flex-1">
          {ticks.map((tk, i) => (
            <div key={i} className="absolute top-0 h-full border-l border-[var(--border)]/50 pl-1 text-[10px] text-[var(--text-muted)]" style={{ left: `${tk.left}%` }}>{tk.label}</div>
          ))}
        </div>
      </div>

      <div>
        {perPerson.map(({ person, loads, peak }) => (
          <div key={person.userId} className="border-b border-[var(--border)]/60">
            {/* 负责人 + 每日负载热条 */}
            <div className="flex items-center bg-[var(--bg-surface)]/20">
              <div className="flex w-[200px] shrink-0 items-center gap-2 px-3 py-1.5">
                <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{person.userName}</span>
                <span className={`rounded px-1.5 text-[10px] font-bold ${peak > 100 ? 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}>
                  峰值 {peak}%{peak > 100 ? ' 过载' : ''}
                </span>
              </div>
              <div className="relative flex h-6 flex-1">
                {loads.map((load, i) => (
                  <div
                    key={i}
                    className="flex-1"
                    style={{ backgroundColor: loadColor(load), opacity: load > 100 ? 0.9 : 0.55 }}
                    title={`${new Date(days[i]).toLocaleDateString('zh-CN')} · 负载 ${load}%`}
                  />
                ))}
              </div>
            </div>
            {/* 任务 bars */}
            {person.tasks.map((t) => {
              const span = taskSpan(t);
              const bar = span ? pos(span.start, span.end, range.min, range.max) : null;
              return (
                <button
                  key={t.taskUid}
                  onClick={() => onSelectTask?.(t.requirementUid)}
                  className="flex w-full items-center text-left hover:bg-[var(--bg-hover)]/30"
                >
                  <div className="w-[200px] shrink-0 truncate py-1.5 pl-6 pr-2 text-[11px] text-[var(--text-secondary)]">{t.title}</div>
                  <div className="relative h-7 flex-1">
                    {bar && (
                      <div
                        className="absolute top-1/2 flex h-3.5 -translate-y-1/2 items-center justify-end overflow-hidden rounded bg-[var(--accent-blue)] pr-1"
                        style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                        title={`投入度 ${t.allocationPct ?? 0}% · 工时 ${t.estEffortDays ?? '—'} 人天`}
                      >
                        <span className="text-[9px] font-medium text-white">{t.allocationPct ?? 0}%</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
