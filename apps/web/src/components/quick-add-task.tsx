'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useMe } from '@/hooks/use-me';
import { DatePicker } from '@/components/date-picker';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ProjectCategoryLabel } from '@leader-sync/shared-types';

const PRIORITIES = [
  { value: 'urgent_important', label: '重要紧急' },
  { value: 'important_not_urgent', label: '重要不紧急' },
  { value: 'urgent_not_important', label: '紧急不重要' },
  { value: 'not_urgent_not_important', label: '不紧急不重要' },
];

interface UserSearchResult {
  readonly userId: string;
  readonly userName: string;
  readonly deptName: string | null;
}

interface Project {
  readonly projectUid: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly category?: 'jt' | 'zy' | 'fw' | 'tz' | 'hz' | null;
  readonly ownerName?: string | null;
  readonly region?: string | null;
  readonly subtitle?: string | null;
}

interface QuickAddTaskProps {
  readonly onCreated: (newTaskUid: string) => void;
}

const inputCls =
  'block w-full rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40';

export function QuickAddTask({ onCreated }: QuickAddTaskProps) {
  const { data: me } = useMe();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('urgent_important');
  const [dueAt, setDueAt] = useState('');
  const [projectUid, setProjectUid] = useState('');
  const [projects, setProjects] = useState<readonly Project[]>([]);

  // Assignee combobox
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [assigneeResults, setAssigneeResults] = useState<readonly UserSearchResult[]>([]);
  const [assignee, setAssignee] = useState<{ userId: string; userName: string } | null>(null);
  const [showAssigneePopover, setShowAssigneePopover] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const projectOptions: ComboboxOption[] = useMemo(
    () => [
      { value: '', label: '选择项目' },
      ...projects.map((p) => ({
        value: p.projectUid,
        label: p.name,
        leadingDot: p.category ? `var(--cat-${p.category})` : 'var(--text-muted)',
        badge: p.subtitle ?? (p.isDefault ? '默认' : undefined),
        badgeVariant: (p.subtitle ? 'subtitle' : 'default') as 'subtitle' | 'default',
        trailing: [p.category && ProjectCategoryLabel[p.category], p.region].filter(Boolean).join(' · ') || undefined,
      })),
    ],
    [projects],
  );

  // Load projects + default
  useEffect(() => {
    apiFetch<readonly Project[]>('/api/v1/projects')
      .then((list) => {
        setProjects(list);
        const def = list.find((p) => p.isDefault);
        if (def && !projectUid) setProjectUid(def.projectUid);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default assignee = current user (only first time me loads)
  useEffect(() => {
    if (me && !assignee) {
      setAssignee({ userId: me.user_id, userName: me.user_name ?? '我' });
    }
  }, [me, assignee]);

  // Debounced assignee search
  useEffect(() => {
    if (assigneeQuery.length < 1) {
      setAssigneeResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<UserSearchResult[]>(`/api/v1/users/search?q=${encodeURIComponent(assigneeQuery)}`)
        .then(setAssigneeResults)
        .catch(() => setAssigneeResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [assigneeQuery]);

  function handleExpand() {
    setExpanded(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }

  function resetForm() {
    setTitle('');
    setPriority('urgent_important');
    setDueAt('');
    const def = projects.find((p) => p.isDefault);
    setProjectUid(def?.projectUid ?? '');
    if (me) setAssignee({ userId: me.user_id, userName: me.user_name ?? '我' });
    setAssigneeQuery('');
    setAssigneeResults([]);
    setShowAssigneePopover(false);
  }

  function handleCancel() {
    resetForm();
    setExpanded(false);
  }

  async function handleSubmit() {
    if (!title.trim() || !assignee || !dueAt || submitting) return;
    setSubmitting(true);
    try {
      const created = await apiFetch<{ task_uid?: string; taskUid?: string }>('/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          priority,
          assignee_user_id: assignee.userId,
          due_at: `${dueAt}T23:59:59+08:00`,
          ...(projectUid ? { project_uid: projectUid } : {}),
        }),
      });
      toast.success('已创建');
      resetForm();
      // keep expanded so user can quickly add another; close only on explicit cancel
      const newUid = created.task_uid || created.taskUid || '';
      onCreated(newUid);
    } catch (err: any) {
      toast.error(err.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3b82f6] to-[#2563eb] px-6 py-4 text-sm font-semibold text-white shadow-md shadow-[#3b82f6]/20 transition-all duration-200 hover:from-[#2563eb] hover:to-[#1d4ed8] hover:shadow-lg hover:shadow-[#3b82f6]/30 hover:-translate-y-0.5"
      >
        <Plus className="size-5" strokeWidth={2.5} />
        新建任务
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--text-primary)]">快速创建任务</p>
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting}
          className="rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title="取消"
        >
          <X className="size-4" />
        </button>
      </div>

      <input
        ref={titleInputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && title.trim() && assignee && dueAt) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="任务名（必填）"
        className={inputCls}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {/* Priority */}
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        {/* Project */}
        <Combobox
          value={projectUid || ''}
          onChange={(v) => setProjectUid(v ?? '')}
          options={projectOptions}
          placeholder="选择项目"
          searchPlaceholder="搜索项目"
        />

        {/* Assignee combobox */}
        <div className="relative">
          {assignee ? (
            <button
              type="button"
              onClick={() => { setAssignee(null); setShowAssigneePopover(true); }}
              className={`${inputCls} flex items-center justify-between text-left`}
            >
              <span>👤 {assignee.userName}</span>
              <X className="size-3 text-[var(--text-muted)]" />
            </button>
          ) : (
            <>
              <input
                type="text"
                value={assigneeQuery}
                onChange={(e) => { setAssigneeQuery(e.target.value); setShowAssigneePopover(true); }}
                onFocus={() => setShowAssigneePopover(true)}
                placeholder="搜索负责人（中/拼音首字母）"
                className={inputCls}
              />
              {showAssigneePopover && assigneeResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-lg">
                  {assigneeResults.map((u) => (
                    <button
                      key={u.userId}
                      type="button"
                      onClick={() => {
                        setAssignee({ userId: u.userId, userName: u.userName });
                        setAssigneeQuery('');
                        setAssigneeResults([]);
                        setShowAssigneePopover(false);
                      }}
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-[var(--bg-hover)]"
                    >
                      <span className="text-[var(--text-primary)]">{u.userName}</span>
                      <span className="text-xs text-[var(--text-muted)]">{u.deptName ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Due date */}
        <DatePicker
          value={dueAt}
          onChange={setDueAt}
          placeholder="截止日期"
          className="!py-2.5"
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <Link
          href="/tasks/create"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-blue)]"
        >
          + 高级（详情、协作人、开始日期等）
        </Link>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="rounded-full bg-[var(--bg-surface)] border border-[var(--border)] px-5 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !assignee || !dueAt}
            className="rounded-full bg-[#3b82f6] px-5 py-2 text-sm font-medium text-white transition-all hover:bg-[#2563eb] disabled:opacity-50"
          >
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
