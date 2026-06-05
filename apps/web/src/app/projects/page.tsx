'use client';
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { ensureAuth } from '@/lib/auth';
import { getAvatar } from '@/lib/avatar';
import { ProjectModal, ProjectFormValue } from '@/components/project-modal';
import {
  ProjectCategory,
  ProjectCategoryLabel,
  ProjectCategoryOrder,
  ProjectRegion,
} from '@leader-sync/shared-types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Project {
  id: number;
  projectUid: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  category: ProjectCategory | null;
  ownerName: string | null;
  region: string | null;
  subtitle: string | null;
  parentProjectUid: string | null;
  picUserId: string | null;
  picName: string | null;
}

interface Permissions { canManage: boolean }

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ProjectsContent() {
  const [authed, setAuthed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  useEffect(() => { ensureAuth().then(setAuthed); }, []);

  const { data: projects, error, isLoading, mutate } = useSWR<Project[]>(
    authed ? '/api/v1/projects' : null,
    (url: string) => apiFetch<Project[]>(url),
  );
  const { data: perms } = useSWR<Permissions>(
    authed ? '/api/v1/projects/permissions' : null,
    (url: string) => apiFetch<Permissions>(url),
  );
  const canManage = perms?.canManage ?? false;

  const grouped = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const c of ProjectCategoryOrder) groups.set(c, []);
    groups.set('uncategorized', []);
    for (const p of projects ?? []) {
      const key = p.category && groups.has(p.category) ? p.category : 'uncategorized';
      groups.get(key)!.push(p);
    }
    return groups;
  }, [projects]);

  const stats = useMemo(() => {
    const total = projects?.length ?? 0;
    const owners = new Set<string>();
    for (const p of projects ?? []) if (p.ownerName) owners.add(p.ownerName);
    const categories = ProjectCategoryOrder.filter((c) => (grouped.get(c)?.length ?? 0) > 0).length;
    return { total, categories, ownerCount: owners.size };
  }, [projects, grouped]);

  const openCreate = useCallback(() => {
    setEditingProject(null);
    setModalOpen(true);
  }, []);
  const openEdit = useCallback((p: Project) => {
    setEditingProject(p);
    setModalOpen(true);
  }, []);
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingProject(null);
  }, []);

  const handleSubmit = useCallback(async (v: ProjectFormValue) => {
    setSubmitting(true);
    try {
      if (editingProject) {
        await apiFetch(`/api/v1/projects/${editingProject.projectUid}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: v.name, category: v.category, ownerName: v.ownerName,
            region: v.region, subtitle: v.subtitle, parentProjectUid: v.parentProjectUid,
            picUserId: v.pic?.userId ?? null,
          }),
        });
        if (v.isDefault && !editingProject.isDefault) {
          await apiFetch(`/api/v1/projects/${editingProject.projectUid}/set-default`, { method: 'POST' });
        }
      } else {
        const created = await apiFetch<Project>('/api/v1/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: v.name, category: v.category, ownerName: v.ownerName,
            region: v.region, subtitle: v.subtitle, parentProjectUid: v.parentProjectUid,
            picUserId: v.pic?.userId ?? null,
          }),
        });
        if (v.isDefault) {
          await apiFetch(`/api/v1/projects/${created.projectUid}/set-default`, { method: 'POST' });
        }
      }
      closeModal();
      await mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }, [editingProject, mutate, closeModal]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/projects/${deleteTarget.projectUid}`, { method: 'DELETE' });
      await mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`删除失败: ${msg}`);
    } finally {
      setSubmitting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, mutate]);

  if (!authed) return <LoadingScreen />;

  return (
    <div className="pb-16 pt-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">项目架构总览</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {stats.total} 个项目 · {stats.categories} 大业务板块 · {stats.ownerCount} 位负责人
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-blue)]"
          >
            新建项目
          </button>
        )}
      </div>

      <div className="mb-8 grid grid-cols-5 gap-2">
        {ProjectCategoryOrder.map((c) => (
          <div key={c} className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] px-3 py-2 text-center">
            <div className="text-xl font-bold" style={{ color: `var(--cat-${c})` }}>
              {grouped.get(c)?.length ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{ProjectCategoryLabel[c]}</div>
          </div>
        ))}
      </div>

      {isLoading && <div className="py-12 text-center text-[var(--text-muted)]">加载中...</div>}
      {error && <div className="py-12 text-center text-[var(--accent-red)]">加载失败: {error.message}</div>}

      {!isLoading && !error && projects && (
        <>
          {ProjectCategoryOrder.map((c) => {
            const items = grouped.get(c) ?? [];
            return (
              <Section
                key={c}
                category={c}
                label={ProjectCategoryLabel[c]}
                items={items}
                canManage={canManage}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            );
          })}
          {(grouped.get('uncategorized')?.length ?? 0) > 0 && (
            <Section
              category={null}
              label="未分类"
              items={grouped.get('uncategorized') ?? []}
              canManage={canManage}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          )}
        </>
      )}

      <ProjectModal
        open={modalOpen}
        mode={editingProject ? 'edit' : 'create'}
        initial={editingProject ? {
          name: editingProject.name,
          category: editingProject.category,
          ownerName: editingProject.ownerName,
          region: editingProject.region as ProjectRegion | null,
          subtitle: editingProject.subtitle,
          isDefault: editingProject.isDefault,
          parentProjectUid: editingProject.parentProjectUid,
          pic: editingProject.picUserId
            ? { userId: editingProject.picUserId, userName: editingProject.picName ?? editingProject.picUserId }
            : null,
        } : undefined}
        parentOptions={(projects ?? [])
          .filter((p) => !p.parentProjectUid && p.projectUid !== editingProject?.projectUid)
          .map((p) => ({ value: p.projectUid, label: p.name }))}
        submitting={submitting}
        onClose={closeModal}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--text-primary)]">
              确认删除项目「{deleteTarget?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--text-secondary)]">
              此操作不可撤销。该项目下的任务不会被删除，但将失去项目归属。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => { e.preventDefault(); handleDeleteConfirmed(); }}
              className="bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red)]/90"
            >
              {submitting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  category, label, items, canManage, onEdit, onDelete,
}: {
  category: ProjectCategory | null;
  label: string;
  items: Project[];
  canManage: boolean;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  if (items.length === 0) return null;
  const catVar = category ? `var(--cat-${category})` : '#94A3B8';
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: catVar }} />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {label}
          </span>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{items.length} 个项目</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((p) => (
          <ProjectCard
            key={p.projectUid}
            project={p}
            categoryVar={catVar}
            canManage={canManage}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({
  project, categoryVar, canManage, onEdit, onDelete,
}: {
  project: Project;
  categoryVar: string;
  canManage: boolean;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const av = getAvatar(project.ownerName);
  return (
    <div
      className="group relative overflow-hidden rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4"
      style={{ borderLeft: `3px solid ${categoryVar}` }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2 flex-wrap">
            <span>{project.name}</span>
            {project.subtitle && (
              <span className="rounded-md bg-[var(--accent-blue)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {project.subtitle}
              </span>
            )}
            {project.isDefault && (
              <span className="rounded-full border border-[var(--accent-blue)]/20 bg-[var(--accent-blue)]/10 px-2 py-0.5 text-[10px] text-[var(--accent-blue)]">
                默认
              </span>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => onEdit(project)}
              aria-label="编辑项目"
              className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--accent-blue)]/10 hover:text-[var(--accent-blue)]"
              title="编辑"
            >
              <PencilIcon />
            </button>
            {!project.isDefault && (
              <button
                onClick={() => onDelete(project)}
                aria-label="删除项目"
                className="rounded-full p-1.5 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
                title="删除"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={{
              background: av.bg,
              color: av.fg,
              ...(av.vacant ? { border: '1px dashed #CBD5E1' } : {}),
            }}
          >
            {av.initial}
          </div>
          <span className={`truncate text-sm font-semibold ${av.vacant ? 'italic text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
            {av.vacant ? '空缺' : project.ownerName}
          </span>
        </div>
        {project.region && (
          <span className="shrink-0 rounded-md bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
            {project.region}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <ProjectsContent />
    </Suspense>
  );
}
