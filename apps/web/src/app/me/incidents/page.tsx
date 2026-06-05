'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ensureAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { IncidentSeverityBadge } from '@/components/incident-severity-badge';

interface MyIncidentItem {
  incident_uid: string;
  title: string;
  severity: string;
  confirm_status: string;
  reporter_name: string;
  involvement: string;
  created_at: string;
}

interface MyIncidentData {
  total: number;
  page: number;
  page_size: number;
  items: MyIncidentItem[];
}

function buildMonthOptions() {
  const opts: { label: string; value: string }[] = [{ label: '全部月份', value: '' }];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push({ label: `${d.getFullYear()}年${d.getMonth() + 1}月`, value });
  }
  return opts;
}

const MONTH_OPTIONS = buildMonthOptions();
const CONFIRM_STATUS_LABELS: Record<string, string> = {
  pending_confirm: '待确认',
  confirmed: '已确认',
  rejected: '已驳回',
};

function MyIncidentsContent() {
  const [authed, setAuthed] = useState(false);
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const params = new URLSearchParams();
  if (month) params.set('month', month);
  params.set('page', String(page));
  params.set('page_size', '20');

  const { data, error, isLoading } = useSWR<MyIncidentData>(
    authed ? `/api/v1/me/incidents?${params.toString()}` : null,
    (url: string) => apiFetch<MyIncidentData>(url),
  );

  if (!authed) return <LoadingScreen />;

  return (
    <div className="pb-16 pt-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">我的事故记录</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          以下是所有涉及您的事故记录。如对记录有异议，请联系直属 Leader 或 PMO。
        </p>
      </div>

      {/* Month filter */}
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
              <p className="text-[var(--text-muted)]">暂无相关记录</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {data.items.map((item) => (
                <Link
                  key={item.incident_uid}
                  href={`/incidents/${item.incident_uid}`}
                  className="block rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <IncidentSeverityBadge severity={item.severity} />
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">{item.title}</h3>
                        {item.involvement === 'primary' && (
                          <span className="rounded-full bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 px-2 py-0.5 text-[10px] text-[var(--accent-red)]">
                            主要责任
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                        记录人: {item.reporter_name} · {new Date(item.created_at).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      {CONFIRM_STATUS_LABELS[item.confirm_status] ?? item.confirm_status}
                    </span>
                  </div>
                </Link>
              ))}
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

export default function MyIncidentsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <MyIncidentsContent />
    </Suspense>
  );
}
