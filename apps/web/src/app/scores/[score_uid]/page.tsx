'use client';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { useMe } from '@/hooks/use-me';

// 后端返回 drizzle 原始行（camelCase）；历史接口/前端曾用 snake，双读兜底。
interface RawScore {
  [k: string]: unknown;
}

interface ScoreView {
  scoreUid: string;
  scoreMonth: string;
  rateeName: string;
  raterName: string;
  raterUserId: string;
  rateeUserId: string;
  score: number | null; // 旧单值 0–1
  status: string;
  version: number;
  templateUid: string | null;
  totalScore: number | null;
  composite: number | null;
  grade: string | null;
  redLine: boolean;
  redLineNote: string | null;
  challengeNote: string | null;
  challengedAt: string | null;
  resolvedAt: string | null;
  lockedAt: string | null;
}

interface DimensionAnchor {
  grade: string;
  range: string;
  desc: string;
}
interface TemplateDimension {
  code: string;
  name: string;
  description: string | null;
  weight: string; // numeric → string
  sort: number;
  anchors: DimensionAnchor[];
}
interface TemplateData {
  template: { templateUid: string; code: string };
  dimensions: TemplateDimension[];
}

interface DetailRow {
  dimensionCode?: string;
  dimension_code?: string;
  coefficient?: string;
}

interface ScoreContext {
  score: RawScore;
  snapshot: {
    doneRate: string;
    monthDoneCount: number;
    monthDueCount: number;
    monthOverdueCount: number;
    monthCarryOverCount: number;
  } | null;
  prevScore: { score: number | null; status: string; scoreMonth: string } | null;
  incidents: Array<{ incident_uid: string; title: string; severity: string }>;
  picProjects: Array<{ projectUid: string; name: string; category: string; region: string | null }>;
  details?: DetailRow[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: '待打分', className: 'text-[var(--text-muted)] bg-[var(--text-muted)]/10 border-[var(--text-muted)]/20' },
  scored: { label: '已打分', className: 'text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/20' },
  challenged: { label: '质疑中', className: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/30' },
  pending_lock: { label: '待锁定', className: 'text-[var(--st-not-started)] bg-[var(--st-not-started)]/10 border-[var(--st-not-started)]/20' },
  locked: { label: '已锁定', className: 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20' },
};

// 评级徽章配色（与 domain-core monthlyGrade 边界一致）。
const GRADE_CONFIG: Record<string, { className: string }> = {
  S: { className: 'text-[#a855f7] bg-[#a855f7]/10 border-[#a855f7]/30' },
  A: { className: 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/30' },
  B: { className: 'text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/30' },
  C: { className: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30' },
  D: { className: 'text-[var(--accent-red)] bg-[var(--accent-red)]/10 border-[var(--accent-red)]/30' },
};

const COEFFICIENT_MAX = 5;

/** drizzle camelCase 优先、snake 兜底，读成稳定视图。数值 numeric 以字符串返回，parse 之。 */
function readScore(raw: RawScore): ScoreView {
  const g = (camel: string, snake: string): unknown => raw[camel] ?? raw[snake];
  const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    scoreUid: String(g('scoreUid', 'score_uid') ?? ''),
    scoreMonth: String(g('scoreMonth', 'score_month') ?? ''),
    rateeName: String(g('rateeName', 'ratee_name') ?? ''),
    raterName: String(g('raterName', 'rater_name') ?? ''),
    raterUserId: String(g('raterUserId', 'rater_user_id') ?? ''),
    rateeUserId: String(g('rateeUserId', 'ratee_user_id') ?? ''),
    score: num(raw.score),
    status: String(raw.status ?? 'draft'),
    version: Number(raw.version ?? 1),
    templateUid: (g('templateUid', 'template_uid') as string | null) ?? null,
    totalScore: num(g('totalScore', 'total_score')),
    composite: num(raw.composite),
    grade: (raw.grade as string | null) ?? null,
    redLine: Boolean(g('redLine', 'red_line')),
    redLineNote: (g('redLineNote', 'red_line_note') as string | null) ?? null,
    challengeNote: (g('challengeNote', 'challenge_note') as string | null) ?? null,
    challengedAt: (g('challengedAt', 'challenged_at') as string | null) ?? null,
    resolvedAt: (g('resolvedAt', 'resolved_at') as string | null) ?? null,
    lockedAt: (g('lockedAt', 'locked_at') as string | null) ?? null,
  };
}

/** 前端实时评级（与后端 monthlyGrade 边界一致）。 */
function computeGrade(total: number, redLine: boolean): string {
  if (redLine) return 'D';
  if (total > 100) return 'S';
  if (total >= 90) return 'A';
  if (total >= 80) return 'B';
  if (total >= 70) return 'C';
  return 'D';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function GradeBadge({ grade }: { grade: string }) {
  const cfg = GRADE_CONFIG[grade] ?? GRADE_CONFIG.D;
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border text-lg font-bold ${cfg.className}`}>
      {grade}
    </span>
  );
}

function DimensionCard({
  dim,
  value,
  onChange,
  disabled,
}: {
  dim: TemplateDimension;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [showAnchors, setShowAnchors] = useState(false);
  const weight = Number(dim.weight);
  const coeff = parseFloat(value);
  const weighted = Number.isFinite(coeff) ? round1(coeff * weight) : null;

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
          {dim.description && (
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{dim.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <input
            type="number"
            step="0.05"
            min="0"
            max={COEFFICIENT_MAX}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="平常 0.8–1.0，优异 1.5–2.0，不封顶"
            className="w-52 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-right text-sm text-[var(--text-primary)] placeholder:text-[10px] focus:border-[var(--accent-blue)] focus:outline-none disabled:opacity-60"
          />
          {weighted != null && (
            <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
              加权 {weighted}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowAnchors((s) => !s)}
        className="mt-3 text-xs text-[var(--accent-blue)] hover:underline"
      >
        {showAnchors ? '收起评分锚定 ▲' : '查看评分锚定 ▼'}
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

function ScoreDetailContent() {
  const router = useRouter();
  const params = useParams();
  const scoreUid = params.score_uid as string;
  const [authed, setAuthed] = useState(false);
  const [challengeNote, setChallengeNote] = useState('');
  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // V1.4 表单状态
  const [coeffs, setCoeffs] = useState<Record<string, string>>({});
  const [redLineChecked, setRedLineChecked] = useState(false);
  const [redLineNoteInput, setRedLineNoteInput] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data: me } = useMe();

  const { data: ctx, error, isLoading, mutate } = useSWR<ScoreContext>(
    authed && scoreUid ? `/api/v1/scores/${scoreUid}/context` : null,
    (url: string) => apiFetch<ScoreContext>(url),
  );

  const { data: template } = useSWR<TemplateData | null>(
    authed && scoreUid ? `/api/v1/scores/${scoreUid}/template` : null,
    (url: string) => apiFetch<TemplateData | null>(url),
  );

  const score = useMemo(() => (ctx?.score ? readScore(ctx.score) : null), [ctx]);
  const isV14 = Boolean(template && template.dimensions?.length);

  // 修改分数（challenged 再评）时用现有明细回填一次。
  useEffect(() => {
    if (prefilled || !isV14 || !ctx?.details?.length) return;
    const next: Record<string, string> = {};
    for (const d of ctx.details) {
      const code = d.dimensionCode ?? d.dimension_code;
      if (code && d.coefficient != null) next[code] = String(Number(d.coefficient));
    }
    if (Object.keys(next).length) {
      setCoeffs(next);
      setPrefilled(true);
    }
  }, [ctx, isV14, prefilled]);

  const isRater = Boolean(me && score && me.user_id === score.raterUserId);
  const canScoreV14 = isV14 && isRater && score && (score.status === 'draft' || score.status === 'challenged');
  const canChallenge = score?.status === 'scored' && !score.lockedAt;
  const canResolveLegacy = !isV14 && isRater && score?.status === 'challenged';
  const canLock = score && (score.status === 'scored' || score.status === 'pending_lock');
  const isLocked = score?.status === 'locked';

  // V1.4 实时汇总
  const liveTotal = useMemo(() => {
    if (!template) return 0;
    let sum = 0;
    for (const d of template.dimensions) {
      const c = parseFloat(coeffs[d.code]);
      if (Number.isFinite(c)) sum += c * Number(d.weight);
    }
    return round1(sum);
  }, [template, coeffs]);
  const liveComposite = Math.round((liveTotal / 100) * 100) / 100;
  const liveGrade = computeGrade(liveTotal, redLineChecked);

  const allCoeffsValid = useMemo(() => {
    if (!template) return false;
    return template.dimensions.every((d) => {
      const c = parseFloat(coeffs[d.code]);
      return Number.isFinite(c) && c > 0 && c <= COEFFICIENT_MAX;
    });
  }, [template, coeffs]);

  async function handleSubmitV14() {
    if (!score || !template) return;
    if (!allCoeffsValid) {
      toast.error(`每个维度系数需大于 0 且不超过 ${COEFFICIENT_MAX}`);
      return;
    }
    if (redLineChecked && !redLineNoteInput.trim()) {
      toast.error('勾选红线必须填写说明');
      return;
    }
    const body = {
      details: template.dimensions.map((d) => ({
        dimension_code: d.code,
        coefficient: parseFloat(coeffs[d.code]),
      })),
      red_line: redLineChecked,
      red_line_note: redLineChecked ? redLineNoteInput.trim() : undefined,
      version: score.version,
    };
    // 状态机不变：draft→scored 走 PATCH /score；challenged→pending_lock 走 POST /resolve。
    const isChallenged = score.status === 'challenged';
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/scores/${scoreUid}/${isChallenged ? 'resolve' : 'score'}`, {
        method: isChallenged ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      toast.success(isChallenged ? '已重新评分，进入待锁定' : '评分已提交');
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
            {score.rateeName} · {score.scoreMonth} 月度评分
          </h2>
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusCfg.className}`}>
            {statusCfg.label}
          </span>
          {isV14 && (
            <span className="rounded-full border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent-blue)]">
              V1.4 多维系数
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">打分人: {score.raterName}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Score operations */}
        <div className="space-y-5">
          {isV14 ? (
            canScoreV14 ? (
              /* ── V1.4 多维系数表单（rater 打分 / 修改） ── */
              <div className="space-y-4">
                {template!.dimensions.map((dim) => (
                  <DimensionCard
                    key={dim.code}
                    dim={dim}
                    value={coeffs[dim.code] ?? ''}
                    onChange={(v) => setCoeffs((prev) => ({ ...prev, [dim.code]: v }))}
                    disabled={submitting}
                  />
                ))}

                {/* 红线 */}
                <div className="rounded-2xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 p-5">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--accent-red)]">
                    <input
                      type="checkbox"
                      checked={redLineChecked}
                      onChange={(e) => setRedLineChecked(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent-red)]"
                    />
                    触发红线（一票否决，强制评级 D，建议开除）
                  </label>
                  {redLineChecked && (
                    <textarea
                      value={redLineNoteInput}
                      onChange={(e) => setRedLineNoteInput(e.target.value)}
                      placeholder="必填：红线事由（将通知 Boss / HR）"
                      rows={2}
                      className="mt-3 w-full resize-none rounded-xl border border-[var(--accent-red)]/30 bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-red)] focus:outline-none"
                    />
                  )}
                </div>

                {/* 实时汇总 + 提交 */}
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">总分 Σ(系数×权重)</p>
                        <p className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">{liveTotal}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">综合系数</p>
                        <p className="text-2xl font-semibold tabular-nums text-[var(--text-secondary)]">{liveComposite.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-[var(--text-muted)]">评级</p>
                        <GradeBadge grade={liveGrade} />
                      </div>
                    </div>
                    <button
                      onClick={handleSubmitV14}
                      disabled={submitting || !allCoeffsValid}
                      className="rounded-xl bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
                    >
                      {score.status === 'challenged' ? '重新评分' : '确认打分'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* ── V1.4 只读结果（非 rater 或已打分/锁定） ── */
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
                <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">评分结果</h3>
                {score.totalScore != null ? (
                  <>
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">总分</p>
                        <p className="text-4xl font-bold tabular-nums text-[var(--text-primary)]">{score.totalScore}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--text-muted)]">综合系数</p>
                        <p className="text-2xl font-semibold tabular-nums text-[var(--text-secondary)]">
                          {score.composite != null ? score.composite.toFixed(2) : '-'}
                        </p>
                      </div>
                      {score.grade && (
                        <div>
                          <p className="mb-1 text-xs text-[var(--text-muted)]">评级</p>
                          <GradeBadge grade={score.grade} />
                        </div>
                      )}
                    </div>
                    {/* 明细分解 */}
                    {ctx?.details && ctx.details.length > 0 && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
                        {ctx.details.map((d, i) => {
                          const code = d.dimensionCode ?? d.dimension_code ?? '';
                          const dim = template!.dimensions.find((x) => x.code === code);
                          return (
                            <div
                              key={code || i}
                              className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-sm ${
                                i < ctx.details!.length - 1 ? 'border-b border-[var(--border)]' : ''
                              }`}
                            >
                              <span className="text-[var(--text-primary)]">{dim?.name ?? code}</span>
                              <span className="text-xs text-[var(--text-muted)]">
                                系数 {d.coefficient != null ? Number(d.coefficient) : '-'} × 权重 {dim ? Number(dim.weight) : '-'}
                              </span>
                              <span className="tabular-nums font-medium text-[var(--text-secondary)]">
                                {dim && d.coefficient != null ? round1(Number(d.coefficient) * Number(dim.weight)) : '-'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {score.redLine && (
                      <div className="mt-4 rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 p-3">
                        <p className="text-sm font-medium text-[var(--accent-red)]">已触发红线（强制 D，建议开除）</p>
                        {score.redLineNote && <p className="mt-1 text-xs text-[var(--text-secondary)]">{score.redLineNote}</p>}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">尚未打分</p>
                )}
              </div>
            )
          ) : (
            /* ── 旧单值行：只读历史（不回填，不改口径 Harvey §10.5） ── */
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">评分（历史单系数）</h3>
                <span className="rounded-full border border-[var(--text-muted)]/30 bg-[var(--text-muted)]/10 px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                  只读
                </span>
              </div>
              <div className="mt-2 flex items-center gap-4">
                {score.score != null ? (
                  <span className="text-4xl font-bold tabular-nums text-[var(--text-primary)]">{score.score}</span>
                ) : (
                  <span className="text-lg text-[var(--text-muted)]">未评分</span>
                )}
                <span className="text-sm text-[var(--text-muted)]">/ 1.0</span>
              </div>
            </div>
          )}

          {/* Action buttons: 质疑 / 锁定（不动） */}
          {!isLocked && (canChallenge || canResolveLegacy || canLock) && (
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
          {score.challengeNote && (
            <div className="rounded-2xl border border-[#f97316]/20 bg-[#f97316]/5 p-5">
              <h3 className="mb-2 text-sm font-semibold text-[#f97316]">质疑记录</h3>
              <p className="text-sm text-[var(--text-secondary)]">{score.challengeNote}</p>
              {score.challengedAt && (
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  发起时间: {new Date(score.challengedAt).toLocaleDateString('zh-CN')}
                </p>
              )}
              {score.resolvedAt && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  响应时间: {new Date(score.resolvedAt).toLocaleDateString('zh-CN')}
                </p>
              )}
            </div>
          )}

          {/* Locked info */}
          {isLocked && score.lockedAt && (
            <div className="rounded-2xl border border-[var(--accent-green)]/20 bg-[var(--accent-green)]/8 p-5">
              <p className="text-sm text-[var(--accent-green)]">
                已于 {new Date(score.lockedAt).toLocaleDateString('zh-CN')} 最终锁定
              </p>
            </div>
          )}
        </div>

        {/* Right: Context panel（不动） */}
        <div className="space-y-4">
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
