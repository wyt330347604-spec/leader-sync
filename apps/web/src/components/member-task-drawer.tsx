'use client';
import { useEffect, useRef } from 'react';
import { useLeaderMemberTasks } from '@/hooks/use-leader-member-tasks';
import { StatusBadge } from '@/components/status-badge';

interface MemberTaskDrawerProps {
  readonly userId: string | null;
  readonly userName: string;
  readonly month: string;
  readonly onClose: () => void;
}

export function MemberTaskDrawer({ userId, userName, month, onClose }: MemberTaskDrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error } = useLeaderMemberTasks(userId, month, !!userId);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!userId) return null;

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--bg-card)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">{userName}</h3>
            <p className="text-xs text-[var(--text-muted)]">{month} 任务明细</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Summary */}
        {data?.summary && (
          <div className="flex items-center gap-4 border-b border-[var(--border)] px-5 py-3 text-sm">
            <span className="text-[var(--text-secondary)]">总 {data.summary.total}</span>
            <span className="text-[var(--accent-green)]">完 {data.summary.done}</span>
            <span className={data.summary.overdue > 0 ? 'text-[var(--accent-red)] font-semibold' : 'text-[var(--text-secondary)]'}>
              延 {data.summary.overdue}
            </span>
            <span className="ml-auto font-bold tabular-nums text-[var(--text-primary)]">
              {data.summary.completionRate}%
            </span>
          </div>
        )}

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--text-muted)]">加载中...</p>
            </div>
          )}
          {error && (
            <div className="p-5">
              <p className="text-[var(--accent-red)] text-sm">加载失败: {error.message}</p>
            </div>
          )}
          {data?.tasks && data.tasks.length === 0 && (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--text-muted)]">暂无任务</p>
            </div>
          )}
          {data?.tasks && data.tasks.map((task) => (
            <a
              key={task.taskUid}
              href={`/tasks?task=${task.taskUid}`}
              className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {task.bossAttentionFlag && (
                    <span className="shrink-0 text-[10px] text-[var(--accent-orange)]">★</span>
                  )}
                  <span className="truncate text-sm font-medium text-[var(--text-primary)]">{task.title}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <StatusBadge status={task.status} />
                  {task.isOverdue && (
                    <span className="text-xs font-medium text-[var(--accent-red)]">已逾期</span>
                  )}
                  {task.delayCount > 0 && (
                    <span className="text-xs text-[var(--accent-orange)]">延期 {task.delayCount} 次</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-[var(--text-muted)]">
                {task.dueAt ? new Date(task.dueAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : ''}
                {task.progressPercent > 0 && (
                  <p className="mt-0.5 tabular-nums">{task.progressPercent}%</p>
                )}
              </div>
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
