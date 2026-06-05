import type { MyMonthlySummary } from '@/hooks/use-my-monthly';

function StatItem({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className={`tabular-nums text-2xl font-bold ${highlight ? 'text-[var(--accent-red)]' : 'text-[var(--text-primary)]'}`}>
        {value}
      </span>
    </div>
  );
}

interface MyMonthlySummaryCardProps {
  readonly data: MyMonthlySummary;
}

export function MyMonthlySummaryCard({ data }: MyMonthlySummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">我的完成情况</h3>
        <span className="text-sm text-[var(--text-muted)]">{data.userName}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatItem label="总任务" value={data.total} />
        <StatItem label="已完成" value={data.done} />
        <StatItem label="进行中" value={data.inProgress} />
        <StatItem label="已逾期" value={data.overdue} highlight={data.overdue > 0} />
        <StatItem label="结转" value={data.carriedOver} />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="text-[var(--text-muted)]">完成率</span>
          <span className="tabular-nums font-bold text-[var(--text-primary)]">{data.completionRate}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-surface)]">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(data.completionRate, 100)}%`,
              backgroundColor: data.completionRate >= 80 ? 'var(--accent-green)' : data.completionRate >= 50 ? 'var(--accent-blue)' : 'var(--accent-red)',
            }}
          />
        </div>
      </div>

      {data.delayTotal > 0 && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          延期操作累计 {data.delayTotal} 次
        </p>
      )}
    </div>
  );
}
