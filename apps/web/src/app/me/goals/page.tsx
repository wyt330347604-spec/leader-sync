'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { useMe } from '@/hooks/use-me';

interface Goal {
  readonly goalUid: string;
  readonly half: string;
  readonly rateeUserId: string;
  readonly content: string | null;
  readonly proposedContent: string | null;
  readonly proposedBy: string | null;
  readonly proposedAt: string | null;
}
interface GoalRevision {
  readonly revisionUid: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly reason: string | null;
  readonly revisedBy: string | null;
  readonly createdAt: string;
}

/** 当前半年：1-6 月 → H1，7-12 月 → H2。 */
function currentHalf(): string {
  const now = new Date();
  const h = now.getMonth() + 1 <= 6 ? 'H1' : 'H2';
  return `${now.getFullYear()}-${h}`;
}

function MyGoalsContent() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);
  const { data: me } = useMe();
  const searchParams = useSearchParams();
  const half = searchParams.get('half') ?? currentHalf();
  const rateeParam = searchParams.get('ratee');
  const rateeUserId = rateeParam ?? me?.user_id ?? '';
  const isSelf = Boolean(me?.user_id) && (!rateeParam || rateeParam === me?.user_id || rateeParam === me?.open_id);

  const key = authed && rateeUserId ? `/api/v1/quarter/goals?ratee_user_id=${rateeUserId}&half=${half}` : null;
  const { data: goals, error, isLoading, mutate } = useSWR<Goal[]>(key, (url: string) => apiFetch<Goal[]>(url));

  const [proposeText, setProposeText] = useState('');
  const [setText, setSetText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!authed) return <LoadingScreen />;

  const goal = goals?.[0] ?? null;

  async function doPropose(goalUid: string) {
    if (!proposeText.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/quarter/goals/${goalUid}/propose`, {
        method: 'POST',
        body: JSON.stringify({ content: proposeText.trim() }),
      });
      toast.success('调整建议已提交，等待直属确认');
      setProposeText('');
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm(goalUid: string, accept: boolean) {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/quarter/goals/${goalUid}/confirm`, {
        method: 'PATCH',
        body: JSON.stringify({ accept, reason: accept ? '直属确认接受' : '直属驳回' }),
      });
      toast.success(accept ? '已接受调整' : '已驳回调整');
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function doSet() {
    if (!setText.trim()) return;
    setBusy(true);
    try {
      await apiFetch('/api/v1/quarter/goals', {
        method: 'POST',
        body: JSON.stringify({ ratee_user_id: rateeUserId, half, content: setText.trim() }),
      });
      toast.success('目标已设定');
      setSetText('');
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '设定失败');
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90 disabled:opacity-50';
  const ghostBtn =
    'rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-hover)] disabled:opacity-50';
  const textarea =
    'w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none';

  return (
    <div className="mx-auto max-w-2xl pb-16 pt-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          {isSelf ? '我的半年目标' : '下属半年目标'}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{half} · 直属设定，双方可发起调整，直属确认留痕</p>
      </div>

      {isLoading ? (
        <p className="text-[var(--text-muted)]">加载中...</p>
      ) : error ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
          <p className="text-sm text-[var(--accent-red)]">{(error as ApiError)?.message ?? '加载失败'}</p>
        </div>
      ) : !goal ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <p className="mb-3 text-sm text-[var(--text-muted)]">
            {isSelf ? '直属尚未为你设定本半年目标。' : '尚未为该员工设定本半年目标。'}
          </p>
          {!isSelf && (
            <div className="space-y-2">
              <textarea
                className={textarea}
                rows={4}
                placeholder="填写本半年目标..."
                value={setText}
                onChange={(e) => setSetText(e.target.value)}
              />
              <button className={btn} disabled={busy || !setText.trim()} onClick={doSet}>
                设定目标
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 正式目标 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <p className="mb-2 text-sm text-[var(--text-muted)]">当前目标</p>
            <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{goal.content ?? '（空）'}</p>
          </div>

          {/* 待确认的调整建议 */}
          {goal.proposedAt && (
            <div className="rounded-2xl border border-[var(--accent-orange)]/40 bg-[var(--accent-orange)]/5 p-6">
              <p className="mb-2 text-sm font-medium text-[var(--accent-orange)]">待确认的调整建议</p>
              <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{goal.proposedContent}</p>
              {isSelf ? (
                <p className="mt-3 text-xs text-[var(--text-muted)]">已提交，等待直属确认。</p>
              ) : (
                <div className="mt-4 flex gap-2">
                  <button className={btn} disabled={busy} onClick={() => doConfirm(goal.goalUid, true)}>
                    接受调整
                  </button>
                  <button className={ghostBtn} disabled={busy} onClick={() => doConfirm(goal.goalUid, false)}>
                    驳回
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 本人发起调整 */}
          {isSelf && !goal.proposedAt && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
              <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">发起目标调整建议</p>
              <textarea
                className={textarea}
                rows={4}
                placeholder="说明你希望如何调整本半年目标..."
                value={proposeText}
                onChange={(e) => setProposeText(e.target.value)}
              />
              <button
                className={`${btn} mt-2`}
                disabled={busy || !proposeText.trim()}
                onClick={() => doPropose(goal.goalUid)}
              >
                提交建议
              </button>
            </div>
          )}

          {/* 调整记录 */}
          <GoalRevisions goalUid={goal.goalUid} enabled={authed} />
        </div>
      )}
    </div>
  );
}

function GoalRevisions({ goalUid, enabled }: { goalUid: string; enabled: boolean }) {
  const { data } = useSWR<GoalRevision[]>(
    enabled ? `/api/v1/quarter/goals/${goalUid}/revisions` : null,
    (url: string) => apiFetch<GoalRevision[]>(url),
  );
  if (!data?.length) return null;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">调整记录</h3>
      <div className="space-y-3">
        {data.map((r) => (
          <div key={r.revisionUid} className="rounded-xl bg-[var(--bg-surface)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                {new Date(r.createdAt).toLocaleDateString('zh-CN')}
              </span>
              {r.reason && <span className="text-xs text-[var(--text-secondary)]">{r.reason}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MyGoalsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      }
    >
      <MyGoalsContent />
    </Suspense>
  );
}
