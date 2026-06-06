'use client';
import { useMemo } from 'react';
import { monthTicks, pos, ms, rangeOf } from '@/lib/gantt-scale';
import { RequirementStatusLabel } from '@leader-sync/shared-types';
import type { GanttRequirement } from '@/hooks/use-requirements';

function statusColor(status: string): string {
  if (status === 'released' || status === 'retro' || status === 'closed') return 'var(--accent-green)';
  if (status === 'rejected') return 'var(--text-muted)';
  if (status === 'developing' || status === 'testing') return 'var(--accent-blue)';
  if (status === 'collected' || status === 'analyzing') return 'var(--accent-orange)';
  return 'var(--accent-blue)';
}

interface Props {
  requirements: readonly GanttRequirement[];
  /** uid → 名称（业务线分组标题）。 */
  projectNames?: Map<string, string>;
  onSelect?: (uid: string) => void;
}

/** 需求维度甘特：按业务线分组，每条需求一根 bar，P0/期望上线日做里程碑标记。 */
export function RequirementGantt({ requirements, projectNames, onSelect }: Props) {
  const range = useMemo(
    () => rangeOf(requirements.map((r) => ({ start: ms(r.start), end: ms(r.end) }))),
    [requirements],
  );
  const groups = useMemo(() => {
    const m = new Map<string, GanttRequirement[]>();
    for (const r of requirements) {
      const arr = m.get(r.businessLineUid) ?? [];
      arr.push(r);
      m.set(r.businessLineUid, arr);
    }
    return Array.from(m.entries());
  }, [requirements]);

  if (!range) return <div className="flex min-h-[20vh] items-center justify-center text-[var(--text-muted)]">暂无需求排期数据</div>;
  const ticks = monthTicks(range.min, range.max);

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex border-b border-[var(--border)] bg-[var(--bg-surface)]/50">
        <div className="w-[260px] shrink-0 px-3 py-2 text-xs font-medium text-[var(--text-muted)]">业务线 / 需求</div>
        <div className="relative h-8 flex-1">
          {ticks.map((tk, i) => (
            <div key={i} className="absolute top-0 h-full border-l border-[var(--border)]/50 pl-1 text-[10px] text-[var(--text-muted)]" style={{ left: `${tk.left}%` }}>{tk.label}</div>
          ))}
        </div>
      </div>

      <div>
        {groups.map(([lineUid, reqs]) => (
          <div key={lineUid}>
            <div className="flex items-center border-b border-[var(--border)]/50 bg-[var(--bg-surface)]/30">
              <div className="w-[260px] shrink-0 px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)]">
                {projectNames?.get(lineUid) ?? lineUid} <span className="text-[var(--text-muted)]">({reqs.length})</span>
              </div>
              <div className="h-7 flex-1" />
            </div>
            {reqs.map((r) => {
              const bar = pos(ms(r.start), ms(r.end), range.min, range.max);
              return (
                <button
                  key={r.requirementUid}
                  onClick={() => onSelect?.(r.requirementUid)}
                  className="flex w-full items-center border-b border-[var(--border)]/40 text-left hover:bg-[var(--bg-hover)]/40"
                >
                  <div className="flex w-[260px] shrink-0 items-center gap-1.5 py-2 pl-6 pr-2">
                    {r.priority === 'P0' && <span className="rounded bg-[var(--accent-red)]/15 px-1 text-[9px] font-bold text-[var(--accent-red)]">P0</span>}
                    <span className="truncate text-xs text-[var(--text-secondary)]">{r.title}</span>
                  </div>
                  <div className="relative h-9 flex-1">
                    {bar && (
                      <div
                        className="absolute top-1/2 flex h-4 -translate-y-1/2 items-center overflow-hidden rounded"
                        style={{ left: `${bar.left}%`, width: `${bar.width}%`, backgroundColor: statusColor(r.status) }}
                        title={`${RequirementStatusLabel[r.status]} · ${r.start ? new Date(r.start).toLocaleDateString('zh-CN') : '—'} → ${r.end ? new Date(r.end).toLocaleDateString('zh-CN') : '—'}`}
                      />
                    )}
                    {/* 期望上线里程碑 ◆ */}
                    {r.hasExplicitDeadline && r.end && (() => {
                      const span = range.max - range.min || 1;
                      const left = Math.max(0, Math.min(99, ((ms(r.end)! - range.min) / span) * 100));
                      return <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px]" style={{ left: `${left}%`, color: 'var(--accent-red)' }}>◆</span>;
                    })()}
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
