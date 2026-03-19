'use client';
import { useState, useEffect, use } from 'react';
import Link from 'next/link';
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
  'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

function formatDate(val: string | null | undefined): string {
  if (!val) return '-';
  return new Date(val).toLocaleString('zh-CN');
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-4 gap-2 border-b py-3 last:border-b-0">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="col-span-3 text-sm text-gray-900">{children}</dd>
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

  // Delay form state
  const [showDelayForm, setShowDelayForm] = useState(false);
  const [newDueAt, setNewDueAt] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [delaySubmitting, setDelaySubmitting] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  useEffect(() => {
    if (task) {
      setNewStatus(task.status);
      setProgressPercent(task.progress_percent ?? task.progressPercent ?? 0);
      setLatestProgress(task.latest_progress ?? task.latestProgress ?? '');
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
    return <div className="py-12 text-center text-gray-500">正在验证登录状态...</div>;
  }

  if (isLoading) {
    return <div className="py-12 text-center text-gray-500">加载中...</div>;
  }

  if (error) {
    return <div className="py-12 text-center text-red-500">加载失败: {error.message}</div>;
  }

  if (!task) {
    return <div className="py-12 text-center text-gray-400">任务不存在</div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href="/tasks" className="text-sm text-blue-600 hover:underline">
          &larr; 返回任务列表
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{task.title}</h2>
          <div className="mt-2 flex gap-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {(task.boss_attention_flag ?? task.bossAttentionFlag) && (
              <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600">
                老板关注
              </span>
            )}
          </div>
        </div>
      </div>

      {saveError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* Info card */}
      <div className="mb-6 rounded-lg border bg-white p-6">
        <dl>
          <InfoRow label="任务类型">
            {TASK_TYPE_LABELS[task.task_type || task.taskType] || task.task_type || task.taskType || '-'}
          </InfoRow>
          <InfoRow label="负责人">{task.assignee_name || task.assigneeName || '-'}</InfoRow>
          <InfoRow label="创建人">{task.creator_name || task.creatorName || '-'}</InfoRow>
          <InfoRow label="截止时间">{formatDate(task.due_at || task.dueAt)}</InfoRow>
          <InfoRow label="开始时间">{formatDate(task.start_at || task.startAt)}</InfoRow>
          <InfoRow label="进度">{task.progress_percent ?? task.progressPercent ?? 0}%</InfoRow>
          <InfoRow label="最新进展">{task.latest_progress || task.latestProgress || '-'}</InfoRow>
          {(task.detail) && (
            <InfoRow label="详细描述">
              <div className="whitespace-pre-wrap">{task.detail}</div>
            </InfoRow>
          )}
          <InfoRow label="创建时间">{formatDate(task.created_at || task.createdAt)}</InfoRow>
          <InfoRow label="更新时间">{formatDate(task.updated_at || task.updatedAt)}</InfoRow>
        </dl>
      </div>

      {/* Actions */}
      <div className="mb-6 flex gap-3">
        <button
          onClick={() => setEditingProgress((v) => !v)}
          className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {editingProgress ? '取消编辑' : '更新进展'}
        </button>
        <button
          onClick={handleMarkDone}
          disabled={saving}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          提交完成
        </button>
        <button
          onClick={() => setShowDelayForm((v) => !v)}
          className="rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-600 hover:bg-orange-50"
        >
          {showDelayForm ? '取消延期' : '申请延期'}
        </button>
      </div>

      {/* Edit progress form */}
      {editingProgress && (
        <div className="mb-6 rounded-lg border bg-white p-6">
          <h3 className="mb-4 font-medium">更新进展</h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="edit_status" className="mb-1 block text-sm font-medium text-gray-700">状态</label>
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
              <label htmlFor="edit_percent" className="mb-1 block text-sm font-medium text-gray-700">
                进度百分比: {progressPercent}%
              </label>
              <input
                id="edit_percent"
                type="range"
                min={0}
                max={100}
                step={5}
                value={progressPercent}
                onChange={(e) => setProgressPercent(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="edit_progress" className="mb-1 block text-sm font-medium text-gray-700">最新进展</label>
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
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delay form */}
      {showDelayForm && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-6">
          <h3 className="mb-4 font-medium text-orange-700">申请延期</h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="new_due_at" className="mb-1 block text-sm font-medium text-gray-700">新截止时间 *</label>
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
              <label htmlFor="delay_reason" className="mb-1 block text-sm font-medium text-gray-700">延期原因 *</label>
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
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
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
