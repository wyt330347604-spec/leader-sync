'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import { ensureAuth } from '@/lib/auth';

interface Project {
  id: number;
  projectUid: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

interface Permissions {
  canManage: boolean;
}

/* ---------- inline icons (no dependency) ---------- */

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/* ---------- main content ---------- */

function ProjectsContent() {
  const [authed, setAuthed] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data: projects, error, isLoading, mutate } = useSWR<Project[]>(
    authed ? '/api/v1/projects' : null,
    (url: string) => apiFetch<Project[]>(url),
  );

  const { data: perms } = useSWR<Permissions>(
    authed ? '/api/v1/projects/permissions' : null,
    (url: string) => apiFetch<Permissions>(url),
  );

  const canManage = perms?.canManage ?? false;

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed }),
      });
      setNewName('');
      setShowCreate(false);
      await mutate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`创建失败: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }, [newName, submitting, mutate]);

  const handleUpdate = useCallback(async (uid: string) => {
    const trimmed = editName.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/projects/${uid}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      setEditingUid(null);
      setEditName('');
      await mutate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`更新失败: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }, [editName, submitting, mutate]);

  const handleDelete = useCallback(async (uid: string, name: string) => {
    if (!confirm(`确定要删除项目「${name}」吗？此操作不可撤销。`)) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/projects/${uid}`, { method: 'DELETE' });
      await mutate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`删除失败: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }, [mutate]);

  const handleSetDefault = useCallback(async (uid: string) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/projects/${uid}/set-default`, { method: 'POST' });
      await mutate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`设为默认失败: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }, [mutate]);

  const startEdit = useCallback((uid: string, currentName: string) => {
    setEditingUid(uid);
    setEditName(currentName);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingUid(null);
    setEditName('');
  }, []);

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[var(--text-muted)]">正在验证登录状态...</p>
      </div>
    );
  }

  return (
    <div className="pb-16 pt-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">项目管理</h2>
        {canManage && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-full bg-[#3b82f6] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb]"
          >
            {showCreate ? '取消' : '新建项目'}
          </button>
        )}
      </div>

      {/* Create form */}
      {canManage && showCreate && (
        <div className="mb-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="输入项目名称"
              className="flex-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-colors focus:border-[var(--accent-blue)]"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={submitting || !newName.trim()}
              className="rounded-full bg-[#3b82f6] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb] disabled:opacity-50"
            >
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#ef4444]">加载失败: {error.message}</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && projects?.length === 0 && (
        <div className="flex min-h-[30vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">暂无项目</p>
        </div>
      )}

      {/* Project list */}
      {!isLoading && !error && projects && projects.length > 0 && (
        <div className="grid gap-3">
          {projects.map((p) => (
            <div
              key={p.projectUid}
              className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5 transition-all duration-300 ease-out hover:bg-[var(--bg-hover)]"
            >
              {editingUid === p.projectUid ? (
                /* Edit mode */
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdate(p.projectUid);
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    className="flex-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-blue)]"
                    autoFocus
                  />
                  <button
                    onClick={() => handleUpdate(p.projectUid)}
                    disabled={submitting || !editName.trim()}
                    className="rounded-full bg-[#3b82f6] px-4 py-2 text-xs font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb] disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="rounded-full px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-all duration-300 ease-out hover:text-[var(--text-primary)]"
                  >
                    取消
                  </button>
                </div>
              ) : (
                /* Display mode */
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-[var(--text-primary)]">{p.name}</span>
                    {p.isDefault && (
                      <span className="rounded-full bg-[#3b82f6]/10 border border-[#3b82f6]/20 px-2 py-0.5 text-xs text-[#3b82f6]">
                        默认
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      {!p.isDefault && (
                        <button
                          onClick={() => handleSetDefault(p.projectUid)}
                          disabled={submitting}
                          className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-all duration-300 ease-out hover:bg-[#3b82f6]/10 hover:text-[#3b82f6] disabled:opacity-50"
                        >
                          设为默认
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(p.projectUid, p.name)}
                        className="rounded-full p-2 text-[var(--text-secondary)] transition-all duration-300 ease-out hover:bg-[#3b82f6]/10 hover:text-[#3b82f6]"
                        title="编辑"
                      >
                        <PencilIcon />
                      </button>
                      {!p.isDefault && (
                        <button
                          onClick={() => handleDelete(p.projectUid, p.name)}
                          disabled={submitting}
                          className="rounded-full p-2 text-[#ef4444] transition-all duration-300 ease-out hover:bg-[#ef4444]/10 disabled:opacity-50"
                          title="删除"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      }
    >
      <ProjectsContent />
    </Suspense>
  );
}
