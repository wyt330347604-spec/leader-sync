'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { ensureAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { IncidentSeverityBadge } from '@/components/incident-severity-badge';

const CONFIRM_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending_confirm: { label: '待确认', className: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/30' },
  confirmed: { label: '已确认', className: 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20' },
  rejected: { label: '已驳回', className: 'text-[var(--text-muted)] bg-[var(--text-muted)]/10 border-[var(--text-muted)]/20' },
};

function buildMonthOptions() {
  const opts: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push({ label: `${d.getFullYear()}年${d.getMonth() + 1}月`, value });
  }
  opts.unshift({ label: '全部月份', value: '' });
  return opts;
}

const MONTH_OPTIONS = buildMonthOptions();
const SEVERITY_OPTIONS = ['', 'P0', 'P1', 'P2', 'P3'];
const CONFIRM_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending_confirm', label: '待确认' },
  { value: 'confirmed', label: '已确认' },
  { value: 'rejected', label: '已驳回' },
];

interface IncidentItem {
  incident_uid: string;
  title: string;
  severity: string;
  confirm_status: string;
  reporter_name: string;
  involved_users: Array<{ user_id: string; user_name: string; involvement: string }>;
  created_at: string;
  incident_date: string | null;
}

interface IncidentListData {
  total: number;
  page: number;
  page_size: number;
  items: IncidentItem[];
}

function IncidentsContent() {
  const searchParams = useSearchParams();
  const [authed, setAuthed] = useState(false);
  const [severity, setSeverity] = useState('');
  const [confirmStatus, setConfirmStatus] = useState('');
  const [month, setMonth] = useState('');
  const [projectUid, setProjectUid] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  // V2c：从项目卡片跳转过来 ?project=<uid> → 按项目过滤
  useEffect(() => {
    setProjectUid(searchParams.get('project') ?? '');
  }, [searchParams]);

  const params = new URLSearchParams();
  if (severity) params.set('severity', severity);
  if (confirmStatus) params.set('confirm_status', confirmStatus);
  if (month) params.set('month', month);
  if (projectUid) params.set('project_uid', projectUid);
  params.set('page', String(page));
  params.set('page_size', '20');

  const { data, error, isLoading } = useSWR<IncidentListData>(
    authed ? `/api/v1/incidents?${params.toString()}` : null,
    (url: string) => apiFetch<IncidentListData>(url),
  );

  if (!authed) return <LoadingScreen />;

  return (
    <div className="pb-16 pt-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">事故记录</h2>
        <Link
          href="/incidents/create"
          className="rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90"
        >
          + 新建事故
        </Link>
      </div>

      {/* V2c：按项目过滤指示 */}
      {projectUid && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 px-3 py-2 text-sm">
          <span className="text-[var(--accent-blue)]">已按项目过滤关联事故</span>
          <button
            onClick={() => { setProjectUid(''); setPage(1); }}
            className="ml-auto text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            清除
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Severity filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">严重程度:</span>
          {SEVERITY_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setSeverity(s); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                severity === s
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/50'
              }`}
            >
              {s || '全部'}
            </button>
          ))}
        </div>

        {/* Month filter */}
        <select
          value={month}
          onChange={(e) => { setMonth(e.target.value); setPage(1); }}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none"
        >
          {MONTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Confirm status filter */}
        <select
          value={confirmStatus}
          onChange={(e) => { setConfirmStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none"
        >
          {CONFIRM_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
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
              <p className="text-[var(--text-muted)]">暂无事故记录</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {data.items.map((incident) => {
                const statusCfg = CONFIRM_STATUS_CONFIG[incident.confirm_status] ?? CONFIRM_STATUS_CONFIG.confirmed;
                const isPending = incident.confirm_status === 'pending_confirm';
                return (
                  <Link
                    key={incident.incident_uid}
                    href={`/incidents/${incident.incident_uid}`}
                    className={`block rounded-2xl border p-5 transition-colors hover:bg-[var(--bg-hover)] ${
                      isPending
                        ? 'border-[#f97316]/40 bg-[#f97316]/5'
                        : 'border-[var(--border)] bg-[var(--bg-card)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <IncidentSeverityBadge severity={incident.severity} />
                          <h3 className="text-base font-semibold text-[var(--text-primary)]">
                            {incident.title}
                          </h3>
                          {isPending && (
                            <span className="text-xs font-medium text-[#f97316] animate-pulse">
                              需要确认
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                          <span>记录人: {incident.reporter_name}</span>
                          {(incident.involved_users?.length ?? 0) > 0 && (
                            <span>
                              涉及: {(incident.involved_users ?? []).map((u) => u.user_name).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusCfg.className}`}>
                          {statusCfg.label}
                        </span>
                        <span className="text-xs text-[var(--text-muted)] tabular-nums">
                          {new Date(incident.created_at).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </Link>
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

export default function IncidentsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <IncidentsContent />
    </Suspense>
  );
}
