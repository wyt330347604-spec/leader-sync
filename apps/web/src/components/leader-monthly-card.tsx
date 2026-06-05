'use client';
import { useState } from 'react';
import type { LeaderMonthlySummary, LeaderMemberSummary } from '@/hooks/use-leader-monthly';

function rateColor(rate: number): string {
  if (rate >= 80) return 'var(--accent-green)';
  if (rate >= 50) return 'var(--accent-blue)';
  return 'var(--accent-red)';
}

interface LeaderMemberRowProps {
  readonly member: LeaderMemberSummary;
  readonly onDrillDown: (userId: string, name: string) => void;
}

function LeaderMemberRow({ member, onDrillDown }: LeaderMemberRowProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-[var(--bg-surface)] px-4 py-2.5">
      <span className="w-20 shrink-0 truncate text-sm font-medium text-[var(--text-primary)]">
        {member.name}
      </span>
      <div className="flex flex-1 items-center gap-3 text-xs tabular-nums">
        <span className="text-[var(--text-secondary)]">总 {member.total}</span>
        <span className="text-[var(--accent-green)]">完 {member.done}</span>
        <span className={member.overdue > 0 ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}>
          延 {member.overdue}
        </span>
      </div>
      <div className="flex items-center gap-2 w-28 shrink-0">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(member.completionRate, 100)}%`,
              backgroundColor: rateColor(member.completionRate),
            }}
          />
        </div>
        <span className="w-8 text-right tabular-nums text-xs font-medium text-[var(--text-primary)]">
          {member.completionRate}%
        </span>
      </div>
      <button
        onClick={() => onDrillDown(member.userId, member.name)}
        className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--accent-blue)] transition-colors hover:bg-[var(--bg-hover)]"
      >
        查看
      </button>
    </div>
  );
}

interface LeaderMonthlyCardProps {
  readonly data: LeaderMonthlySummary;
  readonly onDrillDown: (userId: string, name: string) => void;
}

export function LeaderMonthlyCard({ data, onDrillDown }: LeaderMonthlyCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">我的团队 · 月度</h3>
        <span className="text-sm text-[var(--text-muted)]">{data.leaderName}</span>
      </div>

      {/* Team summary stats */}
      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-blue)]" />
          <span className="tabular-nums text-[var(--text-primary)]">{data.total}</span>
          <span className="text-[var(--text-muted)]">总任务</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-green)]" />
          <span className="tabular-nums text-[var(--text-primary)]">{data.done}</span>
          <span className="text-[var(--text-muted)]">完成</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-red)]" />
          <span className="tabular-nums text-[var(--text-primary)]">{data.overdue}</span>
          <span className="text-[var(--text-muted)]">逾期</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums font-bold text-[var(--text-primary)]">{data.completionRate}%</span>
          <span className="text-[var(--text-muted)]">完成率</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-surface)]">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(data.completionRate, 100)}%`,
              backgroundColor: rateColor(data.completionRate),
            }}
          />
        </div>
      </div>

      {/* Members toggle */}
      {data.members.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mb-3 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {expanded ? '收起成员' : `展开成员 (${data.members.length})`}
          </button>
          {expanded && (
            <div className="space-y-2">
              {[...data.members]
                .sort((a, b) => a.completionRate - b.completionRate)
                .map((m) => (
                  <LeaderMemberRow key={m.userId} member={m} onDrillDown={onDrillDown} />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
