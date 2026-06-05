'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { useMe } from '@/hooks/use-me';

interface ScoreDetail {
  score_uid: string;
  score_month: string;
  ratee_user_id: string;
  ratee_name: string;
  rater_user_id: string;
  rater_name: string;
  score: number | null;
  status: string;
  challenge_note: string | null;
  challenged_at: string | null;
  resolved_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  version: number;
}

interface ScoreContext {
  score: ScoreDetail;
  snapshot: {
    doneRate: string;
    monthDoneCount: number;
    monthDueCount: number;
    monthOverdueCount: number;
    monthCarryOverCount: number;
  } | null;
  prevScore: {
    score: number | null;
    status: string;
    scoreMonth: string;
  } | null;
  incidents: Array<{ incident_uid: string; title: string; severity: string }>;
  picProjects: Array<{ projectUid: string; name: string; category: string; region: string | null }>;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: '待打分', className: 'text-[var(--text-muted)] bg-[var(--text-muted)]/10 border-[var(--text-muted)]/20' },
  scored: { label: '已打分', className: 'text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/20' },
  challenged: { label: '质疑中', className: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/30' },
  pending_lock: { label: '待锁定', className: 'text-[var(--st-not-started)] bg-[var(--st-not-started)]/10 border-[var(--st-not-started)]/20' },
  locked: { label: '已锁定', className: 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20' },
};

function ScoreDetailContent() {
  const router = useRouter();
  const params = useParams();
  const scoreUid = params.score_uid as string;
  const [authed, setAuthed] = useState(false);
  const [scoreInput, setScoreInput] = useState('');
  const [challengeNote, setChallengeNote] = useState('');
  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data: me } = useMe();

  const { data: ctx, error, isLoading, mutate } = useSWR<ScoreContext>(
    authed && scoreUid ? `/api/v1/scores/${scoreUid}/context` : null,
    (url: string) => apiFetch<ScoreContext>(url),
  );

  const score = ctx?.score;

  const isRater = me && score && me.user_id === score.rater_user_id;
  const canScore = isRater && (score.status === 'draft' || score.status === 'challenged');
  const canChallenge = score?.status === 'scored' && !score.locked_at;
  const canResolve = isRater && score?.status === 'challenged';
  const canLock = score && (score.status === 'scored' || score.status === 'pending_lock');
  const isLocked = score?.status === 'locked';

  async function handleScore() {
    if (!score) return;
    const val = parseFloat(scoreInput);
    if (isNaN(val) || val < 0 || val > 1) {
      toast.error('分数需在 0.0 ~ 1.0 之间');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/scores/${scoreUid}/score`, {
        method: 'PATCH',
        body: JSON.stringify({ score: val, version: score.version }),
      });
      toast.success('评分已提交');
      setScoreInput('');
      mutate();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 1009) {
        toast.error('版本冲突，请刷新后重试');
        mutate();
      } else {
        toast.error(err instanceof Error ? err.message : '提交失败');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChallenge() {
    if (!score || !challengeNote.trim()) {
      toast.error('请填写质疑备注');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/scores/${scoreUid}/challenge`, {
        method: 'POST',
        body: JSON.stringify({ challenge_note: challengeNote.trim(), version: score.version }),
      });
      toast.success('质疑已发起');
      setShowChallengeForm(false);
      setChallengeNote('');
      mutate();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 1009) {
        toast.error('版本冲突，请刷新后重试');
        mutate();
      } else {
        toast.error(err instanceof Error ? err.message : '操作失败');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve() {
    if (!score) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/scores/${scoreUid}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ version: score.version }),
      });
      toast.success('质疑已响应，进入待锁定状态');
      mutate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLock() {
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/scores/${scoreUid}/lock`, { method: 'POST' });
      toast.success('评分已锁定');
      mutate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (!authed) return <LoadingScreen />;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[var(--text-muted)]">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[var(--accent-red)]">加载失败: {error.message}</p>
      </div>
    );
  }

  if (!score) return null;

  const statusCfg = STATUS_CONFIG[score.status] ?? STATUS_CONFIG.draft;

  return (
    <div className="pb-16 pt-8">
      <button
        onClick={() => router.back()}
        className="mb-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        ← 返回评分列表
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {score.ratee_name} · {score.score_month} 月度评分
          </h2>
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusCfg.className}`}>
            {statusCfg.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">打分人: {score.rater_name}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Score operations */}
        <div className="space-y-5">
          {/* Current score */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">评分</h3>
            <div className="flex items-center gap-4">
              {score.score != null ? (
                <span className="text-4xl font-bold tabular-nums text-[var(--text-primary)]">
                  {score.score}
                </span>
              ) : (
                <span className="text-lg text-[var(--text-muted)]">未评分</span>
              )}
              <span className="text-sm text-[var(--text-muted)]">/ 1.0</span>
            </div>

            {/* Score input (for rater on draft/challenged) */}
            {!isLocked && canScore && (
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={scoreInput}
                  onChange={(e) => setScoreInput(e.target.value)}
                  placeholder="0.0 ~ 1.0"
                  className="w-32 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
                />
                <button
                  onClick={handleScore}
                  disabled={submitting || !scoreInput}
                  className="rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
                >
                  {score.status === 'draft' ? '确认打分' : '修改分数'}
                </button>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {!isLocked && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">操作</h3>
              <div className="flex flex-wrap gap-3">
                {canChallenge && !showChallengeForm && (
                  <button
                    onClick={() => setShowChallengeForm(true)}
                    className="rounded-xl border border-[#f97316]/30 bg-[#f97316]/10 px-4 py-2 text-sm font-medium text-[#f97316] transition-all hover:bg-[#f97316]/20"
                  >
                    发起质疑
                  </button>
                )}
                {canResolve && (
                  <button
                    onClick={handleResolve}
                    disabled={submitting}
                    className="rounded-xl border border-[var(--st-not-started)]/30 bg-[var(--st-not-started)]/10 px-4 py-2 text-sm font-medium text-[var(--st-not-started)] transition-all hover:bg-[var(--st-not-started)]/20 disabled:opacity-50"
                  >
                    响应质疑
                  </button>
                )}
                {canLock && (
                  <button
                    onClick={handleLock}
                    disabled={submitting}
                    className="rounded-xl bg-[var(--accent-green)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-green)]/90 disabled:opacity-50"
                  >
                    最终锁定
                  </button>
                )}
              </div>

              {/* Challenge form */}
              {showChallengeForm && (
                <div className="mt-4 space-y-3">
                  <textarea
                    value={challengeNote}
                    onChange={(e) => setChallengeNote(e.target.value)}
                    placeholder="请描述质疑原因（线下沟通摘要）"
                    rows={3}
                    className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowChallengeForm(false); setChallengeNote(''); }}
                      className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleChallenge}
                      disabled={submitting || !challengeNote.trim()}
                      className="rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#f97316]/90 disabled:opacity-50"
                    >
                      确认质疑
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Challenge history */}
          {score.challenge_note && (
            <div className="rounded-2xl border border-[#f97316]/20 bg-[#f97316]/5 p-5">
              <h3 className="mb-2 text-sm font-semibold text-[#f97316]">质疑记录</h3>
              <p className="text-sm text-[var(--text-secondary)]">{score.challenge_note}</p>
              {score.challenged_at && (
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  发起时间: {new Date(score.challenged_at).toLocaleDateString('zh-CN')}
                </p>
              )}
              {score.resolved_at && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  响应时间: {new Date(score.resolved_at).toLocaleDateString('zh-CN')}
                </p>
              )}
            </div>
          )}

          {/* Locked info */}
          {isLocked && score.locked_at && (
            <div className="rounded-2xl border border-[var(--accent-green)]/20 bg-[var(--accent-green)]/8 p-5">
              <p className="text-sm text-[var(--accent-green)]">
                已于 {new Date(score.locked_at).toLocaleDateString('zh-CN')} 最终锁定
              </p>
            </div>
          )}
        </div>

        {/* Right: Context panel */}
        <div className="space-y-4">
          {/* Task summary */}
          {ctx?.snapshot && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">任务完成情况</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">完成率</span>
                  <span className="font-bold text-[var(--text-primary)]">{ctx.snapshot.doneRate}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">完成 / 总数</span>
                  <span className="tabular-nums text-[var(--text-primary)]">
                    {ctx.snapshot.monthDoneCount} / {ctx.snapshot.monthDueCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">逾期</span>
                  <span className={`tabular-nums font-medium ${ctx.snapshot.monthOverdueCount > 0 ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                    {ctx.snapshot.monthOverdueCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">结转</span>
                  <span className="tabular-nums text-[var(--text-secondary)]">
                    {ctx.snapshot.monthCarryOverCount}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Prev score */}
          {ctx?.prevScore !== undefined && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">上月对比</h3>
              {ctx.prevScore ? (
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold tabular-nums text-[var(--text-secondary)]">
                    {ctx.prevScore.score ?? '-'}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">{ctx.prevScore.scoreMonth}</span>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">无上月记录</p>
              )}
            </div>
          )}

          {/* PIC projects */}
          {ctx?.picProjects && ctx.picProjects.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">项目 PIC</h3>
              <div className="space-y-1.5">
                {ctx.picProjects.map((p) => (
                  <div key={p.projectUid} className="flex items-center justify-between text-sm">
                    <span className="truncate text-[var(--text-primary)]">{p.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-[var(--text-muted)]">
                      {p.category}{p.region ? ` · ${p.region}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Incidents */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">关联事故</h3>
            {ctx?.incidents && ctx.incidents.length > 0 ? (
              <div className="space-y-1.5">
                {ctx.incidents.map((inc) => (
                  <div key={inc.incident_uid} className="flex items-center gap-2 text-sm">
                    <span className="shrink-0 rounded-full border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent-red)]">
                      {inc.severity}
                    </span>
                    <a
                      href={`/incidents/${inc.incident_uid}`}
                      className="truncate text-[var(--text-primary)] hover:text-[var(--accent-blue)] hover:underline"
                    >
                      {inc.title}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">暂无关联事故</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScoreDetailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <ScoreDetailContent />
    </Suspense>
  );
}
