'use client';
import { useState, useEffect, use, useRef, useImperativeHandle, forwardRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { useTask } from '@/hooks/use-task';
import { StatusBadge } from '@/components/status-badge';
import { PriorityBadge } from '@/components/priority-badge';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LoadingScreen } from "@/components/loading-screen";
import { ensureAuth } from '@/lib/auth';
import { DelayTaskDialog } from '@/components/delay-task-dialog';
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

const STATUS_OPTIONS = [
  { value: 'pending', label: '待办' },
  { value: 'not_started', label: '待开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'stalled', label: '已停滞' },
  { value: 'done', label: '已完成' },
  { value: 'shelved', label: '已搁置' },
  { value: 'closed', label: '已归档' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent_important', label: '重要紧急' },
  { value: 'important_not_urgent', label: '重要不紧急' },
  { value: 'urgent_not_important', label: '紧急不重要' },
  { value: 'not_urgent_not_important', label: '不紧急不重要' },
];

const inputClass =
  'block w-full rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40 focus:border-[var(--accent-blue)]/50';

function formatDate(val: string | null | undefined): string {
  if (!val) return '-';
  return new Date(val).toLocaleString('zh-CN');
}

/* ---------- Multi-Leader Section ---------- */

interface TaskLeader {
  readonly leader_user_id: string;
  readonly leader_name: string;
}

export interface LeaderSectionHandle {
  hasPending: () => boolean;
  flushPending: () => Promise<void>;
}

interface LeaderSectionProps {
  readonly taskUid: string;
  readonly onPendingCountChange?: (count: number) => void;
}

interface PendingPerson {
  readonly userId: string;
  readonly userName: string;
}

const LeaderSection = forwardRef<LeaderSectionHandle, LeaderSectionProps>(function LeaderSection(
  { taskUid, onPendingCountChange },
  ref,
) {
  const { data: leaders, mutate: mutateLeaders } = useSWR<readonly TaskLeader[]>(
    taskUid ? `/api/v1/tasks/${taskUid}/leaders` : null,
    (url: string) => apiFetch<TaskLeader[]>(url),
  );

  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<readonly { userId: string; userName: string; deptName: string | null }[]>([]);
  const [pendingNew, setPendingNew] = useState<readonly PendingPerson[]>([]);
  const [leaderError, setLeaderError] = useState('');

  // Notify parent when staged count changes
  useEffect(() => {
    onPendingCountChange?.(pendingNew.length);
  }, [pendingNew, onPendingCountChange]);

  // Debounced user search
  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<{ userId: string; userName: string; deptName: string | null }[]>(
        `/api/v1/users/search?q=${encodeURIComponent(searchQuery)}`,
      )
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  function stageAddLeader(userId: string, userName: string) {
    if (leaders?.some((l) => l.leader_user_id === userId)) return;
    if (pendingNew.some((p) => p.userId === userId)) return;
    setPendingNew((prev) => [...prev, { userId, userName }]);
    setSearchQuery('');
    setSearchResults([]);
    setShowAddForm(false);
  }

  function unstagePendingLeader(userId: string) {
    setPendingNew((prev) => prev.filter((p) => p.userId !== userId));
  }

  async function handleRemoveLeader(leaderUserId: string) {
    setLeaderError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/leaders/${leaderUserId}`, { method: 'DELETE' });
      await mutateLeaders();
    } catch (err: any) {
      setLeaderError(err.message || '移除失败');
    }
  }

  useImperativeHandle(ref, () => ({
    hasPending: () => pendingNew.length > 0,
    flushPending: async () => {
      for (const p of pendingNew) {
        await apiFetch(`/api/v1/tasks/${taskUid}/leaders`, {
          method: 'POST',
          body: JSON.stringify({ leader_user_id: p.userId, leader_name: p.userName }),
        });
      }
      setPendingNew([]);
      await mutateLeaders();
    },
  }), [pendingNew, taskUid, mutateLeaders]);

  return (
    <div className="mb-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-medium text-[var(--text-muted)]">关联 Leader</p>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-full bg-[#3b82f6] px-3 py-1 text-xs font-medium text-white transition-all duration-200 hover:bg-[#2563eb]"
        >
          {showAddForm ? '取消' : '添加 Leader'}
        </button>
      </div>

      {leaderError && (
        <p className="mb-3 text-xs text-[#ef4444]">{leaderError}</p>
      )}

      {/* Existing leader chips */}
      <div className="flex flex-wrap gap-2">
        {leaders && leaders.length > 0 ? (
          leaders.map((l) => (
            <span
              key={l.leader_user_id}
              className="inline-flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-3 py-1 text-sm text-[var(--text-primary)]"
            >
              {l.leader_name}
              <button
                onClick={() => handleRemoveLeader(l.leader_user_id)}
                className="ml-0.5 text-[#ef4444] hover:text-[#f87171] transition-colors duration-150 text-xs font-bold leading-none"
                title="移除"
              >
                &times;
              </button>
            </span>
          ))
        ) : pendingNew.length === 0 ? (
          <span className="text-xs text-[var(--text-muted)]">暂无关联 Leader</span>
        ) : null}

        {/* Pending (待保存) chips */}
        {pendingNew.map((p) => (
          <span
            key={`pending-${p.userId}`}
            className="inline-flex items-center gap-1.5 bg-[var(--accent-orange)]/10 border border-dashed border-[var(--accent-orange)]/50 rounded-full px-3 py-1 text-sm text-[var(--accent-orange)]"
            title="待保存"
          >
            ⏳ {p.userName}
            <button
              onClick={() => unstagePendingLeader(p.userId)}
              className="ml-0.5 text-[var(--accent-orange)] hover:text-[var(--accent-red)] transition-colors duration-150 text-xs font-bold leading-none"
              title="取消"
            >
              &times;
            </button>
          </span>
        ))}
      </div>

      {/* Search add form (stages locally, save flushes) */}
      {showAddForm && (
        <div className="mt-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索姓名（支持中文 / 拼音首字母）"
            className="block w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40"
            autoFocus
          />
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-60 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
              {searchResults.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => stageAddLeader(u.userId, u.userName ?? '')}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-[var(--bg-hover)]"
                >
                  <span className="font-medium text-[var(--text-primary)]">{u.userName}</span>
                  <span className="text-xs text-[var(--text-muted)]">{u.deptName ?? ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/* ---------- Collaborator Section ---------- */

interface Collaborator {
  readonly user_id: string;
  readonly user_name: string;
}

interface UserSearchResult {
  readonly userId: string;
  readonly userName: string;
  readonly deptName: string | null;
}

export interface CollaboratorSectionHandle {
  hasPending: () => boolean;
  flushPending: () => Promise<void>;
}

interface CollaboratorSectionProps {
  readonly taskUid: string;
  readonly onPendingCountChange?: (count: number) => void;
}

const CollaboratorSection = forwardRef<CollaboratorSectionHandle, CollaboratorSectionProps>(
  function CollaboratorSection({ taskUid, onPendingCountChange }, ref) {
    const { data: collaborators, mutate: mutateCollaborators } = useSWR<readonly Collaborator[]>(
      taskUid ? `/api/v1/tasks/${taskUid}/collaborators` : null,
      (url: string) => apiFetch<Collaborator[]>(url),
    );

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<readonly UserSearchResult[]>([]);
    const [showSearch, setShowSearch] = useState(false);
    const [pendingNew, setPendingNew] = useState<readonly PendingPerson[]>([]);
    const [collabError, setCollabError] = useState('');

    useEffect(() => {
      onPendingCountChange?.(pendingNew.length);
    }, [pendingNew, onPendingCountChange]);

    useEffect(() => {
      if (searchQuery.length < 1) {
        setSearchResults([]);
        return;
      }
      const timer = setTimeout(() => {
        apiFetch<UserSearchResult[]>(`/api/v1/users/search?q=${encodeURIComponent(searchQuery)}`)
          .then(setSearchResults)
          .catch(() => setSearchResults([]));
      }, 300);
      return () => clearTimeout(timer);
    }, [searchQuery]);

    function stageAddCollaborator(userId: string, userName: string) {
      if (collaborators?.some((c) => c.user_id === userId)) return;
      if (pendingNew.some((p) => p.userId === userId)) return;
      setPendingNew((prev) => [...prev, { userId, userName }]);
      setSearchQuery('');
      setSearchResults([]);
      setShowSearch(false);
    }

    function unstagePendingCollab(userId: string) {
      setPendingNew((prev) => prev.filter((p) => p.userId !== userId));
    }

    async function handleRemoveCollaborator(userId: string) {
      setCollabError('');
      try {
        await apiFetch(`/api/v1/tasks/${taskUid}/collaborators/${userId}`, { method: 'DELETE' });
        await mutateCollaborators();
      } catch (err: any) {
        setCollabError(err.message || '移除失败');
      }
    }

    useImperativeHandle(ref, () => ({
      hasPending: () => pendingNew.length > 0,
      flushPending: async () => {
        for (const p of pendingNew) {
          await apiFetch(`/api/v1/tasks/${taskUid}/collaborators`, {
            method: 'POST',
            body: JSON.stringify({ user_id: p.userId, user_name: p.userName }),
          });
        }
        setPendingNew([]);
        await mutateCollaborators();
      },
    }), [pendingNew, taskUid, mutateCollaborators]);

    return (
      <div className="mb-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-medium text-[var(--text-muted)]">协作人</p>
          <button
            onClick={() => setShowSearch((v) => !v)}
            className="rounded-full bg-[#3b82f6] px-3 py-1 text-xs font-medium text-white transition-all duration-200 hover:bg-[#2563eb]"
          >
            {showSearch ? '取消' : '添加协作人'}
          </button>
        </div>

        {collabError && (
          <p className="mb-3 text-xs text-[#ef4444]">{collabError}</p>
        )}

        {/* Existing + pending chips */}
        <div className="flex flex-wrap gap-2">
          {collaborators && collaborators.length > 0 ? (
            collaborators.map((c) => (
              <span
                key={c.user_id}
                className="inline-flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-3 py-1 text-sm text-[var(--text-primary)]"
              >
                {c.user_name}
                <button
                  onClick={() => handleRemoveCollaborator(c.user_id)}
                  className="ml-0.5 text-[#ef4444] hover:text-[#f87171] transition-colors duration-150 text-xs font-bold leading-none"
                  title="移除"
                >
                  &times;
                </button>
              </span>
            ))
          ) : pendingNew.length === 0 ? (
            <span className="text-xs text-[var(--text-muted)]">暂无协作人</span>
          ) : null}

          {pendingNew.map((p) => (
            <span
              key={`pending-${p.userId}`}
              className="inline-flex items-center gap-1.5 bg-[var(--accent-orange)]/10 border border-dashed border-[var(--accent-orange)]/50 rounded-full px-3 py-1 text-sm text-[var(--accent-orange)]"
              title="待保存"
            >
              ⏳ {p.userName}
              <button
                onClick={() => unstagePendingCollab(p.userId)}
                className="ml-0.5 text-[var(--accent-orange)] hover:text-[var(--accent-red)] transition-colors duration-150 text-xs font-bold leading-none"
                title="取消"
              >
                &times;
              </button>
            </span>
          ))}
        </div>

        {showSearch && (
          <div className="mt-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索姓名（支持中文 / 拼音首字母）"
              className="block w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]/40"
              autoFocus
            />
            {searchResults.length > 0 && (
              <div className="mt-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
                {searchResults.map((u) => (
                  <button
                    key={u.userId}
                    onClick={() => stageAddCollaborator(u.userId, u.userName ?? '')}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors duration-150"
                  >
                    <span>{u.userName}</span>
                    <span className="text-xs text-[var(--text-muted)]">{u.deptName || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

export default function TaskDetailPage({ params }: { params: Promise<{ task_uid: string }> }) {
  const { task_uid: taskUid } = use(params);
  const router = useRouter();
  const { data: task, error, isLoading, mutate } = useTask(taskUid);
  const [authed, setAuthed] = useState(false);

  // Unified edit form state — covers all editable fields, saved together via [保存] button
  const [editStatus, setEditStatus] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editProjectUid, setEditProjectUid] = useState('');
  const [editProgress, setEditProgress] = useState(0);
  const [editLatestProgress, setEditLatestProgress] = useState('');
  const [editDetail, setEditDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Project list (for select + display)
  const { data: projects } = useSWR<readonly { projectUid: string; name: string; isDefault: boolean }[]>(
    '/api/v1/projects',
    (url: string) => apiFetch<{ projectUid: string; name: string; isDefault: boolean }[]>(url),
  );

  // Refs to child sections so the unified [保存] button can flush their pending stages
  const leaderSectionRef = useRef<LeaderSectionHandle | null>(null);
  const collaboratorSectionRef = useRef<CollaboratorSectionHandle | null>(null);
  const [pendingLeaderCount, setPendingLeaderCount] = useState(0);
  const [pendingCollabCount, setPendingCollabCount] = useState(0);

  // Delay state
  const [showDelayDialog, setShowDelayDialog] = useState(false);
  const [delaySubmitting, setDelaySubmitting] = useState(false);

  // Delete confirm dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Boss attention toggle state
  const [togglingAttention, setTogglingAttention] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  useEffect(() => {
    if (task) {
      setEditStatus(task.status);
      setEditPriority(task.priority);
      setEditProjectUid(task.project_uid ?? task.projectUid ?? '');
      setEditProgress(task.progress_percent ?? task.progressPercent ?? 0);
      setEditLatestProgress(task.latest_progress ?? task.latestProgress ?? '');
      setEditDetail(task.detail ?? '');
    }
  }, [task]);

  // Has anything changed? (form fields OR staged leader/collab additions)
  const fieldsDirty = Boolean(task) && (
    editStatus !== task.status ||
    editPriority !== task.priority ||
    editProjectUid !== (task.project_uid ?? task.projectUid ?? '') ||
    editProgress !== (task.progress_percent ?? task.progressPercent ?? 0) ||
    editLatestProgress !== (task.latest_progress ?? task.latestProgress ?? '') ||
    editDetail !== (task.detail ?? '')
  );
  const isDirty = fieldsDirty || pendingLeaderCount > 0 || pendingCollabCount > 0;

  async function handleSave() {
    if (!isDirty) return;
    setSaving(true);
    setSaveError('');
    try {
      // 1. Flush staged leaders / collaborators first (they don't need version)
      if (leaderSectionRef.current?.hasPending()) {
        await leaderSectionRef.current.flushPending();
      }
      if (collaboratorSectionRef.current?.hasPending()) {
        await collaboratorSectionRef.current.flushPending();
      }
      // 2. Patch main task fields — only diff (avoid same-value writes that trigger
      // backend validation like "same status → same status").
      if (fieldsDirty) {
        const patch: Record<string, unknown> = { version: task.version };
        if (editStatus !== task.status) patch.status = editStatus;
        if (editPriority !== task.priority) patch.priority = editPriority;
        const curProj = task.project_uid ?? task.projectUid ?? '';
        if (editProjectUid !== curProj) patch.project_uid = editProjectUid || null;
        const curProg = task.progress_percent ?? task.progressPercent ?? 0;
        if (editProgress !== curProg) patch.progress_percent = editProgress;
        const curLatest = task.latest_progress ?? task.latestProgress ?? '';
        if (editLatestProgress !== curLatest) patch.latest_progress = editLatestProgress;
        if (editDetail !== (task.detail ?? '')) patch.detail = editDetail;

        await apiFetch(`/api/v1/tasks/${taskUid}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
      }
      toast.success('已保存');
      router.push('/tasks');
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        toast.error('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAttention() {
    setTogglingAttention(true);
    setSaveError('');
    try {
      const currentFlag = task.boss_attention_flag ?? task.bossAttentionFlag ?? false;
      await apiFetch(`/api/v1/tasks/${taskUid}`, {
        method: 'PATCH',
        body: JSON.stringify({ boss_attention_flag: !currentFlag, version: task.version }),
      });
      await mutate();
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        toast.error('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '操作失败');
      }
    } finally {
      setTogglingAttention(false);
    }
  }

  async function handleDeleteConfirmed() {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}`, { method: 'DELETE' });
      router.push('/tasks');
    } catch (err: any) {
      setSaveError(err.message || '删除失败');
    } finally {
      setSaving(false);
      setShowDeleteDialog(false);
    }
  }

  async function handleMarkDone() {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'done',
          progress_percent: 100,
          version: task.version,
        }),
      });
      router.push('/tasks');
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        toast.error('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '操作失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelay(newDate: string) {
    if (!newDate) return;
    setDelaySubmitting(true);
    setSaveError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/delay`, {
        method: 'POST',
        body: JSON.stringify({
          new_due_at: `${newDate}T23:59:59+08:00`,
        }),
      });
      toast.success('延期成功');
      setShowDelayDialog(false);
      router.push('/tasks');
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        toast.error('数据已被修改，请刷新');
        await mutate();
        setShowDelayDialog(false);
      } else {
        toast.error(err.message || '延期失败');
      }
    } finally {
      setDelaySubmitting(false);
    }
  }

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[var(--text-secondary)]">正在跳转登录...</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[var(--text-muted)]">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#ef4444]">加载失败: {error.message}</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[var(--text-muted)]">任务不存在</p>
      </div>
    );
  }

  const isBossAttention = task.boss_attention_flag ?? task.bossAttentionFlag ?? false;

  return (
    <div className="mx-auto max-w-3xl pb-16 pt-8">
      {/* Back */}
      <Link
        href="/tasks"
        className="inline-block text-sm text-[var(--accent-blue)] transition-all duration-300 ease-out hover:text-[var(--accent-blue)]"
      >
        &larr; 返回
      </Link>

      {/* Hero title */}
      <div className="mt-4 mb-8">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">{task.title}</h2>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {/* Status / Priority chips — display only; editing is in the form below */}
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />

          {/* Delay-count tag (replaces former carry-over tag) */}
          {(() => {
            const n = task.delay_count ?? task.delayCount ?? 0;
            if (n < 1) return null;
            const danger = n >= 3;
            const cls = danger
              ? 'bg-[var(--accent-red)]/10 text-[var(--accent-red)] border-[var(--accent-red)]/30'
              : 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20';
            return (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
                已延期 {n} 次
              </span>
            );
          })()}

          {/* Boss attention toggle */}
          <button
            onClick={handleToggleAttention}
            disabled={togglingAttention}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-300 ease-out disabled:opacity-50 ${
              isBossAttention
                ? 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20 hover:bg-[#f59e0b]/20'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <svg className="h-3 w-3" fill={isBossAttention ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            重点任务
          </button>
        </div>
      </div>

      {saveError && (
        <div className="mb-6 rounded-2xl bg-[#ef4444]/10 border border-[#ef4444]/20 px-5 py-4 text-sm text-[#ef4444]">
          {saveError}
        </div>
      )}

      {/* Unified edit form (always visible; saved via [保存] at the bottom) */}
      <div className="mb-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-6 space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor="edit_project" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">归属项目</label>
            <select
              id="edit_project"
              value={editProjectUid}
              onChange={(e) => setEditProjectUid(e.target.value)}
              className={inputClass}
            >
              <option value="">无</option>
              {projects?.map((p) => (
                <option key={p.projectUid} value={p.projectUid}>
                  {p.name}{p.isDefault ? ' (默认)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="edit_status" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">状态</label>
            <select
              id="edit_status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="edit_priority" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">优先级</label>
            <select
              id="edit_priority"
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
              className={inputClass}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="edit_percent" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">完成进度</label>
          <div className="flex items-center gap-4">
            <input
              id="edit_percent"
              type="range"
              min={0}
              max={100}
              step={5}
              value={editProgress}
              onChange={(e) => setEditProgress(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--bg-surface)] accent-[#3b82f6]"
            />
            <span className="tabular-nums text-sm font-semibold text-[var(--text-primary)] w-12 text-right">{editProgress}%</span>
          </div>
        </div>

        <div>
          <label htmlFor="edit_progress_text" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">最新进展</label>
          <textarea
            id="edit_progress_text"
            rows={3}
            value={editLatestProgress}
            onChange={(e) => setEditLatestProgress(e.target.value)}
            className={inputClass}
            placeholder="本次的进展描述..."
          />
        </div>

        <div>
          <label htmlFor="edit_detail" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">详细描述</label>
          <textarea
            id="edit_detail"
            rows={4}
            value={editDetail}
            onChange={(e) => setEditDetail(e.target.value)}
            className={inputClass}
            placeholder="任务详细描述..."
          />
        </div>
      </div>

      {/* Info cards grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
          <p className="text-xs font-medium text-[var(--text-muted)]">归属项目</p>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">
            {projects?.find((p) => p.projectUid === (task.project_uid ?? task.projectUid))?.name ?? '-'}
          </p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
          <p className="text-xs font-medium text-[var(--text-muted)]">负责人</p>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{task.assignee_name || task.assigneeName || '-'}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
          <p className="text-xs font-medium text-[var(--text-muted)]">创建人</p>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{task.creator_name || task.creatorName || '-'}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
          <p className="text-xs font-medium text-[var(--text-muted)]">截止时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[var(--text-primary)]">{formatDate(task.due_at || task.dueAt)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
          <p className="text-xs font-medium text-[var(--text-muted)]">开始时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[var(--text-primary)]">{formatDate(task.start_at || task.startAt)}</p>
        </div>
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
          <p className="text-xs font-medium text-[var(--text-muted)]">创建时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[var(--text-primary)]">{formatDate(task.created_at || task.createdAt)}</p>
        </div>
      </div>

      {/* Multi-Leader section (staged adds, immediate removes) */}
      <LeaderSection
        ref={leaderSectionRef}
        taskUid={taskUid}
        onPendingCountChange={setPendingLeaderCount}
      />

      {/* Collaborator section (staged adds, immediate removes) */}
      <CollaboratorSection
        ref={collaboratorSectionRef}
        taskUid={taskUid}
        onPendingCountChange={setPendingCollabCount}
      />

      {/* Action buttons (all aligned bottom) */}
      <div className="mb-6 flex gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="rounded-full bg-[#3b82f6] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb] disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button
          onClick={handleMarkDone}
          disabled={saving}
          className="rounded-full bg-[#22c55e] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#16a34a] disabled:opacity-50"
        >
          提交完成
        </button>
        <button
          onClick={() => setShowDelayDialog(true)}
          className="rounded-full bg-[var(--bg-surface)] border border-[var(--border)] px-6 py-2.5 text-sm font-medium text-[#f59e0b] transition-all duration-300 ease-out hover:bg-[var(--bg-hover)]"
        >
          延期
        </button>
        <button
          onClick={() => setShowDeleteDialog(true)}
          disabled={saving}
          className="rounded-full bg-[var(--bg-surface)] border border-[var(--accent-red)]/30 px-6 py-2.5 text-sm font-medium text-[var(--accent-red)] transition-all duration-300 ease-out hover:bg-[var(--accent-red)]/10 disabled:opacity-50"
        >
          删除
        </button>
      </div>

      <DelayTaskDialog
        open={showDelayDialog}
        onOpenChange={setShowDelayDialog}
        currentDueAt={task.due_at ?? task.dueAt}
        delayCount={task.delay_count ?? task.delayCount ?? 0}
        submitting={delaySubmitting}
        onConfirm={handleDelay}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--text-primary)]">确认删除此任务？</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--text-secondary)]">
              删除后不可恢复，所有协作人将失去对该任务的访问。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirmed();
              }}
              className="bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red)]/90"
            >
              {saving ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
