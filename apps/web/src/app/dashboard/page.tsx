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
              ? 'bg-[#3b82f6] text-white'
              : 'bg-[#1e1e2e] text-[#8b8b9e] border border-[#2a2a3a] hover:bg-[#1a1a2e] hover:text-[#e4e4e7]'
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
  readonly riskCount?: number;
  readonly weeklyNewCount?: number;
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

const STAT_ACCENT_COLORS = [
  '#3b82f6', // blue - total
  '#22c55e', // green - done
  '#ef4444', // red - overdue
  '#f59e0b', // orange - risk
  '#8b5cf6', // purple - carry over
  '#3b82f6', // blue - weekly new
  '#22c55e', // green - done rate
  '#ef4444', // red - overdue rate
] as const;

function HeroStats({ stats, month }: { readonly stats: MonthlyStats; readonly month: string }) {
  const riskCount = stats.riskCount ?? 0;
  const weeklyNew = stats.weeklyNewCount ?? 0;
  const doneRate = pct(stats.done, stats.total);
  const overdueRate = pct(stats.overdue, stats.total);

  const cards = [
    { label: '总任务', value: stats.total, accent: STAT_ACCENT_COLORS[0] },
    { label: '已完成', value: stats.done, accent: STAT_ACCENT_COLORS[1] },
    { label: '已延期', value: stats.overdue, accent: STAT_ACCENT_COLORS[2] },
    { label: '风险任务', value: riskCount, accent: STAT_ACCENT_COLORS[3] },
    { label: '继承任务', value: stats.carryOver, accent: STAT_ACCENT_COLORS[4] },
    { label: '本周新增', value: weeklyNew, accent: STAT_ACCENT_COLORS[5] },
    { label: '完成率', value: doneRate, accent: STAT_ACCENT_COLORS[6] },
    { label: '延期率', value: overdueRate, accent: STAT_ACCENT_COLORS[7] },
  ] as const;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#12121a] to-[#1a1a2e] border border-[#2a2a3a] px-8 py-10 sm:px-10">
      <div className="relative z-10">
        <p className="mb-1 text-sm font-medium tracking-wide text-[#5a5a6e]">督办概览</p>
        <h2 className="mb-8 text-3xl font-bold tracking-tight text-white">
          {getMonthLabel(month)} 督办概览
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl bg-[#0a0a0f]/60 border border-[#2a2a3a] p-4"
            >
              <div className="h-1 w-8 rounded-full mb-3" style={{ backgroundColor: c.accent }} />
              <p className="tabular-nums text-3xl font-bold text-white">{c.value}</p>
              <p className="mt-1 text-xs text-[#5a5a6e]">{c.label}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Decorative gradient orb */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#3b82f6]/5 blur-3xl" />
    </div>
  );
}

/* ---------- Section C: Risk tasks table ---------- */

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
  readonly riskReasons?: readonly string[];
}

const RISK_REASON_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  '延期': { bg: 'bg-[#ef4444]/10', text: 'text-[#ef4444]', border: 'border-[#ef4444]/20' },
  '继承': { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]', border: 'border-[#f59e0b]/20' },
  '停滞': { bg: 'bg-[#8b5cf6]/10', text: 'text-[#8b5cf6]', border: 'border-[#8b5cf6]/20' },
  '临期': { bg: 'bg-[#eab308]/10', text: 'text-[#eab308]', border: 'border-[#eab308]/20' },
  '重点无进度': { bg: 'bg-[#3b82f6]/10', text: 'text-[#3b82f6]', border: 'border-[#3b82f6]/20' },
};

function RiskReasonTags({ reasons }: { readonly reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reasons.map((r) => {
        const style = RISK_REASON_STYLES[r] || { bg: 'bg-[#5a5a6e]/10', text: 'text-[#5a5a6e]', border: 'border-[#5a5a6e]/20' };
        return (
          <span
            key={r}
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${style.bg} ${style.text} ${style.border}`}
          >
            {r}
          </span>
        );
      })}
    </div>
  );
}

function RiskTable({ tasks }: { readonly tasks: readonly RiskTask[] }) {
  if (tasks.length === 0) {
    return <p className="py-12 text-center text-[#5a5a6e]">暂无风险任务</p>;
  }

  return (
    <div className="mt-10">
      <h3 className="mb-5 text-xl font-semibold tracking-tight text-[#e4e4e7]">风险任务</h3>
      <div className="overflow-hidden rounded-2xl bg-[#12121a] border border-[#2a2a3a]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-[#1e1e2e]">
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">标题</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">负责人</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">Leader</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">状态</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">优先级</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">截止时间</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">延期天数</th>
                <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">继承次数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a3a]">
              {tasks.map((t, idx) => (
                <tr key={`${t.title}-${idx}`} className="transition-colors duration-200 hover:bg-[#1a1a2e]">
                  <td className="px-5 py-4 font-medium text-[#e4e4e7]">
                    <span>{t.title}</span>
                    <RiskReasonTags reasons={t.riskReasons ?? []} />
                  </td>
                  <td className="px-5 py-4 text-[#e4e4e7]">{t.assigneeName || '-'}</td>
                  <td className="px-5 py-4 text-[#8b8b9e]">{t.leaderName || '-'}</td>
                  <td className="px-5 py-4"><StatusBadge status={t.status} /></td>
                  <td className="px-5 py-4"><PriorityBadge priority={t.priority} /></td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums text-[#8b8b9e]">
                    {t.dueAt ? new Date(t.dueAt).toLocaleDateString('zh-CN') : '-'}
                  </td>
                  <td className={`px-5 py-4 tabular-nums ${t.isOverdue ? 'font-semibold text-[#ef4444]' : 'text-[#8b8b9e]'}`}>
                    {t.daysToDue && t.daysToDue < 0 ? `${Math.abs(t.daysToDue)}天` : '-'}
                  </td>
                  <td className={`px-5 py-4 tabular-nums ${t.carryOverCount >= 2 ? 'font-semibold text-[#f59e0b]' : 'text-[#8b8b9e]'}`}>
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

/* ---------- Section D: Leader cards with expandable members ---------- */

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
  readonly riskCount?: number;
  readonly weeklyNewCount?: number;
  readonly members: readonly MemberSummary[];
}

function LeaderCard({ leader }: { readonly leader: LeaderSummary }) {
  const [expanded, setExpanded] = useState(false);
  const riskCount = leader.riskCount ?? 0;
  const weeklyNew = leader.weeklyNewCount ?? 0;

  return (
    <div className="group rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6 transition-all duration-300 ease-out hover:bg-[#1a1a2e]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between">
          <p className="text-xl font-semibold text-[#e4e4e7]">{leader.leaderName}</p>
          <span className="text-xs text-[#5a5a6e] transition-all duration-300 ease-out">
            {expanded ? '收起' : '展开'}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#3b82f6]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.total}</span>
            <span className="text-[#5a5a6e]">总计</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.done}</span>
            <span className="text-[#5a5a6e]">完成</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.overdue}</span>
            <span className="text-[#5a5a6e]">延期</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.carryOver}</span>
            <span className="text-[#5a5a6e]">继承</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#8b5cf6]" />
            <span className="tabular-nums text-[#e4e4e7]">{riskCount}</span>
            <span className="text-[#5a5a6e]">风险</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#06b6d4]" />
            <span className="tabular-nums text-[#e4e4e7]">{weeklyNew}</span>
            <span className="text-[#5a5a6e]">本周新增</span>
          </span>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-[#5a5a6e]">
            <span>完成率</span>
            <span className="tabular-nums font-medium text-[#e4e4e7]">{leader.doneRate}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1e1e2e]">
            <div
              className="h-full rounded-full bg-[#22c55e] transition-all duration-500 ease-out"
              style={{
                width: `${Math.min(leader.doneRate, 100)}%`,
                boxShadow: '0 0 8px rgba(34,197,94,0.4)',
              }}
            />
          </div>
        </div>
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          expanded && leader.members.length > 0 ? 'mt-5 max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-[#2a2a3a] pt-4">
          <p className="mb-3 text-xs font-medium text-[#5a5a6e]">团队成员明细</p>
          <div className="space-y-2">
            {leader.members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded-xl bg-[#1e1e2e] px-4 py-2.5">
                <span className="text-sm font-medium text-[#e4e4e7]">{m.name}</span>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <span className="text-[#8b8b9e]">总 {m.total}</span>
                  <span className="text-[#22c55e]">完 {m.done}</span>
                  <span className={m.overdue > 0 ? 'font-semibold text-[#ef4444]' : 'text-[#8b8b9e]'}>
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
    return <p className="py-12 text-center text-[#5a5a6e]">暂无负责人数据</p>;
  }

  return (
    <div className="mt-10">
      <h3 className="mb-5 text-xl font-semibold tracking-tight text-[#e4e4e7]">Leader 概览</h3>
      <div className="grid gap-5 sm:grid-cols-2">
        {leaders.map((l) => (
          <LeaderCard key={l.leaderName} leader={l} />
        ))}
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
        <p className="text-[#5a5a6e]">正在验证登录状态...</p>
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
          <p className="text-[#5a5a6e]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#ef4444]">加载失败: {error.message}</p>
        </div>
      ) : data ? (
        <>
          <HeroStats
            stats={{
              total: data.stats?.total ?? 0,
              done: data.stats?.done ?? 0,
              overdue: data.stats?.overdue ?? 0,
              carryOver: data.stats?.carryOver ?? 0,
              riskCount: data.stats?.riskCount ?? 0,
              weeklyNewCount: data.stats?.weeklyNewCount ?? 0,
            }}
            month={month}
          />
          <RiskTable tasks={data.riskTasks ?? []} />
          <LeaderCards leaders={data.leaderSummary ?? []} />
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
          <p className="text-[#5a5a6e]">加载中...</p>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
