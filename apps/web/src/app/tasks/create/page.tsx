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
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

const labelClass = 'mb-1 block text-sm font-medium text-gray-700';

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
    return <div className="py-12 text-center text-gray-500">正在验证登录状态...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/tasks" className="text-sm text-blue-600 hover:underline">
          &larr; 返回任务列表
        </Link>
        <h2 className="text-xl font-semibold">新建任务</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border bg-white p-6">
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
        <div className="flex items-center gap-2">
          <input
            id="boss_attention"
            type="checkbox"
            checked={bossAttentionFlag}
            onChange={(e) => setBossAttentionFlag(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="boss_attention" className="text-sm text-gray-700">
            老板关注
          </label>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Link
            href="/tasks"
            className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? '提交中...' : '创建任务'}
          </button>
        </div>
      </form>
    </div>
  );
}
