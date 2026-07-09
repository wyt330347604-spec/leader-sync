'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';

// ── 类型（后端 getResult 返回）────────────────────────────────────────────────
interface Weights {
  manager: number;
  mgmt?: number;
  peer: number;
}
interface MgmtRaters {
  rule: string | null;
  excludedIds: string[];
  raterIds: string[];
  scores: { raterId: string; raterName: string | null; soft: number }[];
}
interface ResultData {
  resultUid: string;
  rateeName: string | null;
  sheetType: string | null;
  goalScore: number | null;
  managerSoft: number | null;
  peerSoft: number | null;
  mgmtAvg: number | null;
  softMerged: number | null;
  total: number | null;
  grade: string | null;
  redLine: boolean;
  redLineNote: string | null;
  weightsUsed: Weights | null;
  mgmtRaters: MgmtRaters | null;
  status: string;
  appealDeadlineAt: string | null;
}
interface Revision {
  revisionUid: string;
  field: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  revisedBy: string | null;
  createdAt: string;
}
interface Appeal {
  appealUid: string;
  content: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
interface ResultResponse {
  result: ResultData;
  revisions: Revision[];
  appeals: Appeal[];
  isSelf: boolean;
  canAppeal: boolean;
}

const GRADE_STYLE: Record<string, string> = {
  S: 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/10 text-[var(--accent-green)]',
  A: 'border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]',
  B: 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
  C: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  D: 'border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 text-[var(--accent-red)]',
};
const FIELD_LABEL: Record<string, string> = {
  goal_score: '目标达成',
  soft_merged: '软项合成',
  total: '总分',
  grade: '评级',
};

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-[var(--text-muted)]">-</span>;
  return (
    <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg border px-2 text-sm font-bold ${GRADE_STYLE[grade] ?? GRADE_STYLE.B}`}>
      {grade}
    </span>
  );
}

function pct(n: number | undefined): string {
  if (n == null) return '-';
  return `${Math.round(n * 100)}%`;
}

function ResultContent() {
  const router = useRouter();
  const params = useParams();
  const resultUid = params.result_uid as string;
  const [authed, setAuthed] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading, mutate } = useSWR<ResultResponse>(
    authed && resultUid ? `/api/v1/quarter/results/${resultUid}` : null,
    (url: string) => apiFetch<ResultResponse>(url),
  );

  async function submitAppeal() {
    if (!appealText.trim()) {
      toast.error('请填写申诉内容');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/quarter/results/${resultUid}/appeal`, {
        method: 'POST',
        body: JSON.stringify({ content: appealText.trim() }),
      });
      toast.success('申诉已提交，HR 将尽快处理');
      setAppealText('');
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '申诉提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (!authed) return <LoadingScreen />;
  if (isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>;
  }
  if (error) {
    return (
      <div className="pb-16 pt-8">
        <button onClick={() => router.back()} className="mb-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">← 返回</button>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
          <p className="text-lg font-medium text-[var(--text-primary)]">无法查看该成绩</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{(error as ApiError)?.message ?? '无权限或成绩未公示'}</p>
        </div>
      </div>
    );
  }
  if (!data) return null;
  const r = data.result;
  const w = r.weightsUsed;
  const openAppeal = data.appeals.find((a) => a.status === 'open');
  const latestAppeal = data.appeals[0];

  return (
    <div className="pb-16 pt-8">
      <button onClick={() => router.back()} className="mb-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        ← 返回
      </button>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">{r.rateeName} · 季度成绩</h2>
        <GradeBadge grade={r.grade} />
        {r.status === 'draft' && (
          <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs text-[var(--text-muted)]">未公示（草稿）</span>
        )}
        {r.redLine && (
          <span className="rounded-full border border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent-red)]">红线一票否决</span>
        )}
      </div>

      {/* 总分 + 分解 */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-[var(--text-muted)]">季度总分</p>
                <p className="text-4xl font-bold tabular-nums text-[var(--text-primary)]">{r.total ?? '-'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--text-muted)]">评级</p>
                <div className="mt-1"><GradeBadge grade={r.grade} /></div>
              </div>
            </div>
            {r.redLineNote && (
              <p className="mt-3 rounded-lg border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 px-3 py-2 text-sm text-[var(--accent-red)]">红线事由：{r.redLineNote}</p>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">分数构成</h3>
            <div className="space-y-3 text-sm">
              <Row label={r.sheetType === 'leader' ? '团队结果（目标达成）' : '目标达成'} value={r.goalScore} />
              <div className="my-2 border-t border-[var(--border)]" />
              <p className="text-xs font-medium text-[var(--text-muted)]">软项三方（合成 {r.softMerged ?? '-'}）</p>
              <Row label={`直属评分 ${w ? `· 权重 ${pct(w.manager)}` : ''}`} value={r.managerSoft} />
              {w?.mgmt != null && <Row label={`管理层均值 · 权重 ${pct(w.mgmt)}`} value={r.mgmtAvg} />}
              <Row label={`同事评分 ${w ? `· 权重 ${pct(w.peer)}` : ''}`} value={r.peerSoft} />
              <div className="my-2 border-t border-[var(--border)]" />
              <div className="flex items-center justify-between font-semibold text-[var(--text-primary)]">
                <span>总分 = 目标达成 + 软项合成</span>
                <span className="tabular-nums">{r.total ?? '-'}</span>
              </div>
            </div>
            {r.mgmtRaters && r.mgmtRaters.scores.length > 0 && (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">
                  管理层个人分（{r.mgmtRaters.rule === 'first_level_dept' ? '按一级部门 leader 排除' : r.mgmtRaters.rule === 'manager_chain_fallback' ? '按管理链排除' : '排除规则'}，排除 {r.mgmtRaters.excludedIds.length} 人）
                </p>
                <div className="space-y-1">
                  {r.mgmtRaters.scores.map((s) => (
                    <div key={s.raterId} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{s.raterName ?? s.raterId}</span>
                      <span className="tabular-nums text-[var(--text-primary)]">{s.soft}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 评分会调整记录 */}
          {data.revisions.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">评分会调整记录</h3>
              <div className="space-y-2">
                {data.revisions.map((rev) => (
                  <div key={rev.revisionUid} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[var(--text-primary)]">{FIELD_LABEL[rev.field] ?? rev.field}</span>
                      <span className="tabular-nums text-[var(--text-secondary)]">{rev.before ?? '-'} → {rev.after ?? '-'}</span>
                    </div>
                    {rev.reason && <p className="mt-1 text-xs text-[var(--text-muted)]">原因：{rev.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右：申诉 */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">申诉</h3>
            {r.status !== 'published' ? (
              <p className="text-sm text-[var(--text-muted)]">成绩公示后方可申诉。</p>
            ) : latestAppeal ? (
              <div className="space-y-2">
                <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                  latestAppeal.status === 'open'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                    : latestAppeal.status === 'resolved'
                      ? 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
                      : 'border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
                }`}>
                  {latestAppeal.status === 'open' ? '处理中' : latestAppeal.status === 'resolved' ? '已受理' : '已驳回'}
                </span>
                <p className="text-sm text-[var(--text-secondary)]">{latestAppeal.content}</p>
                {latestAppeal.resolution && (
                  <p className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-muted)]">HR 结论：{latestAppeal.resolution}</p>
                )}
              </div>
            ) : data.canAppeal ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--text-muted)]">申诉截止：{r.appealDeadlineAt ? new Date(r.appealDeadlineAt).toLocaleDateString('zh-CN') : '-'}</p>
                <textarea
                  value={appealText}
                  onChange={(e) => setAppealText(e.target.value)}
                  rows={4}
                  placeholder="说明你对本次成绩的异议与理由…"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
                />
                <button
                  onClick={submitAppeal}
                  disabled={submitting}
                  className="w-full rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
                >
                  提交申诉
                </button>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">申诉期已过或无申诉权限。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="tabular-nums text-[var(--text-primary)]">{value ?? '-'}</span>
    </div>
  );
}

export default function QuarterResultPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <ResultContent />
    </Suspense>
  );
}
