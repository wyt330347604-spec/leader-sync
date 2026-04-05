'use client';
import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useTask } from '@/hooks/use-task';
import { StatusBadge } from '@/components/status-badge';
import { PriorityBadge } from '@/components/priority-badge';
import { apiFetch, ApiError } from '@/lib/api-client';
import { ensureAuth } from '@/lib/auth';

const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'assigned', label: '已指派' },
  { value: 'in_progress', label: '进行中' },
  { value: 'blocked', label: '阻塞' },
  { value: 'pending_review', label: '待验收' },
  { value: 'done', label: '已完成' },
  { value: 'reopened', label: '重新打开' },
  { value: 'cancelled', label: '已取消' },
  { value: 'closed', label: '已归档' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent_important', label: '重要紧急' },
  { value: 'important_not_urgent', label: '重要不紧急' },
  { value: 'urgent_not_important', label: '紧急不重要' },
  { value: 'not_urgent_not_important', label: '不紧急不重要' },
];

const TASK_TYPE_LABELS: Record<string, string> = {
  strategy: '战略事项',
  operation: '运营事项',
  project: '项目事项',
  report: '汇报事项',
  meeting: '会议事项',
  collaboration: '协同事项',
  follow_up: '督办事项',
  other: '其他',
};

const inputClass =
  'block w-full rounded-xl bg-[#1e1e2e] border border-[#2a2a3a] px-4 py-3 text-sm text-[#e4e4e7] placeholder-[#5a5a6e] transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/40 focus:border-[#3b82f6]/50';

function formatDate(val: string | null | undefined): string {
  if (!val) return '-';
  return new Date(val).toLocaleString('zh-CN');
}

/* ---------- Multi-Leader Section ---------- */

interface TaskLeader {
  readonly leader_user_id: string;
  readonly leader_name: string;
}

function LeaderSection({ taskUid }: { readonly taskUid: string }) {
  const { data: leaders, mutate: mutateLeaders } = useSWR<readonly TaskLeader[]>(
    taskUid ? `/api/v1/tasks/${taskUid}/leaders` : null,
    (url: string) => apiFetch<TaskLeader[]>(url),
  );

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLeaderId, setNewLeaderId] = useState('');
  const [newLeaderName, setNewLeaderName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [leaderError, setLeaderError] = useState('');

  async function handleAddLeader() {
    if (!newLeaderId.trim() || !newLeaderName.trim()) return;
    setSubmitting(true);
    setLeaderError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/leaders`, {
        method: 'POST',
        body: JSON.stringify({
          leader_user_id: newLeaderId.trim(),
          leader_name: newLeaderName.trim(),
        }),
      });
      await mutateLeaders();
      setNewLeaderId('');
      setNewLeaderName('');
      setShowAddForm(false);
    } catch (err: any) {
      setLeaderError(err.message || '添加失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveLeader(leaderUserId: string) {
    setLeaderError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/leaders/${leaderUserId}`, {
        method: 'DELETE',
      });
      await mutateLeaders();
    } catch (err: any) {
      setLeaderError(err.message || '移除失败');
    }
  }

  return (
    <div className="mb-6 rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-medium text-[#5a5a6e]">关联 Leader</p>
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

      {/* Leader chips */}
      <div className="flex flex-wrap gap-2">
        {leaders && leaders.length > 0 ? (
          leaders.map((l) => (
            <span
              key={l.leader_user_id}
              className="inline-flex items-center gap-1.5 bg-[#1e1e2e] border border-[#2a2a3a] rounded-full px-3 py-1 text-sm text-[#e4e4e7]"
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
        ) : (
          <span className="text-xs text-[#5a5a6e]">暂无关联 Leader</span>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="mt-4 flex items-end gap-3 flex-wrap">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-[#8b8b9e]">用户 ID</label>
            <input
              type="text"
              value={newLeaderId}
              onChange={(e) => setNewLeaderId(e.target.value)}
              placeholder="leader_user_id"
              className="block w-40 rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-1.5 text-xs text-[#e4e4e7] placeholder-[#5a5a6e] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]/40"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-[#8b8b9e]">姓名</label>
            <input
              type="text"
              value={newLeaderName}
              onChange={(e) => setNewLeaderName(e.target.value)}
              placeholder="Leader 姓名"
              className="block w-40 rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-1.5 text-xs text-[#e4e4e7] placeholder-[#5a5a6e] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]/40"
            />
          </div>
          <button
            onClick={handleAddLeader}
            disabled={submitting || !newLeaderId.trim() || !newLeaderName.trim()}
            className="rounded-lg bg-[#3b82f6] px-4 py-1.5 text-xs font-medium text-white transition-all duration-200 hover:bg-[#2563eb] disabled:opacity-50"
          >
            {submitting ? '添加中...' : '确认添加'}
          </button>
        </div>
      )}
    </div>
  );
}

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

function CollaboratorSection({ taskUid }: { readonly taskUid: string }) {
  const { data: collaborators, mutate: mutateCollaborators } = useSWR<readonly Collaborator[]>(
    taskUid ? `/api/v1/tasks/${taskUid}/collaborators` : null,
    (url: string) => apiFetch<Collaborator[]>(url),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<readonly UserSearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collabError, setCollabError] = useState('');

  // Search users with debounce
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

  async function handleAddCollaborator(userId: string, userName: string) {
    setSubmitting(true);
    setCollabError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/collaborators`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, user_name: userName }),
      });
      await mutateCollaborators();
      setSearchQuery('');
      setShowSearch(false);
      setSearchResults([]);
    } catch (err: any) {
      setCollabError(err.message || '添加失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveCollaborator(userId: string) {
    setCollabError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/collaborators/${userId}`, {
        method: 'DELETE',
      });
      await mutateCollaborators();
    } catch (err: any) {
      setCollabError(err.message || '移除失败');
    }
  }

  return (
    <div className="mb-6 rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-medium text-[#5a5a6e]">协作人</p>
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

      {/* Collaborator chips */}
      <div className="flex flex-wrap gap-2">
        {collaborators && collaborators.length > 0 ? (
          collaborators.map((c) => (
            <span
              key={c.user_id}
              className="inline-flex items-center gap-1.5 bg-[#1e1e2e] border border-[#2a2a3a] rounded-full px-3 py-1 text-sm text-[#e4e4e7]"
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
        ) : (
          <span className="text-xs text-[#5a5a6e]">暂无协作人</span>
        )}
      </div>

      {/* Search input and results */}
      {showSearch && (
        <div className="mt-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索用户名..."
            className="block w-full rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-3 py-2 text-sm text-[#e4e4e7] placeholder-[#5a5a6e] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]/40"
          />
          {searchResults.length > 0 && (
            <div className="mt-2 rounded-xl bg-[#12121a] border border-[#2a2a3a] overflow-hidden">
              {searchResults.map((u) => (
                <button
                  key={u.userId}
                  onClick={() => handleAddCollaborator(u.userId, u.userName ?? '')}
                  disabled={submitting}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-[#e4e4e7] hover:bg-[#1e1e2e] transition-colors duration-150 disabled:opacity-50"
                >
                  <span>{u.userName}</span>
                  <span className="text-xs text-[#5a5a6e]">{u.deptName || ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskDetailPage({ params }: { params: Promise<{ task_uid: string }> }) {
  const { task_uid: taskUid } = use(params);
  const { data: task, error, isLoading, mutate } = useTask(taskUid);
  const [authed, setAuthed] = useState(false);

  // Edit state
  const [editingProgress, setEditingProgress] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [latestProgress, setLatestProgress] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Inline edit state for status and priority
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingPriority, setEditingPriority] = useState(false);
  const [inlineStatus, setInlineStatus] = useState('');
  const [inlinePriority, setInlinePriority] = useState('');

  // Delay form state
  const [showDelayForm, setShowDelayForm] = useState(false);
  const [newDueAt, setNewDueAt] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [delaySubmitting, setDelaySubmitting] = useState(false);

  // Boss attention toggle state
  const [togglingAttention, setTogglingAttention] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  useEffect(() => {
    if (task) {
      setNewStatus(task.status);
      setProgressPercent(task.progress_percent ?? task.progressPercent ?? 0);
      setLatestProgress(task.latest_progress ?? task.latestProgress ?? '');
      setInlineStatus(task.status);
      setInlinePriority(task.priority);
    }
  }, [task]);

  async function handleUpdateProgress() {
    setSaving(true);
    setSaveError('');
    try {
      const version = task.version;
      await apiFetch(`/api/v1/tasks/${taskUid}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: newStatus,
          progress_percent: progressPercent,
          latest_progress: latestProgress,
          version,
        }),
      });
      await mutate();
      setEditingProgress(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        alert('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleInlineStatusSave() {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: inlineStatus, version: task.version }),
      });
      await mutate();
      setEditingStatus(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        alert('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleInlinePrioritySave() {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: inlinePriority, version: task.version }),
      });
      await mutate();
      setEditingPriority(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        alert('数据已被修改，请刷新');
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
        alert('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '操作失败');
      }
    } finally {
      setTogglingAttention(false);
    }
  }

  async function handleMarkDone() {
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'pending_review',
          progress_percent: 100,
          version: task.version,
        }),
      });
      await mutate();
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        alert('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '操作失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelay() {
    if (!newDueAt || !delayReason.trim()) return;
    setDelaySubmitting(true);
    setSaveError('');
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/delay`, {
        method: 'POST',
        body: JSON.stringify({
          new_due_at: new Date(newDueAt).toISOString(),
          delay_reason: delayReason,
          version: task.version,
        }),
      });
      await mutate();
      setShowDelayForm(false);
      setNewDueAt('');
      setDelayReason('');
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 409) {
        alert('数据已被修改，请刷新');
        await mutate();
      } else {
        setSaveError(err.message || '申请延期失败');
      }
    } finally {
      setDelaySubmitting(false);
    }
  }

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#5a5a6e]">正在验证登录状态...</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#5a5a6e]">加载中...</p>
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
        <p className="text-[#5a5a6e]">任务不存在</p>
      </div>
    );
  }

  const currentProgress = task.progress_percent ?? task.progressPercent ?? 0;
  const isBossAttention = task.boss_attention_flag ?? task.bossAttentionFlag ?? false;

  return (
    <div className="mx-auto max-w-3xl pb-16 pt-8">
      {/* Back */}
      <Link
        href="/tasks"
        className="inline-block text-sm text-[#3b82f6] transition-all duration-300 ease-out hover:text-[#60a5fa]"
      >
        &larr; 返回
      </Link>

      {/* Hero title */}
      <div className="mt-4 mb-8">
        <h2 className="text-2xl font-bold tracking-tight text-[#e4e4e7]">{task.title}</h2>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {/* Inline status edit */}
          {editingStatus ? (
            <div className="flex items-center gap-2">
              <select
                value={inlineStatus}
                onChange={(e) => setInlineStatus(e.target.value)}
                className="rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-2 py-1 text-xs text-[#e4e4e7]"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <button
                onClick={handleInlineStatusSave}
                disabled={saving}
                className="rounded-lg bg-[#3b82f6] px-2 py-1 text-xs text-white hover:bg-[#2563eb] disabled:opacity-50"
              >
                保存
              </button>
              <button
                onClick={() => { setEditingStatus(false); setInlineStatus(task.status); }}
                className="rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-2 py-1 text-xs text-[#8b8b9e] hover:text-[#e4e4e7]"
              >
                取消
              </button>
            </div>
          ) : (
            <button onClick={() => setEditingStatus(true)} className="cursor-pointer" title="点击修改状态">
              <StatusBadge status={task.status} />
            </button>
          )}

          {/* Inline priority edit */}
          {editingPriority ? (
            <div className="flex items-center gap-2">
              <select
                value={inlinePriority}
                onChange={(e) => setInlinePriority(e.target.value)}
                className="rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-2 py-1 text-xs text-[#e4e4e7]"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <button
                onClick={handleInlinePrioritySave}
                disabled={saving}
                className="rounded-lg bg-[#3b82f6] px-2 py-1 text-xs text-white hover:bg-[#2563eb] disabled:opacity-50"
              >
                保存
              </button>
              <button
                onClick={() => { setEditingPriority(false); setInlinePriority(task.priority); }}
                className="rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] px-2 py-1 text-xs text-[#8b8b9e] hover:text-[#e4e4e7]"
              >
                取消
              </button>
            </div>
          ) : (
            <button onClick={() => setEditingPriority(true)} className="cursor-pointer" title="点击修改优先级">
              <PriorityBadge priority={task.priority} />
            </button>
          )}

          {/* Boss attention toggle */}
          <button
            onClick={handleToggleAttention}
            disabled={togglingAttention}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-300 ease-out disabled:opacity-50 ${
              isBossAttention
                ? 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20 hover:bg-[#f59e0b]/20'
                : 'bg-[#1e1e2e] text-[#5a5a6e] border-[#2a2a3a] hover:text-[#8b8b9e]'
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

      {/* Progress section */}
      <div className="mb-6 rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-[#8b8b9e]">完成进度</p>
          <p className="tabular-nums text-2xl font-bold text-[#e4e4e7]">{currentProgress}%</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#1e1e2e]">
          <div
            className="h-full rounded-full bg-[#22c55e] transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(currentProgress, 100)}%`,
              boxShadow: '0 0 8px rgba(34,197,94,0.4)',
            }}
          />
        </div>
        {(task.latest_progress || task.latestProgress) && (
          <p className="mt-3 text-sm text-[#8b8b9e]">
            {task.latest_progress || task.latestProgress}
          </p>
        )}
      </div>

      {/* Info cards grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-5">
          <p className="text-xs font-medium text-[#5a5a6e]">任务类型</p>
          <p className="mt-1 text-sm font-medium text-[#e4e4e7]">
            {TASK_TYPE_LABELS[task.task_type || task.taskType] || task.task_type || task.taskType || '-'}
          </p>
        </div>
        <div className="rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-5">
          <p className="text-xs font-medium text-[#5a5a6e]">负责人</p>
          <p className="mt-1 text-sm font-medium text-[#e4e4e7]">{task.assignee_name || task.assigneeName || '-'}</p>
        </div>
        <div className="rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-5">
          <p className="text-xs font-medium text-[#5a5a6e]">创建人</p>
          <p className="mt-1 text-sm font-medium text-[#e4e4e7]">{task.creator_name || task.creatorName || '-'}</p>
        </div>
        <div className="rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-5">
          <p className="text-xs font-medium text-[#5a5a6e]">截止时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[#e4e4e7]">{formatDate(task.due_at || task.dueAt)}</p>
        </div>
        <div className="rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-5">
          <p className="text-xs font-medium text-[#5a5a6e]">开始时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[#e4e4e7]">{formatDate(task.start_at || task.startAt)}</p>
        </div>
        <div className="rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-5">
          <p className="text-xs font-medium text-[#5a5a6e]">创建时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[#e4e4e7]">{formatDate(task.created_at || task.createdAt)}</p>
        </div>
      </div>

      {/* Multi-Leader section */}
      <LeaderSection taskUid={taskUid} />

      {/* Collaborator section */}
      <CollaboratorSection taskUid={taskUid} />

      {/* Detail section */}
      {task.detail && (
        <div className="mb-6 rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6">
          <p className="mb-2 text-xs font-medium text-[#5a5a6e]">详细描述</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#e4e4e7]">{task.detail}</div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mb-6 flex gap-3 flex-wrap">
        <button
          onClick={() => setEditingProgress((v) => !v)}
          className="rounded-full bg-[#3b82f6] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb]"
        >
          {editingProgress ? '取消编辑' : '更新进展'}
        </button>
        <button
          onClick={handleMarkDone}
          disabled={saving}
          className="rounded-full bg-[#22c55e] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#16a34a] disabled:opacity-50"
        >
          提交完成
        </button>
        <button
          onClick={() => setShowDelayForm((v) => !v)}
          className="rounded-full bg-[#1e1e2e] border border-[#2a2a3a] px-6 py-2.5 text-sm font-medium text-[#f59e0b] transition-all duration-300 ease-out hover:bg-[#1a1a2e]"
        >
          {showDelayForm ? '取消延期' : '申请延期'}
        </button>
      </div>

      {/* Edit progress form */}
      {editingProgress && (
        <div className="mb-6 rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6">
          <h3 className="mb-5 text-lg font-semibold text-[#e4e4e7]">更新进展</h3>
          <div className="space-y-5">
            <div>
              <label htmlFor="edit_status" className="mb-1.5 block text-xs font-medium text-[#8b8b9e]">状态</label>
              <select
                id="edit_status"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className={inputClass}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit_percent" className="mb-1.5 block text-xs font-medium text-[#8b8b9e]">
                进度百分比
              </label>
              <div className="flex items-center gap-4">
                <input
                  id="edit_percent"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progressPercent}
                  onChange={(e) => setProgressPercent(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#1e1e2e] accent-[#3b82f6]"
                />
                <span className="tabular-nums text-sm font-semibold text-[#e4e4e7]">{progressPercent}%</span>
              </div>
            </div>
            <div>
              <label htmlFor="edit_progress" className="mb-1.5 block text-xs font-medium text-[#8b8b9e]">最新进展</label>
              <textarea
                id="edit_progress"
                rows={3}
                value={latestProgress}
                onChange={(e) => setLatestProgress(e.target.value)}
                className={inputClass}
                placeholder="描述最新进展..."
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleUpdateProgress}
                disabled={saving}
                className="rounded-full bg-[#3b82f6] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb] disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delay form */}
      {showDelayForm && (
        <div className="mb-6 rounded-2xl bg-[#f59e0b]/5 border border-[#f59e0b]/20 p-6">
          <h3 className="mb-5 text-lg font-semibold text-[#f59e0b]">申请延期</h3>
          <div className="space-y-5">
            <div>
              <label htmlFor="new_due_at" className="mb-1.5 block text-xs font-medium text-[#8b8b9e]">新截止时间 *</label>
              <input
                id="new_due_at"
                type="datetime-local"
                required
                value={newDueAt}
                onChange={(e) => setNewDueAt(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="delay_reason" className="mb-1.5 block text-xs font-medium text-[#8b8b9e]">延期原因 *</label>
              <textarea
                id="delay_reason"
                rows={3}
                required
                value={delayReason}
                onChange={(e) => setDelayReason(e.target.value)}
                className={inputClass}
                placeholder="请说明延期原因..."
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleDelay}
                disabled={delaySubmitting || !newDueAt || !delayReason.trim()}
                className="rounded-full bg-[#f59e0b] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#d97706] disabled:opacity-50"
              >
                {delaySubmitting ? '提交中...' : '提交延期申请'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
