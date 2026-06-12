'use client';
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { LoadingScreen } from '@/components/loading-screen';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DashboardTabBar } from '@/components/dashboard-tab-bar';
import { RequirementCard } from '@/components/requirement-card';
import { RequirementFormModal } from '@/components/requirement-form-modal';
import { RequirementImpactPreview } from '@/components/requirement-impact-preview';
import { RequirementGantt } from '@/components/requirement-gantt';
import { CapacityGantt } from '@/components/capacity-gantt';
import { useProjects } from '@/hooks/use-projects';
import { useMe } from '@/hooks/use-me';
import {
  useRequirements, useRequirementGantt, useCapacity,
  createRequirement, type CreateRequirementInput, type Requirement,
} from '@/hooks/use-requirements';
import {
  RequirementStatusOrder, RequirementStatusLabel, RequirementStatusMeta, RequirementPriority,
} from '@leader-sync/shared-types';

/** 看板列按阶段分组，给 12 个状态一个“从左到右的流水线”语义。 */
const PHASE_OF: Record<string, string> = {
  collected: '收口', analyzing: '评审', req_review: '评审', tech_review: '评审',
  scheduled: '研发', developing: '研发', testing: '研发',
  product_accept: '验收上线', tech_release: '验收上线', biz_accept: '验收上线', released: '验收上线',
  retro: '复盘',
};

function RequirementsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [authed, setAuthed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [view, setView] = useState<'kanban' | 'req_gantt' | 'capacity'>('kanban');
  const [businessLineUid, setBusinessLineUid] = useState<string>(params.get('business_line') ?? '');
  // app 过滤纯 URL 驱动：直接读 params（reactive），避免冻结在挂载值导致深链/客户端跳转后过滤不更新
  const appProjectUid = params.get('app') ?? '';
  const [priority, setPriority] = useState<string>('');

  const { data: me } = useMe();
  const isPM = ['pmo', 'boss', 'admin'].includes(me?.role ?? '');

  useEffect(() => { ensureAuth().then(setAuthed); }, []);

  const { businessLines, data: projects } = useProjects(authed);
  const filter = useMemo(
    () => ({ businessLineUid: businessLineUid || undefined, appProjectUid: appProjectUid || undefined, priority: priority || undefined }),
    [businessLineUid, appProjectUid, priority],
  );
  const { data: requirements, isLoading, error, mutate } = useRequirements(filter, authed);
  const ganttFilter = useMemo(() => ({ businessLineUid: businessLineUid || undefined, appProjectUid: appProjectUid || undefined }), [businessLineUid, appProjectUid]);
  const { data: ganttReqs, isLoading: ganttLoading } = useRequirementGantt(ganttFilter, authed && view === 'req_gantt');
  const { data: capacity, isLoading: capLoading } = useCapacity(authed && view === 'capacity' && isPM);

  const projectNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) m.set(p.projectUid, p.name);
    return m;
  }, [projects]);

  const byStatus = useMemo(() => {
    const m = new Map<string, Requirement[]>();
    for (const s of RequirementStatusOrder) m.set(s, []);
    for (const r of requirements ?? []) {
      if (m.has(r.status)) m.get(r.status)!.push(r);
    }
    return m;
  }, [requirements]);

  const stats = useMemo(() => {
    const list = requirements ?? [];
    return {
      total: list.length,
      unclaimed: list.filter((r) => !r.pmUserId).length,
      p0: list.filter((r) => r.priority === 'P0').length,
    };
  }, [requirements]);

  const lineOptions: ComboboxOption[] = useMemo(
    () => [{ value: '', label: '全部业务线' }, ...businessLines.map((b) => ({ value: b.projectUid, label: b.name }))],
    [businessLines],
  );
  const priorityOptions: ComboboxOption[] = [
    { value: '', label: '全部优先级' },
    ...Object.values(RequirementPriority).map((p) => ({ value: p, label: p })),
  ];

  const handleCreate = useCallback(async (input: CreateRequirementInput) => {
    setSubmitting(true);
    try {
      await createRequirement(input);
      setModalOpen(false);
      await mutate();
      toast.success('需求已提交，进入需求池待 PM 收口');
    } catch (err: unknown) {
      toast.error(`提交失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }, [mutate]);

  const openDetail = useCallback((uid: string) => router.push(`/requirements/${uid}`), [router]);

  if (!authed) return <LoadingScreen />;

  return (
    <div className="pb-16 pt-8 max-w-[1400px] mx-auto px-4">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">需求池</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {stats.total} 条需求 · <span className="text-[var(--accent-orange)]">{stats.unclaimed} 待认领</span> · <span className="text-[var(--accent-red)]">{stats.p0} 个 P0</span>
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + 提需求
        </button>
      </div>

      {/* 流程说明：默认折叠，点开即看到「状态→负责人→这步干什么」，解决“看不懂流程”。 */}
      <details className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          需求流程说明 · 谁负责 / 下一步做什么（点开）
        </summary>
        <div className="border-t border-[var(--border)] px-4 py-3">
          <p className="mb-2 text-xs text-[var(--text-muted)]">
            任何人都可提需求 → 进「收集」列等 PM 认领收口 → 依次走评审 / 研发 / 验收上线 / 复盘。带 <span className="text-[var(--accent-orange)]">⚑</span> 的是评审/验收闸门，不通过会退回上一步；驳回可记原因并重开。仅 PM / 管理员可推进状态。
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {RequirementStatusOrder.map((s) => (
              <div key={s} className="flex items-baseline gap-2 text-[11px]">
                <span className="w-16 shrink-0 font-medium text-[var(--text-primary)]">
                  {RequirementStatusMeta[s]?.gate && <span className="text-[var(--accent-orange)]">⚑</span>}{RequirementStatusLabel[s]}
                </span>
                <span className="text-[var(--accent-blue)]">{RequirementStatusMeta[s]?.owner}</span>
                <span className="truncate text-[var(--text-muted)]">{RequirementStatusMeta[s]?.hint}</span>
              </div>
            ))}
          </div>
        </div>
      </details>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DashboardTabBar
          tabs={[
            { key: 'kanban', label: '需求看板' },
            { key: 'req_gantt', label: '需求甘特' },
            // 人力容量为管理视图（全员负载），仅 PM/管理员可见
            ...(isPM ? [{ key: 'capacity', label: '人力容量' }] : []),
          ]}
          activeKey={view}
          onChange={(k) => setView(k as typeof view)}
        />
        {view !== 'capacity' && (
          <>
            <div className="w-44"><Combobox options={lineOptions} value={businessLineUid} onChange={(v) => setBusinessLineUid(v ?? '')} /></div>
            {view === 'kanban' && <div className="w-36"><Combobox options={priorityOptions} value={priority} onChange={(v) => setPriority(v ?? '')} /></div>}
          </>
        )}
      </div>

      {view === 'kanban' && (
        <>
          {isLoading && <div className="py-12 text-center text-[var(--text-muted)]">加载中...</div>}
          {error && <div className="py-12 text-center text-[var(--accent-red)]">加载失败: {error.message}</div>}
          {!isLoading && !error && stats.total === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
              <p className="text-sm text-[var(--text-secondary)]">{isPM ? '需求池为空' : '你还没有提过需求'}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {isPM ? '点右上角「+ 提需求」发起，或等业务方提报后在「收集」列认领收口' : '点右上角「+ 提需求」发起，提交后由 PM 认领推进'}
              </p>
            </div>
          )}
          {!isLoading && !error && stats.total > 0 && (
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
                {RequirementStatusOrder.map((status, i) => {
                  const items = byStatus.get(status) ?? [];
                  const meta = RequirementStatusMeta[status];
                  const newPhase = i === 0 || PHASE_OF[status] !== PHASE_OF[RequirementStatusOrder[i - 1]];
                  return (
                    <div key={status} className="flex w-56 shrink-0 flex-col">
                      {newPhase && (
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{PHASE_OF[status]}</div>
                      )}
                      <div className="mb-1 flex items-center justify-between px-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">
                          {meta?.gate && <span className="mr-0.5 text-[var(--accent-orange)]">⚑</span>}{RequirementStatusLabel[status]}
                        </span>
                        <span className="rounded-full bg-[var(--bg-surface)] px-1.5 text-[10px] text-[var(--text-muted)]">{items.length}</span>
                      </div>
                      <div className="mb-1.5 px-1 text-[10px] leading-tight text-[var(--text-muted)]">{meta?.owner}</div>
                      <div className="flex flex-col gap-2 rounded-xl bg-[var(--bg-surface)]/40 p-2 min-h-[120px]">
                        {items.map((r) => (
                          <RequirementCard key={r.requirementUid} requirement={r} projectNames={projectNames} onClick={openDetail} />
                        ))}
                        {items.length === 0 && <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">—</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {view === 'req_gantt' && (
        ganttLoading ? <div className="py-12 text-center text-[var(--text-muted)]">加载中...</div>
          : <RequirementGantt requirements={ganttReqs ?? []} projectNames={projectNames} onSelect={openDetail} />
      )}

      {view === 'capacity' && (
        capLoading ? <div className="py-12 text-center text-[var(--text-muted)]">加载中...</div>
          : <CapacityGantt people={capacity ?? []} onSelectTask={(reqUid) => reqUid && openDetail(reqUid)} />
      )}

      <RequirementFormModal
        open={modalOpen}
        submitting={submitting}
        defaultBusinessLineUid={businessLineUid || null}
        defaultAppProjectUid={appProjectUid || null}
        impactSlot={(ctx) => <RequirementImpactPreview {...ctx} />}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}

export default function RequirementsPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <RequirementsContent />
    </Suspense>
  );
}
