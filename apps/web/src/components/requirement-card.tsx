'use client';
import { RequirementSourceLabel } from '@leader-sync/shared-types';
import type { Requirement } from '@/hooks/use-requirements';

const PRIORITY_STYLE: Record<string, string> = {
  P0: 'bg-[var(--accent-red)]/15 text-[var(--accent-red)] border-[var(--accent-red)]/30',
  P1: 'bg-[var(--accent-orange)]/15 text-[var(--accent-orange)] border-[var(--accent-orange)]/30',
  P2: 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border)]',
};

interface Props {
  requirement: Requirement;
  /** uid → 名称（业务线/app 显示）。 */
  projectNames?: Map<string, string>;
  onClick?: (uid: string) => void;
}

export function RequirementCard({ requirement: r, projectNames, onClick }: Props) {
  const lineName = projectNames?.get(r.businessLineUid) ?? r.businessLineUid;
  const appName = r.appProjectUid ? projectNames?.get(r.appProjectUid) ?? r.appProjectUid : null;
  return (
    <button
      onClick={() => onClick?.(r.requirementUid)}
      className="group w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2.5 text-left transition hover:border-[var(--accent-blue)]/50 hover:shadow-sm"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE.P2}`}>
          {r.priority}
        </span>
        <span className="truncate text-[10px] text-[var(--text-muted)]">{RequirementSourceLabel[r.source] ?? r.source}</span>
      </div>
      <div className="mb-2 line-clamp-2 text-sm font-medium leading-snug text-[var(--text-primary)]">{r.title}</div>
      <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
        <span className="truncate rounded bg-[var(--bg-surface)] px-1.5 py-0.5">{appName ?? lineName}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span className={r.pmName ? 'text-[var(--text-secondary)]' : 'italic text-[var(--accent-orange)]'}>
          {r.pmName ? `PM·${r.pmName}` : '待认领'}
        </span>
        {r.expectedReleaseDate && (
          <span className="text-[var(--text-muted)]">📅 {r.expectedReleaseDate}</span>
        )}
      </div>
    </button>
  );
}
