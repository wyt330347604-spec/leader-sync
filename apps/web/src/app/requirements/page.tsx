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
import {
  useRequirements, useRequirementGantt, useCapacity,
  createRequirement, type CreateRequirementInput, type Requirement,
} from '@/hooks/use-requirements';
import {
  RequirementStatusOrder, RequirementStatusLabel, RequirementPriority,
} from '@leader-sync/shared-types';

function RequirementsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [authed, setAuthed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [view, setView] = useState<'kanban' | 'req_gantt' | 'capacity'>('kanban');
  const [businessLineUid, setBusinessLineUid] = useState<string>(params.get('business_line') ?? '');
  const [appProjectUid] = useState<string>(params.get('app') ?? '');
  const [priority, setPriority] = useState<string>('');

  useEffect(() => { ensureAuth().then(setAuthed); }, []);

  const { businessLines, data: projects } = useProjects(authed);
  const filter = useMemo(
    () => ({ businessLineUid: businessLineUid || undefined, appProjectUid: appProjectUid || undefined, priority: priority || undefined }),
    [businessLineUid, appProjectUid, priority],
  );
  const { data: requirements, isLoading, error, mutate } = useRequirements(filter, authed);
  const ganttFilter = useMemo(() => ({ businessLineUid: businessLineUid || undefined, appProjectUid: appProjectUid || undefined }), [businessLineUid, appProjectUid]);
  const { data: ganttReqs, isLoading: ganttLoading } = useRequirementGantt(ganttFilter, authed && view === 'req_gantt');
  const { data: capacity, isLoading: capLoading } = useCapacity(authed && view === 'capacity');

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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DashboardTabBar
          tabs={[
            { key: 'kanban', label: '需求看板' },
            { key: 'req_gantt', label: '需求甘特' },
            { key: 'capacity', label: '人力容量' },
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
          {!isLoading && !error && (
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
                {RequirementStatusOrder.map((status) => {
                  const items = byStatus.get(status) ?? [];
                  return (
                    <div key={status} className="flex w-56 shrink-0 flex-col">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <span className="text-xs font-semibold text-[var(--text-secondary)]">{RequirementStatusLabel[status]}</span>
                        <span className="rounded-full bg-[var(--bg-surface)] px-1.5 text-[10px] text-[var(--text-muted)]">{items.length}</span>
                      </div>
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
