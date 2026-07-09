'use client';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';

// ── 类型 ────────────────────────────────────────────────────────────────────
interface Anchor {
  grade: string;
  range: string;
  desc: string;
}
interface Dimension {
  code: string;
  name: string;
  description: string | null;
  weight: string;
  sort: number;
  anchors: Anchor[];
}
interface TemplateData {
  template: { templateUid: string; code: string; goalWeight: number | null };
  dimensions: Dimension[];
}
interface ItemRow {
  dimensionCode?: string;
  dimension_code?: string;
  dimensionName?: string | null;
  dimension_name?: string | null;
  raw?: number;
  weight?: string;
  weighted?: string;
}
interface MonthlyBaseline {
  scoreMonth: string;
  score: string | null;
  totalScore: string | null;
  grade: string | null;
  challengeNote: string | null;
  status: string;
}
interface SheetResponse {
  sheet: Record<string, unknown>;
  task: Record<string, unknown> | null;
  raterRole: 'self' | 'manager' | 'peer' | 'management';
  locked: boolean;
  notScored: boolean;
  template: TemplateData | null;
  items: ItemRow[];
  context?: {
    quarter: string | null;
    monthlyBaselines: MonthlyBaseline[];
    goal: { content: string | null } | null;
    selfReference: ItemRow[] | null;
    incidents: Array<{ incidentUid: string; title: string; severity: string }>;
  };
}

const ROLE_LABEL: Record<string, string> = {
  self: '自评',
  manager: '直属评分',
  peer: '同事评分',
  management: '管理层评分',
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 1–10 分段按钮
function ScoreSegments({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`h-9 w-9 rounded-lg border text-sm font-medium tabular-nums transition-all disabled:opacity-50 ${
            value === n
              ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
              : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/50'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function DimensionCard({
  dim,
  value,
  onChange,
  disabled,
}: {
  dim: Dimension;
  value: number | null;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const [showAnchors, setShowAnchors] = useState(false);
  const weight = Number(dim.weight);
  const itemScore = value != null ? round1((value / 10) * weight) : null;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-[var(--text-primary)]">{dim.name}</h4>
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
              权重 {weight}
            </span>
          </div>
          {dim.description && <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{dim.description}</p>}
        </div>
        {itemScore != null && (
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-[var(--text-muted)]">单项得分</p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{itemScore}</p>
          </div>
        )}
      </div>

      <div className="mt-3">
        <ScoreSegments value={value} onChange={onChange} disabled={disabled} />
      </div>

      <button
        type="button"
        onClick={() => setShowAnchors((s) => !s)}
        className="mt-3 text-xs text-[var(--accent-blue)] hover:underline"
      >
        {showAnchors ? '收起评分锚定 ▲' : '查看评分锚定（S/A/B/C/D）▼'}
      </button>
      {showAnchors && (
        <div className="mt-2 overflow-hidden rounded-xl border border-[var(--border)]">
          {dim.anchors.map((a, i) => (
            <div
              key={`${a.grade}-${i}`}
              className={`grid grid-cols-[auto_auto_1fr] items-start gap-3 px-3 py-2 text-xs ${
                i < dim.anchors.length - 1 ? 'border-b border-[var(--border)]' : ''
              }`}
            >
              <span className="font-bold text-[var(--text-primary)]">{a.grade}</span>
              <span className="tabular-nums text-[var(--text-muted)]">{a.range}</span>
              <span className="text-[var(--text-secondary)]">{a.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ManagerSidebar({ ctx }: { ctx: NonNullable<SheetResponse['context']> }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">周期内月度底稿</h3>
        {ctx.monthlyBaselines.length > 0 ? (
          <div className="space-y-2">
            {ctx.monthlyBaselines.map((m) => (
              <div key={m.scoreMonth} className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-muted)]">{m.scoreMonth}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums font-medium text-[var(--text-primary)]">
                    {m.totalScore ?? m.score ?? '-'}
                  </span>
                  {m.grade && <span className="text-xs font-bold text-[var(--text-secondary)]">{m.grade}</span>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">暂无月度底稿</p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">半年目标</h3>
        <p className="text-sm text-[var(--text-secondary)]">{ctx.goal?.content || '未设定'}</p>
      </div>

      {ctx.selfReference && ctx.selfReference.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">自评参照</h3>
          <div className="space-y-1 text-sm">
            {ctx.selfReference.map((it, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">{it.dimensionName ?? it.dimensionCode ?? it.dimension_code}</span>
                <span className="tabular-nums text-[var(--text-secondary)]">{it.raw ?? '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">关联事故</h3>
        {ctx.incidents.length > 0 ? (
          <div className="space-y-1.5">
            {ctx.incidents.map((inc) => (
              <div key={inc.incidentUid} className="flex items-center gap-2 text-sm">
                <span className="shrink-0 rounded-full border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent-red)]">
                  {inc.severity}
                </span>
                <span className="truncate text-[var(--text-primary)]">{inc.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">暂无关联事故</p>
        )}
      </div>
    </div>
  );
}

function firstStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && v !== '') return String(v);
  }
  return '';
}

function SheetContent() {
  const router = useRouter();
  const params = useParams();
  const sheetUid = params.sheet_uid as string;
  const [authed, setAuthed] = useState(false);
  const [raws, setRaws] = useState<Record<string, number>>({});
  const [goalScore, setGoalScore] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading, mutate } = useSWR<SheetResponse>(
    authed && sheetUid ? `/api/v1/quarter/sheets/${sheetUid}` : null,
    (url: string) => apiFetch<SheetResponse>(url),
  );

  const dims = data?.template?.dimensions ?? [];
  const isSubmitted = data ? firstStr(data.sheet, 'status') === 'submitted' : false;
  const isManager = data?.raterRole === 'manager';
  const goalWeight = data?.template?.template.goalWeight ?? null;
  const version = data ? Number(data.sheet.version ?? 1) : 1;

  // 已填明细回填（重开草稿时）
  useEffect(() => {
    if (prefilled || !data?.items?.length) return;
    const next: Record<string, number> = {};
    for (const it of data.items) {
      const code = it.dimensionCode ?? it.dimension_code;
      if (code && it.raw != null) next[code] = Number(it.raw);
    }
    if (Object.keys(next).length) {
      setRaws(next);
      const gs = data.sheet.goalScore ?? (data.sheet as Record<string, unknown>).goal_score;
      if (gs != null) setGoalScore(String(Number(gs)));
      setPrefilled(true);
    }
  }, [data, prefilled]);

  const softSubtotal = useMemo(() => {
    let sum = 0;
    for (const d of dims) {
      const r = raws[d.code];
      if (r) sum += (r / 10) * Number(d.weight);
    }
    return round1(sum);
  }, [dims, raws]);

  const allScored = dims.length > 0 && dims.every((d) => raws[d.code] >= 1 && raws[d.code] <= 10);
  const goalValid = !isManager || (goalScore !== '' && Number(goalScore) >= 0 && Number(goalScore) <= (goalWeight ?? 0));
  const canSubmit = allScored && goalValid && !isSubmitted && !submitting;

  async function doSubmit() {
    if (!data) return;
    const body: Record<string, unknown> = {
      items: dims.map((d) => ({ dimension_code: d.code, raw: raws[d.code] })),
      version,
    };
    if (isManager) body.goal_score = Number(goalScore);
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/quarter/sheets/${sheetUid}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success('打分已提交');
      setConfirmOpen(false);
      mutate();
    } catch (err) {
      if (err instanceof ApiError && err.code === 1009) {
        toast.error('版本冲突，请刷新后重试');
        mutate();
      } else {
        toast.error(err instanceof ApiError ? err.message : '提交失败');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!authed) return <LoadingScreen />;
  if (isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>;
  }
  if (error) {
    // 门控锁定时后端返回 403
    return (
      <div className="pb-16 pt-8">
        <button onClick={() => router.back()} className="mb-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">← 返回</button>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
          <p className="text-lg font-medium text-[var(--text-primary)]">🔒 当前无法打分</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{(error as ApiError)?.message ?? '当前环节未解锁或无权限'}</p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const rateeName = data.task ? firstStr(data.task, 'rateeName', 'ratee_name') : '';
  const quarter = data.context?.quarter ?? '';

  return (
    <div className="pb-16 pt-8">
      <button onClick={() => router.back()} className="mb-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        ← 返回季度考核
      </button>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {rateeName} · {quarter} 季度考核
          </h2>
          <span className="rounded-full border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent-blue)]">
            {ROLE_LABEL[data.raterRole] ?? data.raterRole}
          </span>
          {isSubmitted && (
            <span className="rounded-full border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent-green)]">
              已提交
            </span>
          )}
        </div>
        {data.notScored && (
          <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
            ℹ️ 自评仅作参照、不计入最终成绩。
          </p>
        )}
      </div>

      <div className={`grid gap-6 ${isManager ? 'lg:grid-cols-[1fr_340px]' : ''}`}>
        {/* 左：打分 */}
        <div className="space-y-4">
          {dims.map((d) => (
            <DimensionCard
              key={d.code}
              dim={d}
              value={raws[d.code] ?? null}
              onChange={(v) => setRaws((p) => ({ ...p, [d.code]: v }))}
              disabled={isSubmitted}
            />
          ))}

          {/* manager 目标达成 */}
          {isManager && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-[var(--text-primary)]">目标达成{data.task && firstStr(data.task, 'sheetType', 'sheet_type') === 'leader' ? '（团队结果）' : ''}</h4>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">满分 {goalWeight ?? '-'}，仅直属评分</p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={goalWeight ?? undefined}
                  step="0.5"
                  value={goalScore}
                  disabled={isSubmitted}
                  onChange={(e) => setGoalScore(e.target.value)}
                  placeholder={`0–${goalWeight ?? ''}`}
                  className="w-28 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-right text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>
          )}

          {/* 实时汇总 + 提交 */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-xs text-[var(--text-muted)]">软项小计</p>
                  <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">{softSubtotal}</p>
                </div>
                {isManager && (
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">目标达成</p>
                    <p className="text-2xl font-semibold tabular-nums text-[var(--text-secondary)]">
                      {goalScore !== '' ? Number(goalScore) : '-'}
                    </p>
                  </div>
                )}
              </div>
              {!isSubmitted && (
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canSubmit}
                  className="rounded-xl bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
                >
                  提交打分
                </button>
              )}
            </div>
            {!allScored && !isSubmitted && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">请为每个维度选择 1–10 分{isManager ? '，并填写目标达成分' : ''}</p>
            )}
          </div>
        </div>

        {/* 右：manager 侧栏 */}
        {isManager && data.context && <ManagerSidebar ctx={data.context} />}
      </div>

      {/* 提交确认弹窗 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">确认提交？</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              软项小计 <span className="font-bold text-[var(--text-primary)]">{softSubtotal}</span>
              {isManager && <>，目标达成 <span className="font-bold text-[var(--text-primary)]">{goalScore}</span></>}
              。提交后不可修改。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                取消
              </button>
              <button
                onClick={doSubmit}
                disabled={submitting}
                className="rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
              >
                确认提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QuarterSheetPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <SheetContent />
    </Suspense>
  );
}
