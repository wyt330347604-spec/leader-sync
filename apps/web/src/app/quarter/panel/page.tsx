'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';

// ── 类型 ──────────────────────────────────────────────────────────────────────
interface CycleRow { cycleUid: string; quarter: string; status: string }
interface CyclesData { items: CycleRow[]; canManage: boolean }

interface MgmtRaters {
  rule: string | null;
  excludedIds: string[];
  raterIds: string[];
  scores: { raterId: string; raterName: string | null; soft: number }[];
}
interface PanelResult {
  resultUid: string;
  goalScore: number | null;
  managerSoft: number | null;
  peerSoft: number | null;
  mgmtAvg: number | null;
  softMerged: number | null;
  total: number | null;
  grade: string | null;
  redLine: boolean;
  mgmtRaters: MgmtRaters | null;
  status: string;
}
interface PanelRow {
  taskUid: string;
  rateeUserId: string;
  rateeName: string | null;
  sheetType: string;
  stage: string;
  mgmtRequired: boolean;
  result: PanelResult | null;
}
interface PanelData {
  cycle: CycleRow;
  summary: {
    quarter: string;
    status: string;
    enrolledCount: number;
    scoredCount: number;
    computedCount: number;
    publishedCount: number;
  };
  distribution: {
    gradeCounts: Record<string, number>;
    buckets: { label: string; count: number }[];
  };
  rows: PanelRow[];
  managerAverages: { raterUserId: string; raterName: string | null; count: number; avgTotal: number }[];
  sList: PanelResult2[];
  dList: PanelResult2[];
}
interface PanelResult2 extends PanelResult {
  rateeName?: string | null;
}

const GRADE_STYLE: Record<string, string> = {
  S: 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/10 text-[var(--accent-green)]',
  A: 'border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]',
  B: 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
  C: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  D: 'border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 text-[var(--accent-red)]',
};
const GRADE_ORDER = ['S', 'A', 'B', 'C', 'D'];
const GRADE_BAR: Record<string, string> = {
  S: 'var(--accent-green)', A: 'var(--accent-blue)', B: 'var(--text-muted)', C: '#f59e0b', D: 'var(--accent-red)',
};

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-[var(--text-muted)]">-</span>;
  return (
    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 text-xs font-bold ${GRADE_STYLE[grade] ?? GRADE_STYLE.B}`}>
      {grade}
    </span>
  );
}

function mgmtTooltip(m: MgmtRaters | null): string {
  if (!m) return '无管理层评分';
  const parts = m.scores.map((s) => `${s.raterName ?? s.raterId}: ${s.soft}`);
  const head = m.rule === 'first_level_dept' ? '一级部门 leader 排除' : m.rule === 'manager_chain_fallback' ? '管理链排除' : '排除规则';
  return `${head}｜排除 ${m.excludedIds.length} 人\n参与：${parts.join('，') || '无'}`;
}

// ── 改分弹窗 ────────────────────────────────────────────────────────────────
function ReviseDialog({ row, onClose, onDone }: { row: PanelRow; onClose: () => void; onDone: () => void }) {
  const [field, setField] = useState<'goal_score' | 'soft_merged' | 'total' | 'grade'>('total');
  const [after, setAfter] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const r = row.result!;

  async function save() {
    if (!after.trim() || !reason.trim()) {
      toast.error('新值与原因均为必填');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/v1/quarter/results/${r.resultUid}`, {
        method: 'PATCH',
        body: JSON.stringify({ field, after: after.trim(), reason: reason.trim() }),
      });
      toast.success('已改分并留痕');
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '改分失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">评分会改分 · {row.rateeName}</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          当前：目标 {r.goalScore ?? '-'}｜软项合成 {r.softMerged ?? '-'}｜总分 {r.total ?? '-'}｜评级 {r.grade ?? '-'}
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">改动字段</label>
            <select
              value={field}
              onChange={(e) => setField(e.target.value as typeof field)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
            >
              <option value="goal_score">目标达成（重算总分/评级）</option>
              <option value="soft_merged">软项合成（重算总分/评级）</option>
              <option value="total">总分（仅记录）</option>
              <option value="grade">评级（仅记录）</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">新值{field === 'grade' ? '（S/A/B/C/D）' : ''}</label>
            <input
              value={after}
              onChange={(e) => setAfter(e.target.value)}
              placeholder={field === 'grade' ? 'A' : '如 86.5'}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">原因（必填，留痕）</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">取消</button>
          <button onClick={save} disabled={busy} className="rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-blue)]/90 disabled:opacity-50">保存改分</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, confirmText, onClose, onConfirm }: { title: string; body: string; confirmText: string; onClose: () => void; onConfirm: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">取消</button>
          <button
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            disabled={busy}
            className="rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelContent() {
  const searchParams = useSearchParams();
  const [authed, setAuthed] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<string | null>(searchParams.get('cycle'));
  const [revising, setRevising] = useState<PanelRow | null>(null);
  const [confirm, setConfirm] = useState<null | 'compute' | 'publish'>(null);

  useEffect(() => { ensureAuth().then(setAuthed); }, []);

  const { data: cycles } = useSWR<CyclesData>(
    authed ? '/api/v1/quarter/cycles' : null,
    (url: string) => apiFetch<CyclesData>(url),
  );

  // 默认选最新周期
  useEffect(() => {
    if (!selectedCycle && cycles?.items?.length) setSelectedCycle(cycles.items[0].cycleUid);
  }, [cycles, selectedCycle]);

  const { data, error, mutate } = useSWR<PanelData>(
    authed && selectedCycle ? `/api/v1/quarter/cycles/${selectedCycle}/panel` : null,
    (url: string) => apiFetch<PanelData>(url),
  );

  async function doCompute() {
    try {
      const res = await apiFetch<{ computed: number; scoredTotal: number }>(`/api/v1/quarter/cycles/${selectedCycle}/results/compute`, { method: 'POST' });
      toast.success(`已合成 ${res.computed} 人（可评分 ${res.scoredTotal}）`);
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '合成失败');
    } finally { setConfirm(null); }
  }
  async function doPublish() {
    try {
      const res = await apiFetch<{ published: number; appealDeadlineAt: string }>(`/api/v1/quarter/cycles/${selectedCycle}/publish`, { method: 'POST' });
      toast.success(`已公示 ${res.published} 人，申诉截止 ${new Date(res.appealDeadlineAt).toLocaleDateString('zh-CN')}`);
      mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '公示失败');
    } finally { setConfirm(null); }
  }

  if (!authed) return <LoadingScreen />;
  if (error) {
    return (
      <div className="pb-16 pt-8">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
          <p className="text-lg font-medium text-[var(--text-primary)]">无法查看评分会看板</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{(error as ApiError)?.message ?? '仅管理层 / boss / admin / hr 可见'}</p>
        </div>
      </div>
    );
  }

  const s = data?.summary;
  const published = s?.status === 'published' || s?.status === 'closed';

  return (
    <div className="pb-16 pt-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">评分会看板</h2>
        <select
          value={selectedCycle ?? ''}
          onChange={(e) => setSelectedCycle(e.target.value)}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
        >
          {cycles?.items?.map((c) => <option key={c.cycleUid} value={c.cycleUid}>{c.quarter}（{c.status}）</option>)}
        </select>
      </div>

      {!data ? (
        <p className="text-sm text-[var(--text-muted)]">加载中...</p>
      ) : (
        <>
          {/* 汇总条 */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_2fr]">
            <Stat label="参评人数" value={s!.enrolledCount} />
            <Stat label="已完成打分" value={s!.scoredCount} />
            <Stat label="已合成" value={s!.computedCount} />
            <Stat label="已公示" value={s!.publishedCount} />
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <p className="mb-2 text-xs text-[var(--text-muted)]">评级分布（S–D）</p>
              <div className="flex items-end gap-2">
                {GRADE_ORDER.map((g) => {
                  const n = data.distribution.gradeCounts[g] ?? 0;
                  const max = Math.max(1, ...GRADE_ORDER.map((x) => data.distribution.gradeCounts[x] ?? 0));
                  return (
                    <div key={g} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs tabular-nums text-[var(--text-secondary)]">{n}</span>
                      <div className="w-full rounded-t" style={{ height: `${8 + (n / max) * 40}px`, background: GRADE_BAR[g] }} />
                      <span className="text-[11px] font-bold text-[var(--text-muted)]">{g}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 操作 */}
          {cycles?.canManage && (
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <button onClick={() => setConfirm('compute')} className="rounded-xl border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 px-4 py-2 text-sm font-medium text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20">批量合成</button>
              <button onClick={() => setConfirm('publish')} disabled={published} className="rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-blue)]/90 disabled:opacity-50">{published ? '已公示' : '公示出分'}</button>
              <span className="text-xs text-[var(--text-muted)]">先「批量合成」生成草稿，评分会改分后再「公示出分」（申诉期 +3 工作日）</span>
            </div>
          )}

          {/* 被评人表格 */}
          <div className="mb-8 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-4 py-3">被评人</th>
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3 text-right">目标</th>
                  <th className="px-4 py-3 text-right">直属软项</th>
                  <th className="px-4 py-3 text-right">同事软项</th>
                  <th className="px-4 py-3 text-right">管理层均值</th>
                  <th className="px-4 py-3 text-right">软项合成</th>
                  <th className="px-4 py-3 text-right">总分</th>
                  <th className="px-4 py-3 text-center">评级</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const r = row.result;
                  return (
                    <tr key={row.taskUid} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3 text-[var(--text-primary)]">{row.rateeName}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{row.sheetType === 'leader' ? 'Leader' : '员工'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">{r?.goalScore ?? '-'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">{r?.managerSoft ?? '-'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">{r?.peerSoft ?? '-'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]" title={mgmtTooltip(r?.mgmtRaters ?? null)}>
                        {r?.mgmtAvg ?? (row.mgmtRequired ? '—' : 'N/A')}
                        {r?.mgmtRaters && r.mgmtRaters.scores.length > 0 && <span className="ml-1 cursor-help text-[10px] text-[var(--accent-blue)]">ⓘ</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">{r?.softMerged ?? '-'}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--text-primary)]">{r?.total ?? '-'}</td>
                      <td className="px-4 py-3 text-center"><GradeBadge grade={r?.grade ?? null} /></td>
                      <td className="px-4 py-3 text-right">
                        {r ? (
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/quarter/result/${r.resultUid}`} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">详情</Link>
                            {cycles?.canManage && r.status === 'draft' && (
                              <button onClick={() => setRevising(row)} className="text-xs text-[var(--accent-blue)] hover:underline">改分</button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">{row.stage === 'scored' ? '待合成' : '打分中'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* S / D 下钻 + leader 对比 */}
          <div className="grid gap-6 lg:grid-cols-3">
            <DrillCard title="S 名单（逐个过事实）" items={data.sList} accent="var(--accent-green)" />
            <DrillCard title="D 名单（逐个过去留）" items={data.dList} accent="var(--accent-red)" />
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">各直属打分均值对比</h3>
              {data.managerAverages.length > 0 ? (
                <div className="space-y-2">
                  {[...data.managerAverages].sort((a, b) => b.avgTotal - a.avgTotal).map((m) => (
                    <div key={m.raterUserId} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{m.raterName ?? m.raterUserId}<span className="ml-1 text-xs text-[var(--text-muted)]">×{m.count}</span></span>
                      <span className="tabular-nums font-medium text-[var(--text-primary)]">{m.avgTotal}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-[var(--text-muted)]">暂无直属打分</p>}
            </div>
          </div>
        </>
      )}

      {revising && <ReviseDialog row={revising} onClose={() => setRevising(null)} onDone={mutate} />}
      {confirm === 'compute' && <ConfirmDialog title="批量合成" body="将对全部已完成打分的被评人生成/刷新合成结果（草稿）。已公示者不受影响。" confirmText="确认合成" onClose={() => setConfirm(null)} onConfirm={doCompute} />}
      {confirm === 'publish' && <ConfirmDialog title="公示出分" body="将公示全部草稿结果并通知本人，申诉期为公示后 3 个工作日。公示后不可再改分。" confirmText="确认公示" onClose={() => setConfirm(null)} onConfirm={doPublish} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function DrillCard({ title, items, accent }: { title: string; items: PanelResult2[]; accent: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h3 className="mb-3 text-sm font-semibold" style={{ color: accent }}>{title}</h3>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((r) => (
            <Link key={r.resultUid} href={`/quarter/result/${r.resultUid}`} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm hover:border-[var(--accent-blue)]/50">
              <span className="text-[var(--text-primary)]">{r.rateeName ?? '-'}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-[var(--text-secondary)]">{r.total ?? '-'}</span>
                <GradeBadge grade={r.grade} />
              </span>
            </Link>
          ))}
        </div>
      ) : <p className="text-sm text-[var(--text-muted)]">暂无</p>}
    </div>
  );
}

export default function QuarterPanelPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <PanelContent />
    </Suspense>
  );
}
