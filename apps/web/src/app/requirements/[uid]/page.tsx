'use client';
import { useState, useEffect, useMemo, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { LoadingScreen } from '@/components/loading-screen';
import { useMe } from '@/hooks/use-me';
import { RequirementLinkTasksModal } from '@/components/requirement-link-tasks-modal';
import {
  useRequirement, updateRequirement, claimRequirement, linkRequirementTasks, addRequirementArtifact,
} from '@/hooks/use-requirements';
import {
  RequirementStatusOrder, RequirementStatusLabel, RequirementTransitions,
  RequirementSourceLabel, RequirementStatus,
} from '@leader-sync/shared-types';

const PM_ROLES = new Set(['pmo', 'boss', 'admin']);
const ARTIFACT_TYPES = [
  { value: 'prd', label: 'PRD' }, { value: 'tech_design', label: '技术设计' },
  { value: 'test_case', label: '测试用例' }, { value: 'accept_report', label: '验收报告' },
  { value: 'biz_confirm', label: '业务确认' }, { value: 'release_note', label: '上线公告' },
];

type Dir = 'forward' | 'back' | 'reject';
function classify(from: string, to: string): Dir {
  if (to === RequirementStatus.REJECTED) return 'reject';
  const i = RequirementStatusOrder.indexOf(from);
  const j = RequirementStatusOrder.indexOf(to);
  return j >= 0 && i >= 0 && j < i ? 'back' : 'forward';
}
const DIR_STYLE: Record<Dir, string> = {
  forward: 'bg-[var(--accent-green)] text-white',
  back: 'border border-[var(--accent-orange)] text-[var(--accent-orange)] hover:bg-[var(--accent-orange)]/10',
  reject: 'border border-[var(--accent-red)] text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10',
};
const DIR_PREFIX: Record<Dir, string> = { forward: '→ ', back: '↩ 退回·', reject: '✕ ' };

export default function RequirementDetailPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = use(params);
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const { data: me } = useMe();

  useEffect(() => { ensureAuth().then(setAuthed); }, []);
  const { data: req, isLoading, error, mutate } = useRequirement(authed ? uid : null);

  const isPM = useMemo(() => {
    if (!me) return false;
    if (PM_ROLES.has(me.role ?? '')) return true;
    return !!req?.pmUserId && (me.user_id === req.pmUserId || me.open_id === req.pmUserId);
  }, [me, req?.pmUserId]);

  const transitions = useMemo(() => {
    if (!req) return [];
    const tos = [...(RequirementTransitions[req.status] ?? [])];
    if (req.status !== RequirementStatus.REJECTED && !tos.includes(RequirementStatus.REJECTED)) tos.push(RequirementStatus.REJECTED);
    return tos.map((to) => ({ to, dir: classify(req.status, to) }));
  }, [req]);

  const run = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); await mutate(); toast.success(ok); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }, [mutate]);

  const transition = (to: string) => run(() => updateRequirement(uid, { status: to }), `已流转：${RequirementStatusLabel[to]}`);
  const claim = () => run(() => claimRequirement(uid), '已认领，进入分析');

  if (!authed || (isLoading && !req)) return <LoadingScreen />;
  if (error) return <div className="py-20 text-center text-[var(--accent-red)]">加载失败: {error.message}</div>;
  if (!req) return null;

  const curIdx = RequirementStatusOrder.indexOf(req.status);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-8">
      <button onClick={() => router.push('/requirements')} className="mb-4 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">← 返回需求池</button>

      {/* 头部 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${req.priority === 'P0' ? 'border-[var(--accent-red)]/40 text-[var(--accent-red)]' : 'border-[var(--border)] text-[var(--text-secondary)]'}`}>{req.priority}</span>
          <span className="rounded bg-[var(--accent-blue)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-blue)]">{RequirementStatusLabel[req.status]}</span>
          <span className="text-[11px] text-[var(--text-muted)]">{RequirementSourceLabel[req.source] ?? req.source}</span>
        </div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">{req.title}</h1>
        {req.value && <p className="mt-2 text-sm text-[var(--text-secondary)]">💡 {req.value}</p>}
        {req.description && <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{req.description}</p>}

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <Meta label="提出人" value={req.reporterName} />
          <Meta label="承接 PM" value={req.pmName ?? '待认领'} highlight={!req.pmName} />
          <Meta label="验收人" value={req.acceptorName ?? '—'} />
          <Meta label="期望上线" value={req.expectedReleaseDate ?? '—'} />
          <Meta label="预估工时" value={req.estEffortDays ? `${req.estEffortDays} 人天` : '—'} />
          <Meta label="目标版本" value={req.targetVersion ?? '—'} />
        </div>

        {!req.pmUserId && isPM && (
          <button onClick={claim} disabled={busy} className="mt-4 rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-medium text-white disabled:opacity-40">认领并开始分析</button>
        )}
        {!req.pmUserId && !isPM && (
          <p className="mt-4 text-xs text-[var(--accent-orange)]">需 PM（产品）认领收口后方可推进。</p>
        )}
      </div>

      {/* 状态机 stepper */}
      <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">流程进度</h2>
        <div className="flex flex-wrap gap-1.5">
          {RequirementStatusOrder.map((s, i) => (
            <span key={s} className={`rounded px-2 py-1 text-[11px] ${
              i < curIdx ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
              : i === curIdx ? 'bg-[var(--accent-blue)] text-white font-semibold'
              : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
            }`}>{RequirementStatusLabel[s]}</span>
          ))}
        </div>

        {transitions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
            {isPM ? transitions.map(({ to, dir }) => (
              <button key={to} onClick={() => transition(to)} disabled={busy}
                className={`rounded-full px-4 py-1.5 text-xs font-medium disabled:opacity-40 ${DIR_STYLE[dir]}`}>
                {DIR_PREFIX[dir]}{RequirementStatusLabel[to]}
              </button>
            )) : (
              <p className="text-xs text-[var(--text-muted)]">仅承接 PM / 管理员可流转状态。</p>
            )}
          </div>
        )}
      </section>

      {/* 任务分解 */}
      <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">任务分解 <span className="text-[var(--text-muted)]">({req.tasks.length})</span></h2>
          {isPM && <button onClick={() => setLinkOpen(true)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">+ 挂载任务</button>}
        </div>
        {req.tasks.length === 0 ? (
          <p className="py-3 text-center text-xs text-[var(--text-muted)]">尚未拆解任务</p>
        ) : (
          <div className="space-y-1.5">
            {req.tasks.map((t) => (
              <div key={t.taskUid} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{t.title}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{t.assigneeName}</span>
                {t.estEffortDays && <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">{t.estEffortDays}人天</span>}
                {t.allocationPct != null && <span className="shrink-0 text-[11px] text-[var(--accent-blue)]">{t.allocationPct}%</span>}
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">{t.progressPercent ?? 0}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 产出物 */}
      <ArtifactSection req={req} isPM={isPM} onAdd={(a) => run(() => addRequirementArtifact(uid, a), '已添加产出物')} busy={busy} />

      <RequirementLinkTasksModal
        open={linkOpen}
        requirementUid={uid}
        submitting={busy}
        onClose={() => setLinkOpen(false)}
        onSubmit={async (taskUids, effort, alloc) => {
          await run(() => linkRequirementTasks(uid, taskUids, effort, alloc), '已挂载任务');
          setLinkOpen(false);
        }}
      />
    </div>
  );
}

function Meta({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[var(--text-muted)]">{label}</div>
      <div className={highlight ? 'text-[var(--accent-orange)]' : 'text-[var(--text-primary)]'}>{value}</div>
    </div>
  );
}

function ArtifactSection({
  req, isPM, onAdd, busy,
}: {
  req: { artifacts: readonly { id: number; type: string; title: string; url: string | null }[] };
  isPM: boolean;
  onAdd: (a: { type: string; title: string; url?: string }) => void;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('prd');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const submit = () => {
    if (!title.trim()) return;
    onAdd({ type, title: title.trim(), url: url.trim() || undefined });
    setTitle(''); setUrl(''); setAdding(false);
  };
  const typeLabel = (t: string) => ARTIFACT_TYPES.find((x) => x.value === t)?.label ?? t;
  return (
    <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">产出物 <span className="text-[var(--text-muted)]">({req.artifacts.length})</span></h2>
        {isPM && <button onClick={() => setAdding((v) => !v)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">+ 添加</button>}
      </div>
      {req.artifacts.length === 0 && !adding && <p className="py-3 text-center text-xs text-[var(--text-muted)]">暂无 PRD / 设计 / 验收等留痕</p>}
      <div className="space-y-1.5">
        {req.artifacts.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
            <span className="rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{typeLabel(a.type)}</span>
            {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-[var(--accent-blue)] hover:underline">{a.title}</a>
              : <span className="truncate text-[var(--text-primary)]">{a.title}</span>}
          </div>
        ))}
      </div>
      {adding && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <div className="flex gap-2">
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-2 text-sm text-[var(--text-primary)]">
              {ARTIFACT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]" />
          </div>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="链接（可选）" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]" />
          <button onClick={submit} disabled={busy || !title.trim()} className="rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40">保存</button>
        </div>
      )}
    </section>
  );
}
