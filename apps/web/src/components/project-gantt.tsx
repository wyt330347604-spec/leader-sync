'use client';
import { useMemo, useState } from 'react';
import type { PortfolioNode, PortfolioTask, ProjectHealth } from '@/hooks/use-project-portfolio';

const HEALTH_COLOR: Record<ProjectHealth, string> = {
  on_track: 'var(--accent-green)',
  at_risk: 'var(--accent-orange)',
  overdue: 'var(--accent-red)',
};

function taskColor(t: PortfolioTask): string {
  if (t.status === 'done') return 'var(--accent-green)';
  if (t.overdue) return 'var(--accent-red)';
  if (t.status === 'stalled' || t.status === 'shelved') return 'var(--text-muted)';
  return 'var(--accent-blue)';
}

const DAY = 24 * 60 * 60 * 1000;
const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : null);

/** 收集所有节点/任务的时间端点，求全局范围。 */
function globalRange(nodes: readonly PortfolioNode[]): { min: number; max: number } | null {
  let min: number | null = null, max: number | null = null;
  const acc = (a: number | null, b: number | null) => {
    if (a !== null) { min = min === null ? a : Math.min(min, a); }
    if (b !== null) { max = max === null ? b : Math.max(max, b); }
  };
  const visit = (n: PortfolioNode) => {
    acc(ms(n.spanStart), ms(n.spanEnd));
    (n.tasks ?? []).forEach((t) => acc(ms(t.startAt) ?? (ms(t.dueAt) ? ms(t.dueAt)! - 7 * DAY : null), ms(t.dueAt)));
    (n.subProjects ?? []).forEach(visit);
  };
  nodes.forEach(visit);
  if (min === null || max === null || max <= min) return min !== null ? { min, max: min + 30 * DAY } : null;
  return { min, max };
}

/** 月度刻度。 */
function monthTicks(min: number, max: number): { left: number; label: string }[] {
  const ticks: { left: number; label: string }[] = [];
  const span = max - min;
  const d = new Date(min);
  d.setDate(1);
  if (d.getTime() < min) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= max) {
    ticks.push({ left: ((d.getTime() - min) / span) * 100, label: `${d.getMonth() + 1}月` });
    d.setMonth(d.getMonth() + 1);
  }
  return ticks;
}

function pos(start: number | null, end: number | null, min: number, max: number): { left: number; width: number } | null {
  if (start === null && end === null) return null;
  const span = max - min;
  const s = start ?? (end as number) - 7 * DAY;
  const e = end ?? (start as number) + 7 * DAY;
  const left = Math.max(0, ((s - min) / span) * 100);
  const width = Math.max(1.5, Math.min(100 - left, ((e - s) / span) * 100));
  return { left, width };
}

interface RowProps {
  label: string;
  depth: number;
  color: string;
  progress?: number;
  bar: { left: number; width: number } | null;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  meta?: string;
}

function Row({ label, depth, color, progress, bar, expandable, expanded, onToggle, meta }: RowProps) {
  return (
    <div className="flex items-center border-b border-[var(--border)]/50 hover:bg-[var(--bg-hover)]/40">
      {/* 左侧标签列 */}
      <button
        type="button"
        onClick={onToggle}
        disabled={!expandable}
        className={`flex h-9 w-[260px] shrink-0 items-center gap-1 pr-2 text-left ${expandable ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {expandable ? (
          <span className="w-3 shrink-0 text-[10px] text-[var(--text-muted)]">{expanded ? '▾' : '▸'}</span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span
          className={`truncate ${depth === 0 ? 'text-sm font-semibold text-[var(--text-primary)]' : 'text-xs text-[var(--text-secondary)]'}`}
        >
          {label}
        </span>
      </button>
      {/* 时间轴泳道 */}
      <div className="relative h-9 flex-1">
        {bar && (
          <div
            className="absolute top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded"
            style={{ left: `${bar.left}%`, width: `${bar.width}%`, backgroundColor: color }}
            title={meta}
          >
            {typeof progress === 'number' && (
              <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${progress}%` }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectGantt({ nodes }: { nodes: readonly PortfolioNode[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const range = useMemo(() => globalRange(nodes), [nodes]);
  const toggle = (uid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });

  if (!range) return <div className="flex min-h-[20vh] items-center justify-center text-[var(--text-muted)]">暂无排期数据</div>;
  const ticks = monthTicks(range.min, range.max);

  const order: Record<ProjectHealth, number> = { overdue: 0, at_risk: 1, on_track: 2 };
  const sorted = [...nodes].sort((a, b) => order[a.health] - order[b.health]);

  const taskRows = (tasks: readonly PortfolioTask[] | undefined, depth: number) =>
    (tasks ?? []).map((t) => {
      const start = ms(t.startAt) ?? (ms(t.dueAt) ? ms(t.dueAt)! - 7 * DAY : null);
      return (
        <Row
          key={t.taskUid}
          label={t.title}
          depth={depth}
          color={taskColor(t)}
          progress={t.progressPercent}
          bar={pos(start, ms(t.dueAt), range.min, range.max)}
          meta={`${t.startAt ? new Date(t.startAt).toLocaleDateString('zh-CN') : '—'} → ${t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '—'} · ${t.progressPercent}%`}
        />
      );
    });

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      {/* 时间轴表头 */}
      <div className="flex border-b border-[var(--border)] bg-[var(--bg-surface)]/50">
        <div className="w-[260px] shrink-0 px-3 py-2 text-xs font-medium text-[var(--text-muted)]">项目 / 子项目 / 任务</div>
        <div className="relative h-8 flex-1">
          {ticks.map((tk, i) => (
            <div key={i} className="absolute top-0 h-full border-l border-[var(--border)]/50 pl-1 text-[10px] text-[var(--text-muted)]" style={{ left: `${tk.left}%` }}>
              {tk.label}
            </div>
          ))}
        </div>
      </div>
      {/* 行 */}
      <div>
        {sorted.map((p) => {
          const pOpen = expanded.has(p.projectUid);
          const subs = p.subProjects ?? [];
          const hasChildren = subs.length > 0 || (p.tasks?.length ?? 0) > 0;
          return (
            <div key={p.projectUid}>
              <Row
                label={p.name}
                depth={0}
                color={HEALTH_COLOR[p.health]}
                progress={p.progress}
                bar={null}
                expandable={hasChildren}
                expanded={pOpen}
                onToggle={() => hasChildren && toggle(p.projectUid)}
                meta={`完成 ${p.progress}% · ${p.counts.done}/${p.counts.total}${p.counts.overdue ? ` · ${p.counts.overdue} 逾期` : ''}`}
              />
              {pOpen && (
                <>
                  {taskRows(p.tasks, 1)}
                  {subs.map((s) => {
                    const sOpen = expanded.has(s.projectUid);
                    const sHasTasks = (s.tasks?.length ?? 0) > 0;
                    return (
                      <div key={s.projectUid}>
                        <Row
                          label={s.name}
                          depth={1}
                          color={HEALTH_COLOR[s.health]}
                          progress={s.progress}
                          bar={pos(ms(s.spanStart), ms(s.spanEnd), range.min, range.max)}
                          expandable={sHasTasks}
                          expanded={sOpen}
                          onToggle={() => sHasTasks && toggle(s.projectUid)}
                          meta={`完成 ${s.progress}% · ${s.counts.done}/${s.counts.total}${s.counts.overdue ? ` · ${s.counts.overdue} 逾期` : ''}`}
                        />
                        {sOpen && taskRows(s.tasks, 2)}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
