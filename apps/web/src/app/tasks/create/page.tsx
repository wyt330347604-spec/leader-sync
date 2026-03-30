'use client';
import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { ensureAuth } from '@/lib/auth';

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
  'block w-full rounded-xl bg-[#1e1e2e] border border-[#2a2a3a] px-4 py-3 text-sm text-[#e4e4e7] placeholder-[#5a5a6e] transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/40 focus:border-[#3b82f6]/50';

const labelClass = 'mb-1.5 block text-xs font-medium text-[#8b8b9e]';

export default function TaskCreatePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('new');
  const [priority, setPriority] = useState('urgent_important');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [detail, setDetail] = useState('');
  const [startAt, setStartAt] = useState('');
  const [bossAttentionFlag, setBossAttentionFlag] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        title,
        task_type: taskType,
        priority,
        assignee_user_id: assigneeUserId,
        due_at: new Date(dueAt).toISOString(),
        boss_attention_flag: bossAttentionFlag,
      };
      if (detail.trim()) body.detail = detail;
      if (startAt) body.start_at = new Date(startAt).toISOString();

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
        <p className="text-[#5a5a6e]">正在验证登录状态...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl pb-16 pt-8">
      <Link
        href="/tasks"
        className="inline-block text-sm text-[#3b82f6] transition-all duration-300 ease-out hover:text-[#60a5fa]"
      >
        &larr; 返回任务列表
      </Link>

      <h2 className="mt-4 mb-8 text-3xl font-bold tracking-tight text-[#e4e4e7]">新建任务</h2>

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

        {/* Assignee */}
        <div>
          <label htmlFor="assignee" className={labelClass}>负责人 ID *</label>
          <input
            id="assignee"
            type="text"
            required
            value={assigneeUserId}
            onChange={(e) => setAssigneeUserId(e.target.value)}
            className={inputClass}
            placeholder="请输入负责人用户 ID"
          />
        </div>

        {/* Due at & Start at */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="due_at" className={labelClass}>截止时间 *</label>
            <input
              id="due_at"
              type="datetime-local"
              required
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="start_at" className={labelClass}>开始时间</label>
            <input
              id="start_at"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className={inputClass}
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

        {/* Boss attention flag */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={bossAttentionFlag}
            onClick={() => setBossAttentionFlag(!bossAttentionFlag)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-all duration-300 ease-out ${
              bossAttentionFlag ? 'bg-[#3b82f6]' : 'bg-[#2a2a3a]'
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
            className="cursor-pointer text-sm text-[#e4e4e7]"
          >
            重点任务
          </label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-[#3b82f6] py-3.5 text-base font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb] disabled:opacity-50"
        >
          {submitting ? '提交中...' : '创建任务'}
        </button>

        <Link
          href="/tasks"
          className="block text-center text-sm text-[#5a5a6e] transition-all duration-300 ease-out hover:text-[#8b8b9e]"
        >
          取消
        </Link>
      </form>
    </div>
  );
}
