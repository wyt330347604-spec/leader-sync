'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';

// ── 类型（后端 my-tasks/cycles 返回 camelCase 普通对象 + drizzle 行）─────────
interface MyTaskItem {
  sheetUid: string;
  taskUid: string;
  rateeName: string;
  raterRole: 'self' | 'peer' | 'manager' | 'management';
  status: string;
  stage: string;
  quarter: string | null;
  locked: boolean;
  lockReason: string | null;
}
type MyTasks = Record<string, MyTaskItem[]>;

interface CycleProgress {
  byStage: Record<string, number>;
  enrolled: number;
  skipped: number;
  total: number;
}
interface CycleRow {
  cycleUid: string;
  quarter: string;
  status: string;
  openAt: string | null;
  progress?: CycleProgress;
}
interface CyclesData {
  items: CycleRow[];
  canManage: boolean;
}
interface CycleTask {
  taskUid: string;
  rateeName: string;
  sheetType: string;
  stage: string;
  enrolled: boolean;
  skipReason: string | null;
  mgmtRequired: boolean;
  selfSkipped: boolean;
  peerAssigned: boolean;
}
interface CycleDetail {
  cycle: CycleRow;
  progress: CycleProgress;
  canManage: boolean;
  tasks: CycleTask[];
}

const GROUP_META: { key: string; title: string; hint?: string }[] = [
  { key: 'self', title: '我的自评', hint: '仅作参照、不计分' },
  { key: 'peer', title: '同事互评' },
  { key: 'manager', title: '下属评分' },
  { key: 'management', title: '管理层评分', hint: '排除名单自动生效' },
];

const GRADE_STYLE: Record<string, string> = {
  S: 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/10 text-[var(--accent-green)]',
  A: 'border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]',
  B: 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
  C: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  D: 'border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 text-[var(--accent-red)]',
};

interface MyResultData {
  result: {
    resultUid: string;
    total: number | null;
    grade: string | null;
    appealDeadlineAt: string | null;
  } | null;
  canAppeal?: boolean;
}

// 本人「我的成绩」卡（published 后显示总分/评级 + 查看详情/申诉入口）。
function MyScoreCard({ cycleUid, quarter }: { cycleUid: string; quarter: string }) {
  const { data } = useSWR<MyResultData>(
    `/api/v1/quarter/my-result?cycle=${cycleUid}`,
    (url: string) => apiFetch<MyResultData>(url),
    { shouldRetryOnError: false }, // 未公示时后端 403，不重试、不报错
  );
  const r = data?.result;
  if (!r) return null;
  return (
    <Link
      href={`/quarter/result/${r.resultUid}`}
      className="block rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-all hover:border-[var(--accent-blue)]/50"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--text-muted)]">{quarter} 我的成绩</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--text-primary)]">{r.total ?? '-'}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {r.grade && (
            <span className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-base font-bold ${GRADE_STYLE[r.grade] ?? GRADE_STYLE.B}`}>
              {r.grade}
            </span>
          )}
          <span className="text-xs text-[var(--accent-blue)]">查看详情 / 申诉 →</span>
        </div>
      </div>
      {data?.canAppeal && r.appealDeadlineAt && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">申诉截止：{new Date(r.appealDeadlineAt).toLocaleDateString('zh-CN')}</p>
      )}
    </Link>
  );
}

const STAGE_LABEL: Record<string, string> = {
  pending_self: '待自评',
  pending_peer_manager: '待同事/直属',
  pending_mgmt: '待管理层',
  scored: '已完成',
};

const STAGE_COLOR: Record<string, string> = {
  pending_self: 'var(--text-muted)',
  pending_peer_manager: 'var(--accent-blue)',
  pending_mgmt: '#a855f7',
  scored: 'var(--accent-green)',
};

function TaskCard({ item }: { item: MyTaskItem }) {
  const submitted = item.status === 'submitted';
  if (item.locked) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 opacity-70">
        <div className="flex items-center justify-between">
          <p className="font-medium text-[var(--text-secondary)]">{item.rateeName}</p>
          <span className="text-xs text-[var(--text-muted)]">{item.quarter}</span>
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">🔒 {item.lockReason ?? '当前环节未解锁'}</p>
      </div>
    );
  }
  return (
    <Link
      href={`/quarter/sheet/${item.sheetUid}`}
      className="block rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition-all hover:border-[var(--accent-blue)]/50 hover:bg-[var(--bg-hover)]"
    >
      <div className="flex items-center justify-between">
        <p className="font-medium text-[var(--text-primary)]">{item.rateeName}</p>
        <span className="text-xs text-[var(--text-muted)]">{item.quarter}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        {submitted ? (
          <span className="rounded-full border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent-green)]">
            已提交
          </span>
        ) : (
          <span className="rounded-full border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent-blue)]">
            去打分 →
          </span>
        )}
      </div>
    </Link>
  );
}

function ProgressBar({ progress }: { progress: CycleProgress }) {
  const stages = ['pending_self', 'pending_peer_manager', 'pending_mgmt', 'scored'];
  const denom = progress.enrolled || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
        {stages.map((s) => {
          const n = progress.byStage[s] ?? 0;
          if (n === 0) return null;
          return <div key={s} style={{ width: `${(n / denom) * 100}%`, background: STAGE_COLOR[s] }} title={`${STAGE_LABEL[s]}: ${n}`} />;
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        {stages.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[s] }} />
            {STAGE_LABEL[s]} {progress.byStage[s] ?? 0}
          </span>
        ))}
        <span>参评 {progress.enrolled} · 免评 {progress.skipped}</span>
      </div>
    </div>
  );
}

function AdminCycleSection({ data, mutateCycles }: { data: CyclesData; mutateCycles: () => void }) {
  const [quarterInput, setQuarterInput] = useState('');
  const [opening, setOpening] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: detail } = useSWR<CycleDetail>(
    selected ? `/api/v1/quarter/cycles/${selected}` : null,
    (url: string) => apiFetch<CycleDetail>(url),
  );

  async function handleOpen() {
    if (!/^\d{4}-Q[1-4]$/.test(quarterInput)) {
      toast.error('季度格式应为 2026-Q3');
      return;
    }
    setOpening(true);
    try {
      const res = await apiFetch<{ taskCount: number }>(`/api/v1/quarter/cycles`, {
        method: 'POST',
        body: JSON.stringify({ quarter: quarterInput }),
      });
      toast.success(`已开周期 ${quarterInput}，生成 ${res.taskCount} 项考核任务`);
      setQuarterInput('');
      mutateCycles();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '开周期失败');
    } finally {
      setOpening(false);
    }
  }

  return (
    <section className="mt-10">
      <h3 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">周期管理</h3>

      {/* 开周期 */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <input
          value={quarterInput}
          onChange={(e) => setQuarterInput(e.target.value)}
          placeholder="2026-Q3"
          className="w-40 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
        />
        <button
          onClick={handleOpen}
          disabled={opening}
          className="rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
        >
          开周期
        </button>
        <span className="text-xs text-[var(--text-muted)]">季度结束后开窗；生成全员考核任务与打分表（幂等）</span>
      </div>

      {/* 周期列表 */}
      <div className="space-y-3">
        {data.items.length === 0 && <p className="text-sm text-[var(--text-muted)]">暂无周期</p>}
        {data.items.map((c) => (
          <div key={c.cycleUid} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-[var(--text-primary)]">{c.quarter}</span>
                <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                  {c.status}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/quarter/panel?cycle=${c.cycleUid}`}
                  className="text-xs text-[var(--accent-blue)] hover:underline"
                >
                  评分会看板 →
                </Link>
                <button
                  onClick={() => setSelected(selected === c.cycleUid ? null : c.cycleUid)}
                  className="text-xs text-[var(--accent-blue)] hover:underline"
                >
                  {selected === c.cycleUid ? '收起任务表 ▲' : '查看任务表 ▼'}
                </button>
              </div>
            </div>
            {c.progress && <div className="mt-3"><ProgressBar progress={c.progress} /></div>}

            {selected === c.cycleUid && detail && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--text-muted)]">
                      <th className="pb-2">被评人</th>
                      <th className="pb-2">类型</th>
                      <th className="pb-2">阶段</th>
                      <th className="pb-2">同事已指定</th>
                      <th className="pb-2">进管理层</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.tasks.map((t) => (
                      <tr key={t.taskUid} className="border-t border-[var(--border)]">
                        <td className="py-2 text-[var(--text-primary)]">{t.rateeName}</td>
                        <td className="py-2 text-[var(--text-secondary)]">{t.sheetType === 'leader' ? 'Leader' : '员工'}</td>
                        <td className="py-2">
                          {t.enrolled ? (
                            <span style={{ color: STAGE_COLOR[t.stage] }}>{STAGE_LABEL[t.stage] ?? t.stage}</span>
                          ) : (
                            <span className="text-[var(--text-muted)]">免评</span>
                          )}
                        </td>
                        <td className="py-2">{t.peerAssigned ? '✓' : <span className="text-[var(--text-muted)]">—</span>}</td>
                        <td className="py-2">{t.mgmtRequired ? '✓' : <span className="text-[var(--text-muted)]">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function QuarterContent() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data: myTasks } = useSWR<MyTasks>(
    authed ? '/api/v1/quarter/my-tasks' : null,
    (url: string) => apiFetch<MyTasks>(url),
  );
  const { data: cycles, mutate: mutateCycles } = useSWR<CyclesData>(
    authed ? '/api/v1/quarter/cycles' : null,
    (url: string) => apiFetch<CyclesData>(url),
  );

  if (!authed) return <LoadingScreen />;

  return (
    <div className="pb-16 pt-8">
      <h2 className="mb-6 text-3xl font-bold tracking-tight text-[var(--text-primary)]">季度考核</h2>

      {/* 我的待办 */}
      <section>
        <h3 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">我的待办</h3>
        {GROUP_META.map(({ key, title, hint }) => {
          const items = myTasks?.[key] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={key} className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-sm font-medium text-[var(--text-secondary)]">{title}</h4>
                <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{items.length}</span>
                {hint && <span className="text-xs text-[var(--text-muted)]">· {hint}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => (
                  <TaskCard key={it.sheetUid} item={it} />
                ))}
              </div>
            </div>
          );
        })}
        {myTasks && GROUP_META.every(({ key }) => (myTasks[key] ?? []).length === 0) && (
          <p className="text-sm text-[var(--text-muted)]">当前没有待办的打分任务</p>
        )}
      </section>

      {/* 我的成绩（published 后各卡自动出现；未公示时返回 null 不占位） */}
      {cycles && cycles.items.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cycles.items.map((c) => (
            <MyScoreCard key={c.cycleUid} cycleUid={c.cycleUid} quarter={c.quarter} />
          ))}
        </div>
      )}

      {/* 周期管理（管理角色） */}
      {cycles?.canManage && <AdminCycleSection data={cycles} mutateCycles={mutateCycles} />}
    </div>
  );
}

export default function QuarterPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <QuarterContent />
    </Suspense>
  );
}
