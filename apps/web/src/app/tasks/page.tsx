'use client';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTasks } from '@/hooks/use-tasks';
import { StatusBadge } from '@/components/status-badge';
import { PriorityBadge } from '@/components/priority-badge';
import { QuickAddTask } from '@/components/quick-add-task';
import { LoadingScreen } from '@/components/loading-screen';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
  const [bucket, setBucket] = useState(getCurrentMonth);
  const [page, setPage] = useState(1);
  const [authed, setAuthed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading, mutate } = useTasks({
    status: status || undefined,
    page,
    page_size: 20,
    role,
    bucket: bucket || undefined,
  });

  const [completing, setCompleting] = useState<string | null>(null);
  const [flashTaskUid, setFlashTaskUid] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ uid: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function handleQuickCreated(newUid: string) {
    setFlashTaskUid(newUid);
    setTimeout(() => setFlashTaskUid(null), 1500);
    mutate();
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/v1/tasks/${deleteTarget.uid}`, { method: 'DELETE' });
      toast.success('已删除');
      await mutate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function handleComplete(taskUid: string, version: number) {
    if (completing) return;
    setCompleting(taskUid);
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'done',
          progress_percent: 100,
          version,
        }),
      });
      toast.success('已完成');
      await mutate();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 409) {
        toast.error('数据已被修改，请刷新');
        await mutate();
      } else {
        toast.error(err instanceof Error ? err.message : '操作失败');
      }
    } finally {
      setCompleting(null);
    }
  }

  if (!authed) {
    return <LoadingScreen />;
  }

  return (
    <div className="pb-16 pt-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">我的任务</h2>
      </div>

      {/* Role tabs */}
      <div className="mb-4 flex gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ROLE_TABS.map((r) => (
          <button
            key={r.value}
            onClick={() => { setRole(r.value); setPage(1); }}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
              role === r.value
                ? 'bg-[#6366f1] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Month filter */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="text-xs text-[var(--text-muted)] mr-1">月份:</span>
        {monthOptions.map((o) => (
          <button
            key={o.value}
            onClick={() => { setBucket(o.value); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs transition-all ${
              bucket === o.value
                ? 'bg-[#3b82f6] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border)] hover:border-[var(--accent-blue)]/50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Status filter tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1); }}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
              status === f.value
                ? 'bg-[#3b82f6] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Quick add bar (between filters and task list — most prominent CTA) */}
      <QuickAddTask onCreated={handleQuickCreated} />

      {/* Task cards */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#ef4444]">加载失败: {error.message}</p>
        </div>
      ) : (
        <>
          {data?.items?.length === 0 ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <p className="text-[var(--text-muted)]">暂无任务</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {data?.items?.map((t: any) => {
                const taskUid = t.task_uid || t.taskUid;
                const isDone = t.status === 'done';
                const isFlash = flashTaskUid === taskUid;
                return (
                  <div
                    key={taskUid}
                    onClick={() => router.push(`/tasks/${taskUid}`)}
                    className={`cursor-pointer rounded-2xl border p-5 transition-colors duration-1000 ease-out ${
                      isFlash
                        ? 'animate-in slide-in-from-top-4 fade-in duration-500 bg-[var(--accent-blue)]/15 border-[var(--accent-blue)]/40'
                        : 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-[var(--text-primary)]">{t.title}</h3>
                          {role === 'collaborator' && (
                            <span className="shrink-0 rounded-full bg-[#6366f1]/15 border border-[#6366f1]/25 px-2 py-0.5 text-[10px] font-medium text-[#818cf8]">
                              协作
                            </span>
                          )}
                        </div>
                        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                          <StatusBadge status={t.status} />
                          <PriorityBadge priority={t.priority} />
                          {(() => {
                            const n = t.delay_count ?? t.delayCount ?? 0;
                            if (n < 1) return null;
                            const danger = n >= 3;
                            const cls = danger
                              ? 'bg-[var(--accent-red)]/10 text-[var(--accent-red)] border-[var(--accent-red)]/30'
                              : 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20';
                            return (
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
                                已延期 {n} 次
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="flex flex-col items-end gap-0.5 text-xs text-[var(--text-muted)]">
                          <span className="tabular-nums">
                            {t.due_at || t.dueAt ? new Date(t.due_at || t.dueAt).toLocaleDateString('zh-CN') : '-'}
                          </span>
                          <span>{t.assignee_name || t.assigneeName || '-'}</span>
                        </div>
                        <div className="flex gap-2">
                          {!isDone && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleComplete(taskUid, t.version); }}
                              disabled={completing === taskUid}
                              className="rounded-full border border-[#22c55e]/30 bg-[#22c55e]/10 px-3 py-1 text-xs font-medium text-[#22c55e] transition-all hover:bg-[#22c55e]/20 disabled:opacity-50"
                            >
                              {completing === taskUid ? '处理中...' : '完成'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ uid: taskUid, title: t.title }); }}
                            className="rounded-full border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-red)] transition-all hover:bg-[var(--accent-red)]/20"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {data && data.total > 20 && (
            <div className="mt-8 flex items-center justify-center gap-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-full px-5 py-2 text-sm font-medium text-[#3b82f6] transition-all duration-300 ease-out hover:bg-[#3b82f6]/10 disabled:text-[var(--text-muted)] disabled:hover:bg-transparent"
              >
                上一页
              </button>
              <span className="tabular-nums text-sm text-[var(--text-muted)]">
                第 {page} 页 / 共 {data.total} 条
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={data.items.length < 20}
                className="rounded-full px-5 py-2 text-sm font-medium text-[#3b82f6] transition-all duration-300 ease-out hover:bg-[#3b82f6]/10 disabled:text-[var(--text-muted)] disabled:hover:bg-transparent"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--text-primary)]">
              确认删除任务？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--text-secondary)]">
              「{deleteTarget?.title}」删除后不可恢复，所有协作人将失去访问。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); handleDeleteConfirmed(); }}
              className="bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red)]/90"
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      }
    >
      <TaskListContent />
    </Suspense>
  );
}
