'use client';
import { useState, useEffect, Suspense } from 'react';
import { useDashboard } from '@/hooks/use-dashboard';
import { ensureAuth } from '@/lib/auth';
import { StatusBadge } from '@/components/status-badge';
import { PriorityBadge } from '@/components/priority-badge';

function formatMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function buildMonthOptions(): readonly { label: string; value: string }[] {
  const now = new Date();
  const options: { label: string; value: string }[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = formatMonth(d);
    options.push({ label: `${d.getFullYear()}年${d.getMonth() + 1}月`, value });
  }
  return options;
}

/* ---------- Section A: Month selector ---------- */

function MonthSelector({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
}) {
  const options = buildMonthOptions();
  return (
    <div className="mb-6 flex items-center gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            value === o.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Section B: Monthly stats bar ---------- */

interface MonthlyStats {
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carry_over: number;
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function StatsBar({ stats }: { readonly stats: MonthlyStats }) {
  const cards = [
    { label: '总任务', count: stats.total, bg: 'bg-blue-50 text-blue-700', extra: '' },
    { label: '已完成', count: stats.done, bg: 'bg-green-50 text-green-700', extra: pct(stats.done, stats.total) },
    { label: '已延期', count: stats.overdue, bg: 'bg-red-50 text-red-700', extra: pct(stats.overdue, stats.total) },
    { label: '继承任务', count: stats.carry_over, bg: 'bg-orange-50 text-orange-700', extra: pct(stats.carry_over, stats.total) },
  ] as const;

  return (
    <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl p-4 ${c.bg}`}>
          <p className="text-sm font-medium opacity-80">{c.label}</p>
          <p className="mt-1 text-2xl font-bold">
            {c.count}
            {c.extra && <span className="ml-2 text-sm font-normal opacity-70">{c.extra}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ---------- Section C: Leader summary cards ---------- */

interface LeaderSummary {
  readonly leader_name: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carry_over: number;
  readonly completion_rate: number;
}

function LeaderCards({ leaders }: { readonly leaders: readonly LeaderSummary[] }) {
  if (leaders.length === 0) {
    return <p className="py-6 text-center text-gray-400">暂无负责人数据</p>;
  }

  return (
    <div className="mb-8">
      <h3 className="mb-4 text-lg font-semibold">负责人概览</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {leaders.map((l) => (
          <div key={l.leader_name} className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-base font-semibold">{l.leader_name}</p>
            <div className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-gray-500">总任务</span>
              <span className="text-right font-medium">{l.total}</span>
              <span className="text-gray-500">已完成</span>
              <span className="text-right font-medium text-green-600">{l.done}</span>
              <span className="text-gray-500">已延期</span>
              <span className={`text-right font-medium ${l.overdue > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {l.overdue}
              </span>
              <span className="text-gray-500">继承任务</span>
              <span className="text-right font-medium text-orange-600">{l.carry_over}</span>
              <span className="text-gray-500">完成率</span>
              <span className="text-right font-medium">{Math.round(l.completion_rate * 100)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Section D: Risk tasks table ---------- */

interface RiskTask {
  readonly title: string;
  readonly assignee_name: string;
  readonly status: string;
  readonly priority: string;
  readonly due_at: string | null;
  readonly overdue_days: number;
  readonly carry_over_count: number;
}

function riskIndicator(task: RiskTask): string {
  const indicators: string[] = [];
  if (task.overdue_days > 0) indicators.push('\uD83D\uDEA8');
  if (task.carry_over_count >= 2) indicators.push('\uD83D\uDD04');
  return indicators.join(' ');
}

function RiskTable({ tasks }: { readonly tasks: readonly RiskTask[] }) {
  if (tasks.length === 0) {
    return <p className="py-6 text-center text-gray-400">暂无风险任务</p>;
  }

  return (
    <div>
      <h3 className="mb-4 text-lg font-semibold">风险任务</h3>
      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">标题</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">负责人</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">优先级</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">截止时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">延期天数</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">继承次数</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tasks.map((t, idx) => (
                <tr key={`${t.title}-${idx}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    {riskIndicator(t) && <span className="mr-1">{riskIndicator(t)}</span>}
                    {t.title}
                  </td>
                  <td className="px-4 py-3">{t.assignee_name || '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {t.due_at ? new Date(t.due_at).toLocaleDateString('zh-CN') : '-'}
                  </td>
                  <td className={`px-4 py-3 ${t.overdue_days > 0 ? 'font-semibold text-red-600' : ''}`}>
                    {t.overdue_days > 0 ? `${t.overdue_days}天` : '-'}
                  </td>
                  <td className={`px-4 py-3 ${t.carry_over_count >= 2 ? 'font-semibold text-orange-600' : ''}`}>
                    {t.carry_over_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main dashboard content ---------- */

function DashboardContent() {
  const [authed, setAuthed] = useState(false);
  const [month, setMonth] = useState(() => formatMonth(new Date()));

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading } = useDashboard(month);

  if (!authed) {
    return <div className="py-12 text-center text-gray-500">正在验证登录状态...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="mb-4 text-xl font-semibold">驾驶舱</h2>
        <MonthSelector value={month} onChange={setMonth} />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">加载中...</div>
      ) : error ? (
        <div className="py-12 text-center text-red-500">加载失败: {error.message}</div>
      ) : data ? (
        <>
          <StatsBar
            stats={{
              total: data.total ?? 0,
              done: data.done ?? 0,
              overdue: data.overdue ?? 0,
              carry_over: data.carry_over ?? 0,
            }}
          />
          <LeaderCards leaders={data.leaders ?? []} />
          <RiskTable tasks={data.risk_tasks ?? []} />
        </>
      ) : null}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-gray-500">加载中...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
