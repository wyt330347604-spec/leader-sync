'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ensureAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthOptions() {
  const opts: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push({ label: `${d.getFullYear()}年${d.getMonth() + 1}月`, value });
  }
  return opts;
}

const MONTH_OPTIONS = buildMonthOptions();

const SCORE_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: '待打分', className: 'text-[var(--text-muted)] bg-[var(--text-muted)]/10 border-[var(--text-muted)]/20' },
  scored: { label: '已打分', className: 'text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/20' },
  challenged: { label: '质疑中', className: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/30' },
  pending_lock: { label: '待锁定', className: 'text-[var(--st-not-started)] bg-[var(--st-not-started)]/10 border-[var(--st-not-started)]/20' },
  locked: { label: '已锁定', className: 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20' },
};

interface ScoreItem {
  score_uid: string;
  score_month: string;
  ratee_user_id: string;
  ratee_name: string;
  rater_user_id: string;
  rater_name: string;
  score: number | null;
  status: string;
  challenged_at: string | null;
  locked_at: string | null;
}

interface ScoreListData {
  total: number;
  page: number;
  page_size: number;
  items: ScoreItem[];
}

function ScoresContent() {
  const [authed, setAuthed] = useState(false);
  const [month, setMonth] = useState(getCurrentMonth);
  const [page, setPage] = useState(1);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const params = new URLSearchParams();
  params.set('month', month);
  params.set('page', String(page));
  params.set('page_size', '20');

  const { data, error, isLoading } = useSWR<ScoreListData>(
    authed ? `/api/v1/scores?${params.toString()}` : null,
    (url: string) => apiFetch<ScoreListData>(url),
  );

  if (!authed) return <LoadingScreen />;

  return (
    <div className="pb-16 pt-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">月度评分</h2>
      </div>

      {/* Month selector */}
      <div className="mb-6 flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="text-xs text-[var(--text-muted)]">月份:</span>
        {MONTH_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => { setMonth(o.value); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs transition-all ${
              month === o.value
                ? 'bg-[var(--accent-blue)] text-white'
                : 'border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[var(--accent-red)]">加载失败: {error.message}</p>
        </div>
      ) : (
        <>
          {!data?.items?.length ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <p className="text-[var(--text-muted)]">本月暂无评分记录</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 bg-[var(--bg-surface)] px-5 py-3 text-xs font-medium text-[var(--text-muted)]">
                <span>员工</span>
                <span className="text-right">分数</span>
                <span className="text-right">状态</span>
                <span className="text-right">操作</span>
              </div>

              {data.items.map((item, idx) => {
                const statusCfg = SCORE_STATUS_CONFIG[item.status] ?? SCORE_STATUS_CONFIG.draft;
                return (
                  <div
                    key={item.score_uid}
                    className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-4 ${
                      idx < data.items.length - 1 ? 'border-b border-[var(--border)]' : ''
                    } hover:bg-[var(--bg-hover)] transition-colors`}
                  >
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">{item.ratee_name}</p>
                      <p className="text-xs text-[var(--text-muted)]">打分人: {item.rater_name}</p>
                    </div>
                    <div className="text-right">
                      {item.score != null ? (
                        <span className="tabular-nums font-bold text-[var(--text-primary)]">
                          {item.score}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">-</span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusCfg.className}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <div className="text-right">
                      <Link
                        href={`/scores/${item.score_uid}`}
                        className="text-xs text-[var(--accent-blue)] hover:underline transition-colors"
                      >
                        查看
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {data && data.total > 20 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-full px-5 py-2 text-sm font-medium text-[var(--accent-blue)] transition-all hover:bg-[var(--accent-blue)]/10 disabled:text-[var(--text-muted)]"
              >
                上一页
              </button>
              <span className="tabular-nums text-sm text-[var(--text-muted)]">
                第 {page} 页 / 共 {data.total} 条
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.items || data.items.length < 20}
                className="rounded-full px-5 py-2 text-sm font-medium text-[var(--accent-blue)] transition-all hover:bg-[var(--accent-blue)]/10 disabled:text-[var(--text-muted)]"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ScoresPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <ScoresContent />
    </Suspense>
  );
}
