'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTasks } from '@/hooks/use-tasks';
import { StatusBadge } from '@/components/status-badge';
import { PriorityBadge } from '@/components/priority-badge';
import { ensureAuth } from '@/lib/auth';

const STATUS_FILTERS = [
  { label: '全部', value: '' },
  { label: '进行中', value: 'in_progress' },
  { label: '已完成', value: 'done' },
  { label: '阻塞', value: 'blocked' },
  { label: '待验收', value: 'pending_review' },
];

function TaskListContent() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [authed, setAuthed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading } = useTasks({
    status: status || undefined,
    page,
    page_size: 20,
  });

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#86868b]">正在验证登录状态...</p>
      </div>
    );
  }

  return (
    <div className="pb-16 pt-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-[#1d1d1f]">我的任务</h2>
        <Link
          href="/tasks/create"
          className="rounded-full bg-[#0071e3] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#0077ed] hover:shadow-[0_4px_16px_rgba(0,113,227,0.3)]"
        >
          新建任务
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="mb-6 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1); }}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
              status === f.value
                ? 'bg-[#0071e3] text-white shadow-[0_2px_12px_rgba(0,113,227,0.3)]'
                : 'bg-white text-[#6e6e73] shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Task cards */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#86868b]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#ff3b30]">加载失败: {error.message}</p>
        </div>
      ) : (
        <>
          {data?.items?.length === 0 ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <p className="text-[#86868b]">暂无任务</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {data?.items?.map((t: any) => (
                <div
                  key={t.task_uid || t.taskUid}
                  onClick={() => router.push(`/tasks/${t.task_uid || t.taskUid}`)}
                  className="cursor-pointer rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-[#1d1d1f]">{t.title}</h3>
                      <div className="mt-2.5 flex items-center gap-2">
                        <StatusBadge status={t.status} />
                        <PriorityBadge priority={t.priority} />
                      </div>
                    </div>
                    <div className="ml-4 flex shrink-0 flex-col items-end gap-1 text-xs text-[#86868b]">
                      <span className="tabular-nums">
                        {t.due_at || t.dueAt ? new Date(t.due_at || t.dueAt).toLocaleDateString('zh-CN') : '-'}
                      </span>
                      <span>{t.assignee_name || t.assigneeName || '-'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {data && data.total > 20 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-full px-5 py-2 text-sm font-medium text-[#0071e3] transition-all duration-300 ease-out hover:bg-[#0071e3]/5 disabled:text-[#86868b] disabled:hover:bg-transparent"
              >
                上一页
              </button>
              <span className="tabular-nums text-sm text-[#86868b]">
                第 {page} 页 / 共 {data.total} 条
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={data.items.length < 20}
                className="rounded-full px-5 py-2 text-sm font-medium text-[#0071e3] transition-all duration-300 ease-out hover:bg-[#0071e3]/5 disabled:text-[#86868b] disabled:hover:bg-transparent"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[#86868b]">加载中...</p>
        </div>
      }
    >
      <TaskListContent />
    </Suspense>
  );
}
