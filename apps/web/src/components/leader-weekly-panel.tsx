import type { LeaderWeeklyData } from '@/hooks/use-leader-weekly';

interface LeaderWeeklyPanelProps {
  readonly data: LeaderWeeklyData;
}

export function LeaderWeeklyPanel({ data }: LeaderWeeklyPanelProps) {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">我的团队 · 本周</h3>
        <span className="text-sm text-[var(--text-muted)]">
          {fmt(data.weekStart)} – {fmt(data.weekEnd)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="pb-3 text-left text-xs font-medium text-[var(--text-muted)]">成员</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--text-muted)]">新增</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--text-muted)]">完成</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--text-muted)]">逾期</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--text-muted)]">完成率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {/* Team summary row */}
            <tr className="bg-[var(--bg-surface)]">
              <td className="py-2.5 pl-1 pr-4 text-xs font-semibold text-[var(--text-muted)]">
                团队合计
              </td>
              <td className="py-2.5 text-right tabular-nums text-xs text-[var(--text-secondary)]">
                {data.teamSummary.newCount}
              </td>
              <td className="py-2.5 text-right tabular-nums text-xs font-semibold text-[var(--accent-green)]">
                {data.teamSummary.doneCount}
              </td>
              <td className={`py-2.5 text-right tabular-nums text-xs ${data.teamSummary.overdueCount > 0 ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                {data.teamSummary.overdueCount}
              </td>
              <td className="py-2.5 text-right tabular-nums text-xs font-bold text-[var(--text-primary)]">
                {data.teamSummary.completionRate}%
              </td>
            </tr>
            {data.members.map((m) => (
              <tr key={m.userId} className="hover:bg-[var(--bg-hover)] transition-colors">
                <td className="py-2.5 pl-1 pr-4 font-medium text-[var(--text-primary)]">
                  {m.name}
                </td>
                <td className="py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                  {m.newCount}
                </td>
                <td className="py-2.5 text-right tabular-nums text-[var(--accent-green)]">
                  {m.doneCount}
                </td>
                <td className={`py-2.5 text-right tabular-nums ${m.overdueCount > 0 ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                  {m.overdueCount}
                </td>
                <td className="py-2.5 text-right tabular-nums font-medium text-[var(--text-primary)]">
                  {m.completionRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
