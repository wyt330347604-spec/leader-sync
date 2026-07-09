'use client';
import { useState, useEffect, Suspense } from 'react';
import useSWR from 'swr';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';

// ── 类型（对齐 GET /api/v1/me/performance） ──────────────────────────────────
interface MonthlyTrendPoint {
  readonly month: string;
  readonly totalScore: number | null;
  readonly composite: number | null;
  readonly grade: string | null;
  readonly redLine: boolean;
}
interface QuarterResultCard {
  readonly resultUid: string;
  readonly quarter: string;
  readonly total: number | null;
  readonly grade: string | null;
  readonly softMerged: number | null;
  readonly goalScore: number | null;
  readonly sheetType: string;
  readonly status: string;
  readonly appealDeadlineAt: string | null;
}
interface HalfYearCard {
  readonly resultUid: string;
  readonly half: string;
  readonly total: number | null;
  readonly grade: string | null;
  readonly formula: string | null;
}
interface Promotion {
  readonly eligible: boolean;
  readonly reason: string;
  readonly basis: readonly string[];
}
interface MyPerformance {
  readonly monthlyTrend: readonly MonthlyTrendPoint[];
  readonly quarterResults: readonly QuarterResultCard[];
  readonly halfYearResults: readonly HalfYearCard[];
  readonly grade: string | null;
  readonly promotion: Promotion;
}

// 季度评级 S/A/B/C/D 徽章（复用 quarter 页 GRADE_STYLE 口径）
const GRADE_STYLE: Record<string, string> = {
  S: 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/10 text-[var(--accent-green)]',
  A: 'border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]',
  B: 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
  C: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  D: 'border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 text-[var(--accent-red)]',
};
function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 text-sm font-bold ${GRADE_STYLE[grade] ?? GRADE_STYLE.B}`}
    >
      {grade}
    </span>
  );
}

function fmt(n: number | null): string {
  return n === null || n === undefined ? '—' : String(n);
}

function MyPerformanceContent() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading } = useSWR<MyPerformance>(
    authed ? '/api/v1/me/performance' : null,
    (url: string) => apiFetch<MyPerformance>(url),
  );

  if (!authed) return <LoadingScreen />;

  return (
    <div className="mx-auto max-w-2xl pb-16 pt-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">我的绩效</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">月度系数 · 季度评级 · 半年成绩 · 定级资格</p>
      </div>

      {isLoading ? (
        <p className="text-[var(--text-muted)]">加载中...</p>
      ) : error ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
          <p className="text-sm text-[var(--accent-red)]">
            {(error as ApiError)?.message ?? '加载失败'}
          </p>
        </div>
      ) : !data ? null : (
        <div className="space-y-6">
          {/* 定级定岗资格 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-muted)]">定级定岗资格</p>
                <p
                  className={`mt-1 text-lg font-semibold ${data.promotion.eligible ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)]'}`}
                >
                  {data.promotion.eligible ? '✓ 符合申请条件' : '暂不符合'}
                </p>
              </div>
              {data.grade && (
                <div className="text-right">
                  <p className="text-sm text-[var(--text-muted)]">当前职级</p>
                  <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{data.grade}</p>
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">{data.promotion.reason}</p>
          </div>

          {/* 季度成绩 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">季度成绩</h3>
            {!data.quarterResults.length ? (
              <p className="text-sm text-[var(--text-muted)]">暂无季度成绩</p>
            ) : (
              <div className="space-y-3">
                {data.quarterResults.map((q) => {
                  const canAppeal =
                    q.status === 'published' &&
                    q.appealDeadlineAt !== null &&
                    new Date(q.appealDeadlineAt).getTime() > Date.now();
                  return (
                    <div
                      key={q.resultUid}
                      className="flex items-center justify-between rounded-xl bg-[var(--bg-surface)] px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <GradeBadge grade={q.grade} />
                        <div>
                          <p className="text-sm font-medium text-[var(--text-primary)]">{q.quarter}</p>
                          <p className="text-xs text-[var(--text-muted)] tabular-nums">
                            总分 {fmt(q.total)} · 目标 {fmt(q.goalScore)} + 软项 {fmt(q.softMerged)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {canAppeal && (
                          <span className="text-xs text-[var(--accent-orange)]">
                            可申诉至 {new Date(q.appealDeadlineAt!).toLocaleDateString('zh-CN')}
                          </span>
                        )}
                        <a
                          href={`/quarter/result/${q.resultUid}`}
                          className="text-xs text-[var(--accent-blue)] hover:underline"
                        >
                          详情
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 半年成绩 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">半年成绩</h3>
            {!data.halfYearResults.length ? (
              <p className="text-sm text-[var(--text-muted)]">暂无半年成绩</p>
            ) : (
              <div className="space-y-3">
                {data.halfYearResults.map((h) => (
                  <div
                    key={h.resultUid}
                    className="flex items-center justify-between rounded-xl bg-[var(--bg-surface)] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <GradeBadge grade={h.grade} />
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">{h.half}</p>
                        <p className="text-xs text-[var(--text-muted)] tabular-nums">
                          总分 {fmt(h.total)} · {h.formula === '40/60' ? '前季40%+后季60%' : '单季100%'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 月度系数走势 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">月度绩效系数</h3>
            {!data.monthlyTrend.length ? (
              <p className="text-sm text-[var(--text-muted)]">暂无月度绩效</p>
            ) : (
              <div className="space-y-2">
                {data.monthlyTrend.map((m) => (
                  <div key={m.month} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-[var(--text-muted)] tabular-nums">{m.month}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent-blue)]"
                        style={{ width: `${Math.min(100, ((m.composite ?? 0) / 1.5) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--text-secondary)]">
                      {m.composite === null ? '待打分' : m.composite.toFixed(2)}
                    </span>
                    {m.redLine && <span className="text-xs text-[var(--accent-red)]">红线</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyPerformancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      }
    >
      <MyPerformanceContent />
    </Suspense>
  );
}
