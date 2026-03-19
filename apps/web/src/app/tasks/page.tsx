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
    return <div className="py-12 text-center text-gray-500">正在验证登录状态...</div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold">我的任务</h2>
        <Link
          href="/tasks/create"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          新建任务
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1); }}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              status === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-500">加载中...</div>
      ) : error ? (
        <div className="py-12 text-center text-red-500">加载失败: {error.message}</div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium">标题</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">优先级</th>
                  <th className="px-4 py-3 font-medium">截止时间</th>
                  <th className="px-4 py-3 font-medium">负责人</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.items?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      暂无任务
                    </td>
                  </tr>
                ) : (
                  data?.items?.map((t: any) => (
                    <tr
                      key={t.task_uid || t.taskUid}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/tasks/${t.task_uid || t.taskUid}`)}
                    >
                      <td className="px-4 py-3 font-medium">{t.title}</td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                      <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                      <td className="px-4 py-3 text-gray-500">
                        {t.due_at || t.dueAt ? new Date(t.due_at || t.dueAt).toLocaleDateString('zh-CN') : '-'}
                      </td>
                      <td className="px-4 py-3">{t.assignee_name || t.assigneeName || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.total > 20 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-gray-500">共 {data.total} 条</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                >
                  上一页
                </button>
                <span className="px-2 py-1 text-sm">第 {page} 页</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={data.items.length < 20}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-gray-500">加载中...</div>}>
      <TaskListContent />
    </Suspense>
  );
}
