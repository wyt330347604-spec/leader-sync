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

function getMonthLabel(month: string): string {
  const parts = month.split('-');
  if (parts.length === 2) {
    return `${parseInt(parts[1], 10)}月`;
  }
  return month;
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
    <div className="flex items-center gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
            value === o.value
              ? 'bg-[#0071e3] text-white shadow-[0_2px_12px_rgba(0,113,227,0.3)]'
              : 'bg-white text-[#6e6e73] shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Section B: Hero stats ---------- */

interface MonthlyStats {
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function HeroStats({ stats, month }: { readonly stats: MonthlyStats; readonly month: string }) {
  const cards = [
    { label: '总任务', count: stats.total, extra: '' },
    { label: '已完成', count: stats.done, extra: pct(stats.done, stats.total) },
    { label: '已延期', count: stats.overdue, extra: pct(stats.overdue, stats.total) },
    { label: '继承', count: stats.carryOver, extra: pct(stats.carryOver, stats.total) },
  ] as const;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#000000] to-[#1d1d1f] px-8 py-16 sm:px-12">
      <div className="relative z-10">
        <p className="mb-1 text-sm font-medium tracking-wide text-white/50">督办概览</p>
        <h2 className="mb-10 text-4xl font-bold tracking-tight text-white">
          {getMonthLabel(month)} 督办概览
        </h2>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="text-center">
              <p className="tabular-nums text-5xl font-bold text-white">{c.count}</p>
              <p className="mt-2 text-sm text-white/50">
                {c.label}
                {c.extra && <span className="ml-1.5 text-white/30">{c.extra}</span>}
              </p>
            </div>
          ))}
        </div>
      </div>
      {/* Subtle decorative gradient orb */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#0071e3]/10 blur-3xl" />
    </div>
  );
}

/* ---------- Section C: Leader cards with expandable members ---------- */

interface MemberSummary {
  readonly userId: string;
  readonly name: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
}

interface LeaderSummary {
  readonly leaderName: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
  readonly doneRate: number;
  readonly members: readonly MemberSummary[];
}

function LeaderCard({ leader }: { readonly leader: LeaderSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group rounded-2xl bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between">
          <p className="text-xl font-semibold text-[#1d1d1f]">{leader.leaderName}</p>
          <span className="text-xs text-[#86868b] transition-all duration-300 ease-out">
            {expanded ? '收起' : '展开'}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-5 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#0071e3]" />
            <span className="tabular-nums text-[#1d1d1f]">{leader.total}</span>
            <span className="text-[#86868b]">总计</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#34c759]" />
            <span className="tabular-nums text-[#1d1d1f]">{leader.done}</span>
            <span className="text-[#86868b]">完成</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ff3b30]" />
            <span className="tabular-nums text-[#1d1d1f]">{leader.overdue}</span>
            <span className="text-[#86868b]">延期</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ff9500]" />
            <span className="tabular-nums text-[#1d1d1f]">{leader.carryOver}</span>
            <span className="text-[#86868b]">继承</span>
          </span>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-[#86868b]">
            <span>完成率</span>
            <span className="tabular-nums font-medium text-[#1d1d1f]">{leader.doneRate}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f5f5f7]">
            <div
              className="h-full rounded-full bg-[#34c759] transition-all duration-500 ease-out"
              style={{ width: `${Math.min(leader.doneRate, 100)}%` }}
            />
          </div>
        </div>
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          expanded && leader.members.length > 0 ? 'mt-5 max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-[#f5f5f7] pt-4">
          <p className="mb-3 text-xs font-medium text-[#86868b]">团队成员明细</p>
          <div className="space-y-2">
            {leader.members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded-xl bg-[#f5f5f7] px-4 py-2.5">
                <span className="text-sm font-medium text-[#1d1d1f]">{m.name}</span>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <span className="text-[#6e6e73]">总 {m.total}</span>
                  <span className="text-[#34c759]">完 {m.done}</span>
                  <span className={m.overdue > 0 ? 'font-semibold text-[#ff3b30]' : 'text-[#6e6e73]'}>
                    延 {m.overdue}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaderCards({ leaders }: { readonly leaders: readonly LeaderSummary[] }) {
  if (leaders.length === 0) {
    return <p className="py-12 text-center text-[#86868b]">暂无负责人数据</p>;
  }

  return (
    <div className="mt-12">
      <h3 className="mb-6 text-2xl font-semibold tracking-tight text-[#1d1d1f]">Leader 概览</h3>
      <div className="grid gap-5 sm:grid-cols-2">
        {leaders.map((l) => (
          <LeaderCard key={l.leaderName} leader={l} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Section D: Risk tasks table ---------- */

interface RiskTask {
  readonly title: string;
  readonly assigneeName: string;
  readonly leaderName: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: string | null;
  readonly daysToDue: number;
  readonly isOverdue: boolean;
  readonly carryOverCount: number;
}

function riskIndicator(t: RiskTask): string {
  const indicators: string[] = [];
  if (t.isOverdue) indicators.push('\uD83D\uDEA8');
  if (t.carryOverCount >= 2) indicators.push('\uD83D\uDD04');
  return indicators.join(' ');
}

function RiskTable({ tasks }: { readonly tasks: readonly RiskTask[] }) {
  if (tasks.length === 0) {
    return <p className="py-12 text-center text-[#86868b]">暂无风险任务</p>;
  }

  return (
    <div className="mt-12">
      <h3 className="mb-6 text-2xl font-semibold tracking-tight text-[#1d1d1f]">风险任务</h3>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-[#f5f5f7]">
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">标题</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">负责人</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">Leader</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">状态</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">优先级</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">截止时间</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">延期天数</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#86868b]">继承次数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5f5f7]">
              {tasks.map((t, idx) => (
                <tr key={`${t.title}-${idx}`} className="transition-colors duration-200 hover:bg-[#f5f5f7]/50">
                  <td className="px-5 py-4 font-medium text-[#1d1d1f]">
                    {riskIndicator(t) && <span className="mr-1">{riskIndicator(t)}</span>}
                    {t.title}
                  </td>
                  <td className="px-5 py-4 text-[#1d1d1f]">{t.assigneeName || '-'}</td>
                  <td className="px-5 py-4 text-[#6e6e73]">{t.leaderName || '-'}</td>
                  <td className="px-5 py-4"><StatusBadge status={t.status} /></td>
                  <td className="px-5 py-4"><PriorityBadge priority={t.priority} /></td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums text-[#6e6e73]">
                    {t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '-'}
                  </td>
                  <td className={`px-5 py-4 tabular-nums ${t.isOverdue ? 'font-semibold text-[#ff3b30]' : 'text-[#6e6e73]'}`}>
                    {t.daysToDue && t.daysToDue < 0 ? `${Math.abs(t.daysToDue)}天` : '-'}
                  </td>
                  <td className={`px-5 py-4 tabular-nums ${t.carryOverCount >= 2 ? 'font-semibold text-[#ff9500]' : 'text-[#6e6e73]'}`}>
                    {t.carryOverCount}
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

/* ---------- Main ---------- */

function DashboardContent() {
  const [authed, setAuthed] = useState(false);
  const [month, setMonth] = useState(() => formatMonth(new Date()));

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading } = useDashboard(month);

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#86868b]">正在验证登录状态...</p>
      </div>
    );
  }

  return (
    <div className="pb-16">
      <div className="mb-8 flex items-center justify-between pt-8">
        <h2 className="sr-only">驾驶舱</h2>
        <MonthSelector value={month} onChange={setMonth} />
      </div>

      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#86868b]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#ff3b30]">加载失败: {error.message}</p>
        </div>
      ) : data ? (
        <>
          <HeroStats
            stats={{
              total: data.stats?.total ?? 0,
              done: data.stats?.done ?? 0,
              overdue: data.stats?.overdue ?? 0,
              carryOver: data.stats?.carryOver ?? 0,
            }}
            month={month}
          />
          <LeaderCards leaders={data.leaderSummary ?? []} />
          <RiskTable tasks={data.riskTasks ?? []} />
        </>
      ) : null}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[#86868b]">加载中...</p>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
