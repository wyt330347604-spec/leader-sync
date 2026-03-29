'use client';
import { useState, useEffect, Suspense } from 'react';
import { useDashboard } from '@/hooks/use-dashboard';
import { ensureAuth } from '@/lib/auth';

function formatMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getMonthLabel(month: string): string {
  const parts = month.split('-');
  if (parts.length === 2) {
    return `${parseInt(parts[1], 10)}月`;
  }
  return month;
}

interface LeaderSummary {
  readonly leaderName: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
  readonly doneRate: number;
  readonly members: readonly unknown[];
}

function WidgetContent() {
  const [authed, setAuthed] = useState(false);
  const [month] = useState(() => formatMonth(new Date()));

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading } = useDashboard(month);

  if (!authed) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-xs text-white/50">验证中...</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-xs text-white/50">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-xs text-[#ff3b30]">加载失败</p>
      </div>
    );
  }

  if (!data) return null;

  const stats = {
    total: data.stats?.total ?? 0,
    done: data.stats?.done ?? 0,
    overdue: data.stats?.overdue ?? 0,
    carryOver: data.stats?.carryOver ?? 0,
  };

  const leaders: readonly LeaderSummary[] = data.leaderSummary ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#1d1d1f] text-white">
      {/* Compact hero stats */}
      <div className="px-4 pt-5 pb-4">
        <p className="mb-0.5 text-[10px] font-medium tracking-wide text-white/40">督办概览</p>
        <h1 className="mb-4 text-lg font-bold tracking-tight">
          {getMonthLabel(month)} 数据
        </h1>
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center">
            <p className="tabular-nums text-2xl font-bold">{stats.total}</p>
            <p className="mt-0.5 text-[10px] text-white/40">总任务</p>
          </div>
          <div className="text-center">
            <p className="tabular-nums text-2xl font-bold text-[#34c759]">{stats.done}</p>
            <p className="mt-0.5 text-[10px] text-white/40">已完成</p>
          </div>
          <div className="text-center">
            <p className="tabular-nums text-2xl font-bold text-[#ff3b30]">{stats.overdue}</p>
            <p className="mt-0.5 text-[10px] text-white/40">已延期</p>
          </div>
          <div className="text-center">
            <p className="tabular-nums text-2xl font-bold text-[#ff9500]">{stats.carryOver}</p>
            <p className="mt-0.5 text-[10px] text-white/40">继承</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-white/10" />

      {/* Compact leader list */}
      <div className="px-4 pt-4 pb-3">
        <p className="mb-3 text-[10px] font-medium tracking-wide text-white/40">负责人</p>
        {leaders.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/30">暂无数据</p>
        ) : (
          <div className="space-y-2">
            {leaders.map((l) => (
              <div
                key={l.leaderName}
                className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{l.leaderName}</p>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-white/40">
                    <span className="tabular-nums">总 {l.total}</span>
                    <span className="tabular-nums text-[#34c759]/70">完 {l.done}</span>
                    <span className="tabular-nums">{l.doneRate}%</span>
                  </div>
                </div>
                {l.overdue > 0 && (
                  <div className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-[#ff3b30]/15 px-2.5 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#ff3b30]" />
                    <span className="tabular-nums text-[11px] font-medium text-[#ff3b30]">
                      {l.overdue} 延期
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer link */}
      <div className="px-4 pb-5 pt-2">
        <a
          href="/dashboard"
          target="_top"
          className="flex items-center justify-center rounded-full bg-[#0071e3] py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#0077ed]"
        >
          查看完整驾驶舱 &rarr;
        </a>
      </div>
    </div>
  );
}

export default function WidgetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-black">
          <p className="text-xs text-white/50">加载中...</p>
        </div>
      }
    >
      <WidgetContent />
    </Suspense>
  );
}
