'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTasks } from '@/hooks/use-tasks';
import { StatusBadge } from '@/components/status-badge';
import { PriorityBadge } from '@/components/priority-badge';
import { ensureAuth } from '@/lib/auth';

const STATUS_FILTERS = [
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'done' },
  { label: '已停滞', value: 'stalled' },
  { label: '全部', value: '' },
];

const ROLE_TABS = [
  { label: '全部', value: 'all' },
  { label: '我负责的', value: 'assignee' },
  { label: '我协作的', value: 'collaborator' },
];

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthOptions() {
  const options: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.push({ label: `${d.getFullYear()}年${d.getMonth() + 1}月`, value });
  }
  options.push({ label: '全部月份', value: '' });
  return options;
}

const monthOptions = buildMonthOptions();

function TaskListContent() {
  const [status, setStatus] = useState('active');
  const [role, setRole] = useState('all');
  const [bucket, setBucket] = useState(() => getCurrentMonth());
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
    role,
    bucket: bucket || undefined,
  });

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#5a5a6e]">正在验证登录状态...</p>
      </div>
    );
  }

  return (
    <div className="pb-16 pt-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-[#e4e4e7]">我的任务</h2>
        <Link
          href="/tasks/create"
          className="rounded-full bg-[#3b82f6] px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[#2563eb]"
        >
          新建任务
        </Link>
      </div>

      {/* Role tabs */}
      <div className="mb-4 flex gap-2">
        {ROLE_TABS.map((r) => (
          <button
            key={r.value}
            onClick={() => { setRole(r.value); setPage(1); }}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
              role === r.value
                ? 'bg-[#6366f1] text-white'
                : 'bg-[#1e1e2e] text-[#8b8b9e] border border-[#2a2a3a] hover:bg-[#1a1a2e] hover:text-[#e4e4e7]'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Month filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#5a5a6e] mr-1">月份:</span>
        {monthOptions.map((o) => (
          <button
            key={o.value}
            onClick={() => { setBucket(o.value); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs transition-all ${
              bucket === o.value
                ? 'bg-[#3b82f6] text-white'
                : 'bg-[#1e1e2e] text-[#8b8b9e] border border-[#2a2a3a] hover:border-[#3b82f6]/50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Status filter tabs */}
      <div className="mb-6 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1); }}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
              status === f.value
                ? 'bg-[#3b82f6] text-white'
                : 'bg-[#1e1e2e] text-[#8b8b9e] border border-[#2a2a3a] hover:bg-[#1a1a2e] hover:text-[#e4e4e7]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Task cards */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#5a5a6e]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#ef4444]">加载失败: {error.message}</p>
        </div>
      ) : (
        <>
          {data?.items?.length === 0 ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <p className="text-[#5a5a6e]">暂无任务</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {data?.items?.map((t: any) => (
                <div
                  key={t.task_uid || t.taskUid}
                  onClick={() => router.push(`/tasks/${t.task_uid || t.taskUid}`)}
                  className="cursor-pointer rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-5 transition-all duration-300 ease-out hover:bg-[#1a1a2e]"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-[#e4e4e7]">{t.title}</h3>
                        {role === 'collaborator' && (
                          <span className="shrink-0 rounded-full bg-[#6366f1]/15 border border-[#6366f1]/25 px-2 py-0.5 text-[10px] font-medium text-[#818cf8]">
                            协作
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <StatusBadge status={t.status} />
                        <PriorityBadge priority={t.priority} />
                        {(t.is_carried_over || t.isCarriedOver) && (
                          <span className="inline-flex items-center rounded-full bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 px-2 py-0.5 text-xs">
                            顺延
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4 flex shrink-0 flex-col items-end gap-1 text-xs text-[#5a5a6e]">
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
                className="rounded-full px-5 py-2 text-sm font-medium text-[#3b82f6] transition-all duration-300 ease-out hover:bg-[#3b82f6]/10 disabled:text-[#5a5a6e] disabled:hover:bg-transparent"
              >
                上一页
              </button>
              <span className="tabular-nums text-sm text-[#5a5a6e]">
                第 {page} 页 / 共 {data.total} 条
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={data.items.length < 20}
                className="rounded-full px-5 py-2 text-sm font-medium text-[#3b82f6] transition-all duration-300 ease-out hover:bg-[#3b82f6]/10 disabled:text-[#5a5a6e] disabled:hover:bg-transparent"
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
          <p className="text-[#5a5a6e]">加载中...</p>
        </div>
      }
    >
      <TaskListContent />
    </Suspense>
  );
}
