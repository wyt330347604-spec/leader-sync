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
  'block w-full rounded-xl bg-[#f5f5f7] px-4 py-3 text-sm text-[#1d1d1f] placeholder-[#86868b] transition-all duration-300 ease-out focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0071e3]/40 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.1)]';

function formatDate(val: string | null | undefined): string {
  if (!val) return '-';
  return new Date(val).toLocaleString('zh-CN');
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
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#86868b]">正在验证登录状态...</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#86868b]">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#ff3b30]">加载失败: {error.message}</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#86868b]">任务不存在</p>
      </div>
    );
  }

  const currentProgress = task.progress_percent ?? task.progressPercent ?? 0;

  return (
    <div className="mx-auto max-w-3xl pb-16 pt-8">
      {/* Back */}
      <Link
        href="/tasks"
        className="inline-block text-sm text-[#0071e3] transition-all duration-300 ease-out hover:text-[#0077ed]"
      >
        &larr; 返回
      </Link>

      {/* Hero title */}
      <div className="mt-4 mb-8">
        <h2 className="text-2xl font-bold tracking-tight text-[#1d1d1f]">{task.title}</h2>
        <div className="mt-3 flex items-center gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {(task.boss_attention_flag ?? task.bossAttentionFlag) && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ff3b30]/5 px-2.5 py-1 text-xs font-medium text-[#ff3b30]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ff3b30]" />
              老板关注
            </span>
          )}
        </div>
      </div>

      {saveError && (
        <div className="mb-6 rounded-2xl bg-[#ff3b30]/5 px-5 py-4 text-sm text-[#ff3b30]">
          {saveError}
        </div>
      )}

      {/* Progress section */}
      <div className="mb-6 rounded-2xl bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-[#6e6e73]">完成进度</p>
          <p className="tabular-nums text-2xl font-bold text-[#1d1d1f]">{currentProgress}%</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f5f5f7]">
          <div
            className="h-full rounded-full bg-[#34c759] transition-all duration-500 ease-out"
            style={{ width: `${Math.min(currentProgress, 100)}%` }}
          />
        </div>
        {(task.latest_progress || task.latestProgress) && (
          <p className="mt-3 text-sm text-[#6e6e73]">
            {task.latest_progress || task.latestProgress}
          </p>
        )}
      </div>

      {/* Info cards grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-medium text-[#86868b]">任务类型</p>
          <p className="mt-1 text-sm font-medium text-[#1d1d1f]">
            {TASK_TYPE_LABELS[task.task_type || task.taskType] || task.task_type || task.taskType || '-'}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-medium text-[#86868b]">负责人</p>
          <p className="mt-1 text-sm font-medium text-[#1d1d1f]">{task.assignee_name || task.assigneeName || '-'}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-medium text-[#86868b]">创建人</p>
          <p className="mt-1 text-sm font-medium text-[#1d1d1f]">{task.creator_name || task.creatorName || '-'}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-medium text-[#86868b]">截止时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[#1d1d1f]">{formatDate(task.due_at || task.dueAt)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-medium text-[#86868b]">开始时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[#1d1d1f]">{formatDate(task.start_at || task.startAt)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-medium text-[#86868b]">创建时间</p>
          <p className="mt-1 tabular-nums text-sm font-medium text-[#1d1d1f]">{formatDate(task.created_at || task.createdAt)}</p>
        </div>
      </div>

      {/* Detail section */}
      {task.detail && (
        <div className="mb-6 rounded-2xl bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <p className="mb-2 text-xs font-medium text-[#86868b]">详细描述</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#1d1d1f]">{task.detail}</div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mb-6 flex gap-3">
        <button
          onClick={() => setEditingProgress((v) => !v)}
          className="rounded-full bg-[#0071e3] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#0077ed] hover:shadow-[0_4px_16px_rgba(0,113,227,0.3)]"
        >
          {editingProgress ? '取消编辑' : '更新进展'}
        </button>
        <button
          onClick={handleMarkDone}
          disabled={saving}
          className="rounded-full bg-[#34c759] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#2db84e] hover:shadow-[0_4px_16px_rgba(52,199,89,0.3)] disabled:opacity-50"
        >
          提交完成
        </button>
        <button
          onClick={() => setShowDelayForm((v) => !v)}
          className="rounded-full border-0 bg-white px-6 py-2.5 text-sm font-medium text-[#ff9500] shadow-[0_2px_12px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        >
          {showDelayForm ? '取消延期' : '申请延期'}
        </button>
      </div>

      {/* Edit progress form */}
      {editingProgress && (
        <div className="mb-6 rounded-2xl bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
          <h3 className="mb-5 text-lg font-semibold text-[#1d1d1f]">更新进展</h3>
          <div className="space-y-5">
            <div>
              <label htmlFor="edit_status" className="mb-1.5 block text-xs font-medium text-[#6e6e73]">状态</label>
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
              <label htmlFor="edit_percent" className="mb-1.5 block text-xs font-medium text-[#6e6e73]">
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
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#f5f5f7] accent-[#0071e3]"
                />
                <span className="tabular-nums text-sm font-semibold text-[#1d1d1f]">{progressPercent}%</span>
              </div>
            </div>
            <div>
              <label htmlFor="edit_progress" className="mb-1.5 block text-xs font-medium text-[#6e6e73]">最新进展</label>
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
                className="rounded-full bg-[#0071e3] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#0077ed] hover:shadow-[0_4px_16px_rgba(0,113,227,0.3)] disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delay form */}
      {showDelayForm && (
        <div className="mb-6 rounded-2xl bg-[#ff9500]/5 p-6">
          <h3 className="mb-5 text-lg font-semibold text-[#ff9500]">申请延期</h3>
          <div className="space-y-5">
            <div>
              <label htmlFor="new_due_at" className="mb-1.5 block text-xs font-medium text-[#6e6e73]">新截止时间 *</label>
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
              <label htmlFor="delay_reason" className="mb-1.5 block text-xs font-medium text-[#6e6e73]">延期原因 *</label>
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
                className="rounded-full bg-[#ff9500] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#e68600] hover:shadow-[0_4px_16px_rgba(255,149,0,0.3)] disabled:opacity-50"
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
