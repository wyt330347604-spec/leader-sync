'use client';
import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { ensureAuth } from '@/lib/auth';

interface CollaboratorEntry {
  readonly user_id: string;
  readonly user_name: string;
}

interface UserSearchResult {
  readonly userId: string;
  readonly userName: string;
  readonly deptName: string | null;
}

const TASK_TYPES = [
  { value: 'carry_over', label: '上月遗留' },
  { value: 'new', label: '本月新增' },
];

const PRIORITIES = [
  { value: 'urgent_important', label: '重要紧急' },
  { value: 'important_not_urgent', label: '重要不紧急' },
  { value: 'urgent_not_important', label: '紧急不重要' },
  { value: 'not_urgent_not_important', label: '不紧急不重要' },
];

const inputClass =
  'block w-full rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40 focus:border-[var(--accent-blue)]/50';

const labelClass = 'mb-1.5 block text-xs font-medium text-[var(--text-secondary)]';

export default function TaskCreatePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('new');
  const [priority, setPriority] = useState('urgent_important');
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [assigneeResults, setAssigneeResults] = useState<readonly UserSearchResult[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState<{ userId: string; userName: string } | null>(null);
  const [dueAt, setDueAt] = useState('');
  const [detail, setDetail] = useState('');
  const [startAt, setStartAt] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [bossAttentionFlag, setBossAttentionFlag] = useState(false);
  const [projects, setProjects] = useState<{projectUid: string; name: string; isDefault: boolean}[]>([]);
  const [projectUid, setProjectUid] = useState('');
  const [collaborators, setCollaborators] = useState<CollaboratorEntry[]>([]);
  const [collabSearch, setCollabSearch] = useState('');
  const [collabResults, setCollabResults] = useState<readonly UserSearchResult[]>([]);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  // Fetch projects
  useEffect(() => {
    apiFetch<{projectUid: string; name: string; isDefault: boolean}[]>('/api/v1/projects')
      .then(setProjects)
      .catch(() => {});
  }, []);

  // When projects load, set default
  useEffect(() => {
    const defaultProject = projects.find(p => p.isDefault);
    if (defaultProject && !projectUid) setProjectUid(defaultProject.projectUid);
  }, [projects, projectUid]);

  // Assignee user search with debounce
  useEffect(() => {
    if (assigneeSearch.length < 1) {
      setAssigneeResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<UserSearchResult[]>(`/api/v1/users/search?q=${encodeURIComponent(assigneeSearch)}`)
        .then(setAssigneeResults)
        .catch(() => setAssigneeResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [assigneeSearch]);

  // Collaborator user search with debounce
  useEffect(() => {
    if (collabSearch.length < 1) {
      setCollabResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<UserSearchResult[]>(`/api/v1/users/search?q=${encodeURIComponent(collabSearch)}`)
        .then(setCollabResults)
        .catch(() => setCollabResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [collabSearch]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        title,
        task_type: taskType,
        priority,
        assignee_user_id: selectedAssignee?.userId ?? '',
        due_at: dueAt ? `${dueAt}T23:59:59+08:00` : undefined,
        boss_attention_flag: bossAttentionFlag,
      };
      if (detail.trim()) body.detail = detail;
      if (startAt) body.start_at = `${startAt}T00:00:00+08:00`;
      if (projectUid) body.project_uid = projectUid;
      if (collaborators.length > 0) body.collaborators = collaborators;

      const result: any = await apiFetch('/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const uid = result.task_uid || result.taskUid;
      router.push(`/tasks/${uid}`);
    } catch (err: any) {
      setError(err.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[var(--text-muted)]">正在验证登录状态...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl pb-16 pt-8">
      <Link
        href="/tasks"
        className="inline-block text-sm text-[var(--accent-blue)] transition-all duration-300 ease-out hover:text-[var(--accent-blue)]"
      >
        &larr; 返回任务列表
      </Link>

      <h2 className="mt-4 mb-8 text-3xl font-bold tracking-tight text-[var(--text-primary)]">新建任务</h2>

      {error && (
        <div className="mb-6 rounded-2xl bg-[#ef4444]/10 border border-[#ef4444]/20 px-5 py-4 text-sm text-[#ef4444]">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label htmlFor="title" className={labelClass}>标题 *</label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            placeholder="请输入任务标题"
          />
        </div>

        {/* Task type & Priority */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="task_type" className={labelClass}>任务类型</label>
            <select
              id="task_type"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              className={inputClass}
            >
              {TASK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="priority" className={labelClass}>优先级</label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={inputClass}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Assignee search */}
        <div>
          <label className={labelClass}>负责人 *</label>
          {selectedAssignee ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-3 py-1.5 text-sm text-[var(--text-primary)]">
                {selectedAssignee.userName}
                <button
                  type="button"
                  onClick={() => setSelectedAssignee(null)}
                  className="ml-0.5 text-[#ef4444] hover:text-[#f87171] transition-colors duration-150 text-xs font-bold leading-none"
                  title="移除"
                >
                  &times;
                </button>
              </span>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={assigneeSearch}
                onChange={(e) => setAssigneeSearch(e.target.value)}
                placeholder="搜索负责人姓名..."
                className={inputClass}
              />
              {assigneeSearch.length >= 1 && (
                <div className="absolute z-50 mt-1 w-full rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden shadow-lg">
                  {assigneeResults.length > 0 ? (
                    assigneeResults.map((u) => (
                      <button
                        key={u.userId}
                        type="button"
                        onClick={() => {
                          setSelectedAssignee({ userId: u.userId, userName: u.userName ?? '' });
                          setAssigneeSearch('');
                          setAssigneeResults([]);
                        }}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors duration-150"
                      >
                        <span>{u.userName}</span>
                        <span className="text-xs text-[var(--text-muted)]">{u.deptName || ''}</span>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-[var(--text-muted)]">未找到匹配人员</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Due at & Start at (day precision) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="due_at" className={labelClass}>截止日期 *</label>
            <input
              id="due_at"
              type="date"
              required
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] [color-scheme:dark] transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40 focus:border-[var(--accent-blue)]/50"
            />
          </div>
          <div>
            <label htmlFor="start_at" className={labelClass}>开始日期</label>
            <input
              id="start_at"
              type="date"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] [color-scheme:dark] transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40 focus:border-[var(--accent-blue)]/50"
            />
          </div>
        </div>

        {/* Detail */}
        <div>
          <label htmlFor="detail" className={labelClass}>详细描述</label>
          <textarea
            id="detail"
            rows={4}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            className={inputClass}
            placeholder="任务详细描述（可选）"
          />
        </div>

        {/* Project */}
        <div>
          <label htmlFor="project_uid" className={labelClass}>所属项目</label>
          <select
            id="project_uid"
            value={projectUid}
            onChange={(e) => setProjectUid(e.target.value)}
            className={inputClass}
          >
            {projects.map(p => (
              <option key={p.projectUid} value={p.projectUid}>{p.name}{p.isDefault ? ' (默认)' : ''}</option>
            ))}
          </select>
        </div>

        {/* Boss attention flag */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={bossAttentionFlag}
            onClick={() => setBossAttentionFlag(!bossAttentionFlag)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-all duration-300 ease-out ${
              bossAttentionFlag ? 'bg-[var(--accent-blue)]' : 'bg-[var(--border)]'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all duration-300 ease-out ${
                bossAttentionFlag ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
          <label
            onClick={() => setBossAttentionFlag(!bossAttentionFlag)}
            className="cursor-pointer text-sm text-[var(--text-primary)]"
          >
            重点任务
          </label>
        </div>

        {/* Collaborators */}
        <div>
          <label className={labelClass}>协作人</label>
          {/* Collaborator chips */}
          <div className="flex flex-wrap gap-2 mb-2">
            {collaborators.map((c) => (
              <span
                key={c.user_id}
                className="inline-flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-3 py-1 text-sm text-[var(--text-primary)]"
              >
                {c.user_name}
                <button
                  type="button"
                  onClick={() => setCollaborators((prev) => prev.filter((x) => x.user_id !== c.user_id))}
                  className="ml-0.5 text-[#ef4444] hover:text-[#f87171] transition-colors duration-150 text-xs font-bold leading-none"
                  title="移除"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          {/* Search input */}
          <div className="relative">
          <input
            type="text"
            value={collabSearch}
            onChange={(e) => setCollabSearch(e.target.value)}
            placeholder="搜索用户名添加协作人..."
            className={inputClass}
          />
          {/* Search results dropdown */}
          {collabSearch.length >= 1 && (
            <div className="absolute z-50 mt-1 w-full rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden shadow-lg">
              {collabResults.length > 0 ? (
                collabResults.map((u) => (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => {
                      if (!collaborators.some((c) => c.user_id === u.userId)) {
                        setCollaborators((prev) => [...prev, { user_id: u.userId, user_name: u.userName ?? '' }]);
                      }
                      setCollabSearch('');
                      setCollabResults([]);
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors duration-150"
                  >
                    <span>{u.userName}</span>
                    <span className="text-xs text-[var(--text-muted)]">{u.deptName || ''}</span>
                  </button>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-[var(--text-muted)]">未找到匹配人员</div>
              )}
            </div>
          )}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !selectedAssignee}
          className="w-full rounded-full bg-[#3b82f6] py-3.5 text-base font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? '提交中...' : !selectedAssignee ? '请先选择负责人' : '创建任务'}
        </button>

        <Link
          href="/tasks"
          className="block text-center text-sm text-[var(--text-muted)] transition-all duration-300 ease-out hover:text-[var(--text-secondary)]"
        >
          取消
        </Link>
      </form>
    </div>
  );
}
