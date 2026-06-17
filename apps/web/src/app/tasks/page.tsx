'use client';
import { useState, useEffect, useRef, Suspense, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTasks } from '@/hooks/use-tasks';
import { StatusBadge } from '@/components/status-badge';
import { QuickAddTask } from '@/components/quick-add-task';
import { LoadingScreen } from '@/components/loading-screen';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { ProjectCategoryOrder } from '@leader-sync/shared-types';
import { GripVertical } from 'lucide-react';
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
  { label: '已删除', value: 'deleted' },
  { label: '全部', value: '' },
];

const ROLE_TABS = [
  { label: '全部', value: 'all' },
  { label: '我负责的', value: 'assignee' },
  { label: '我协作的', value: 'collaborator' },
];

// #1 一级分组：紧急重要程度（艾森豪威尔四象限），按此顺序展示
const PRIORITY_GROUPS = [
  { value: 'urgent_important', label: '重要且紧急', accent: 'var(--accent-red)' },
  { value: 'important_not_urgent', label: '重要不紧急', accent: 'var(--accent-orange)' },
  { value: 'urgent_not_important', label: '紧急不重要', accent: 'var(--accent-blue)' },
  { value: 'not_urgent_not_important', label: '不紧急不重要', accent: 'var(--text-muted)' },
];

function isCarried(t: any): boolean {
  return Boolean(t.is_carried_over ?? t.isCarriedOver) || (t.carry_over_count ?? t.carryOverCount ?? 0) >= 1;
}

const NO_PROJECT_KEY = '__none__';
const PROJECT_FALLBACK_COLOR = '#94A3B8'; // 与 projects 页一致：未分类项目的中性灰

function uidOf(t: any): string {
  return t.task_uid || t.taskUid;
}

// 项目色块颜色：取自项目分类 category（--cat-*），无分类/无项目用中性灰。
function projectColor(category?: string | null): string {
  return category ? `var(--cat-${category})` : PROJECT_FALLBACK_COLOR;
}

function projectOf(t: any): { key: string; name: string; category: string | null } {
  const uid = t.project_uid || t.projectUid;
  if (!uid) return { key: NO_PROJECT_KEY, name: '未归属项目', category: null };
  return { key: uid, name: t.projectName || t.project_name || '项目', category: t.projectCategory ?? t.project_category ?? null };
}

// 紧凑环形完成度指示（conic-gradient，无 SVG）。
function MiniProgress({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const color = p >= 100 ? 'var(--accent-green)' : p > 0 ? 'var(--accent-blue)' : 'var(--text-muted)';
  return (
    <div
      className="relative h-7 w-7 shrink-0 rounded-full"
      title={`完成度 ${p}%`}
      style={{ background: `conic-gradient(${color} ${p * 3.6}deg, color-mix(in srgb, var(--border) 70%, transparent) 0deg)` }}
    >
      <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-[var(--bg-card)]">
        <span className="text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{p}</span>
      </div>
    </div>
  );
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// "本月及未来"哨兵值：列表按 month_bucket >= 当前自然月过滤（含未来截止的任务）。
const UPCOMING = '__upcoming__';

function buildMonthOptions() {
  const options: { label: string; value: string }[] = [];
  // 默认视图：本月及未来——管理"现在和接下来要做的事"，未来截止任务也可见。
  options.push({ label: '本月及未来', value: UPCOMING });
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
  const [bucket, setBucket] = useState<string>(UPCOMING);
  const [authed, setAuthed] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  // #3 不分页：一次拉全（page_size 取大值）。
  // 月份语义：UPCOMING→from=当前月（本月及未来）；''→全部；具体月→精确匹配该月。
  const { data, error, isLoading, mutate } = useTasks({
    status: status || undefined,
    page: 1,
    page_size: 500,
    role,
    bucket: bucket === UPCOMING || bucket === '' ? undefined : bucket,
    from: bucket === UPCOMING ? getCurrentMonth() : undefined,
  });

  const [completing, setCompleting] = useState<string | null>(null);
  // 操作反馈：create=蓝色脉冲、done=绿色脉冲；removingUid=删除淡出
  const [flash, setFlash] = useState<{ uid: string; kind: 'create' | 'done' } | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const scrolledFlashRef = useRef<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ uid: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const isDeletedView = status === 'deleted';

  // #2 就地展开（替代详情页）
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState(false);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [projectList, setProjectList] = useState<{ projectUid: string; name: string; parentProjectUid?: string | null }[]>([]);

  // 批量归类（未归属 triage）：选择模式 + 已选集合 + 目标项目
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [bulkProject, setBulkProject] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // 分组维度：按优先级（艾森豪威尔）或按项目（项目驱动）
  const [groupMode, setGroupMode] = useState<'priority' | 'project'>('priority');
  // 拖拽排序态（原生 HTML5 DnD，仅桌面）：当前拖拽 uid + 悬停目标 uid + 所在分组 key
  const [dragUid, setDragUid] = useState<string | null>(null);
  const [dragOverUid, setDragOverUid] = useState<string | null>(null);
  const [dragGroupKey, setDragGroupKey] = useState<string | null>(null);
  // 拖拽后的本地排序覆盖（uid → position），优先于服务端 userPosition，PUT 成功后由 revalidate 接管。
  const [orderOverride, setOrderOverride] = useState<Record<string, number>>({});
  // 展开面板编辑模式
  const [editing, setEditing] = useState(false);
  const [ef, setEf] = useState<{ title: string; detail: string; priority: string; due: string; latest: string }>(
    { title: '', detail: '', priority: '', due: '', latest: '' },
  );

  function startEdit(t: any) {
    const due = t.due_at || t.dueAt;
    setEf({
      title: t.title ?? '',
      detail: t.detail ?? '',
      priority: t.priority ?? 'urgent_important',
      due: due ? new Date(due).toISOString().slice(0, 10) : '',
      latest: t.latest_progress ?? t.latestProgress ?? '',
    });
    setEditing(true);
  }

  async function saveEdit(t: any) {
    const taskUid = t.task_uid || t.taskUid;
    const patch: Record<string, unknown> = { version: t.version };
    if (ef.title.trim() && ef.title !== t.title) patch.title = ef.title.trim();
    if (ef.detail !== (t.detail ?? '')) patch.detail = ef.detail;
    if (ef.priority !== t.priority) patch.priority = ef.priority;
    if (ef.due) patch.due_at = `${ef.due}T23:59:59+08:00`;
    if (ef.latest !== (t.latest_progress ?? t.latestProgress ?? '')) patch.latest_progress = ef.latest;
    await patchTask(taskUid, patch, '已保存');
    setEditing(false);
  }

  // 项目名映射（展开面板展示用）+ 项目列表（批量归类下拉用）
  useEffect(() => {
    apiFetch<readonly { projectUid: string; name: string; parentProjectUid?: string | null }[]>('/api/v1/projects')
      .then((list) => {
        setProjectNames(Object.fromEntries(list.map((p) => [p.projectUid, p.name])));
        setProjectList(list.map((p) => ({ projectUid: p.projectUid, name: p.name, parentProjectUid: p.parentProjectUid ?? null })));
      })
      .catch(() => {});
  }, []);

  function toggleSelect(uid: string) {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }
  function exitSelect() {
    setSelectMode(false);
    setSelectedUids(new Set());
    setBulkProject('');
  }
  async function handleBulkAssign() {
    if (selectedUids.size === 0 || bulkSubmitting) return;
    setBulkSubmitting(true);
    try {
      const res = await apiFetch<{ updated: number; skipped: number }>('/api/v1/tasks/bulk-project', {
        method: 'PUT',
        body: JSON.stringify({ task_uids: [...selectedUids], project_uid: bulkProject || null }),
      });
      toast.success(`已归类 ${res.updated} 项${res.skipped ? `，跳过 ${res.skipped}（无权限）` : ''}`);
      exitSelect();
      await mutate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '批量归类失败');
    } finally {
      setBulkSubmitting(false);
    }
  }

  // 深链：/tasks?task=<uid> 自动展开（来自驾驶舱/事故/成员抽屉等）。
  // 放宽筛选到 全部状态/全部月份，确保目标任务在列表内可被展开。
  useEffect(() => {
    const t = searchParams.get('task');
    if (t) {
      setExpandedUid(t);
      setStatus('');
      setBucket('');
    }
  }, [searchParams]);

  function handleQuickCreated(newUid: string) {
    scrolledFlashRef.current = null; // 允许滚动到新任务
    setFlash({ uid: newUid, kind: 'create' });
    setTimeout(() => setFlash((f) => (f?.uid === newUid ? null : f)), 2000);
    mutate();
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget || deleting) return;
    const uid = deleteTarget.uid;
    setDeleting(true);
    try {
      await apiFetch(`/api/v1/tasks/${uid}`, { method: 'DELETE' });
      setDeleteTarget(null);
      // 先播放淡出退场动画，再刷新列表（避免任务“瞬间消失”）
      setRemovingUid(uid);
      await new Promise((r) => setTimeout(r, 300));
      toast.success('已删除');
      await mutate();
      setRemovingUid(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败');
      setRemovingUid(null);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRestore(taskUid: string) {
    if (restoring) return;
    setRestoring(taskUid);
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/restore`, { method: 'POST' });
      toast.success('已恢复');
      await mutate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '恢复失败');
    } finally {
      setRestoring(null);
    }
  }

  // 就地展开面板的内联操作（改状态 / 更新进度 / 转公开）
  async function patchTask(taskUid: string, body: Record<string, unknown>, okMsg: string) {
    if (savingAction) return;
    setSavingAction(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success(okMsg);
      await mutate();
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.code === 409 || err.code === 1009)) {
        toast.error('数据已被修改，请刷新');
        await mutate();
      } else {
        toast.error(err instanceof Error ? err.message : '操作失败');
      }
    } finally {
      setSavingAction(false);
    }
  }

  async function handlePublish(taskUid: string) {
    if (savingAction) return;
    setSavingAction(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskUid}/publish`, { method: 'POST' });
      toast.success('已转为公开');
      await mutate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '转公开失败');
    } finally {
      setSavingAction(false);
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
      // 绿色脉冲反馈：让“完成”这一动作看得见
      setFlash({ uid: taskUid, kind: 'done' });
      setTimeout(() => setFlash((f) => (f?.uid === taskUid ? null : f)), 2000);
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

  // 全列表默认顺序索引（uid → 位置），作为无手动排序时的稳定回落。
  const apiIndex: Record<string, number> = {};
  (data?.items ?? []).forEach((t: any, i: number) => { apiIndex[uidOf(t)] = i; });

  // 组内排序键：本地覆盖 > 服务端 userPosition > 默认顺序（排其后）。
  function sortKey(t: any): number {
    const uid = uidOf(t);
    if (orderOverride[uid] != null) return orderOverride[uid];
    const up = t.userPosition ?? t.user_position;
    if (up != null) return up;
    return 1e9 + (apiIndex[uid] ?? 0);
  }
  function sortGroup(items: any[]): any[] {
    return [...items].sort((a, b) => sortKey(a) - sortKey(b));
  }

  // 按当前维度分组，组内已排序。
  function buildGroups(items: any[]): { key: string; label: string; accent: string; items: any[] }[] {
    if (groupMode === 'project') {
      const map = new Map<string, { key: string; label: string; accent: string; category: string | null; items: any[] }>();
      for (const t of items) {
        const p = projectOf(t);
        if (!map.has(p.key)) map.set(p.key, { key: p.key, label: p.name, accent: projectColor(p.category), category: p.category, items: [] });
        map.get(p.key)!.items.push(t);
      }
      const arr = Array.from(map.values());
      // 排序：有分类的按 category 顺序，再按名称；无项目分组排最后。
      arr.sort((a, b) => {
        if (a.key === NO_PROJECT_KEY) return 1;
        if (b.key === NO_PROJECT_KEY) return -1;
        const ai = a.category ? ProjectCategoryOrder.indexOf(a.category as any) : 99;
        const bi = b.category ? ProjectCategoryOrder.indexOf(b.category as any) : 99;
        if (ai !== bi) return ai - bi;
        return a.label.localeCompare(b.label, 'zh');
      });
      return arr.map((g) => ({ key: g.key, label: g.label, accent: g.accent, items: sortGroup(g.items) }));
    }
    // 优先级维度
    const known = new Set(PRIORITY_GROUPS.map((g) => g.value));
    const rest = items.filter((t: any) => !known.has(t.priority));
    return [
      ...PRIORITY_GROUPS.map((g) => ({ key: g.value, label: g.label, accent: g.accent, items: sortGroup(items.filter((t: any) => t.priority === g.value)) })),
      ...(rest.length ? [{ key: '_other', label: '其他', accent: 'var(--text-muted)', items: sortGroup(rest) }] : []),
    ];
  }

  // 拖拽落定：把 dragUid 移动到 dropUid 位置，写本地覆盖并持久化该组顺序。
  async function handleDropReorder(groupKey: string, orderedItems: any[], dropUid: string) {
    const from = dragUid;
    setDragUid(null);
    setDragOverUid(null);
    setDragGroupKey(null);
    if (!from || from === dropUid || isDeletedView) return;
    const uids = orderedItems.map(uidOf);
    const fromIdx = uids.indexOf(from);
    const toIdx = uids.indexOf(dropUid);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...uids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, from);
    // 本地立即生效
    const override: Record<string, number> = { ...orderOverride };
    next.forEach((u, i) => { override[u] = i; });
    setOrderOverride(override);
    try {
      await apiFetch('/api/v1/me/tasks/order', { method: 'PUT', body: JSON.stringify({ task_uids: next }) });
      await mutate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '排序保存失败');
      await mutate();
    }
  }

  function renderRow(t: any, groupKey: string, groupItems: any[]) {
    const taskUid = t.task_uid || t.taskUid;
    const isDone = t.status === 'done';
    const isFlash = flash?.uid === taskUid;
    const flashKind = isFlash ? flash!.kind : null;
    const isRemoving = removingUid === taskUid;
    const carried = isCarried(t);
    const expanded = expandedUid === taskUid;
    const proj = projectOf(t);
    const pct = Math.max(0, Math.min(100, t.progress_percent ?? t.progressPercent ?? 0));
    const selected = selectedUids.has(taskUid);
    const canDrag = !isDeletedView && !selectMode;
    const isDragOver = !!dragUid && dragUid !== taskUid && dragOverUid === taskUid && dragGroupKey === groupKey;
    const isDragging = dragUid === taskUid;
    return (
      <div key={taskUid}>
      <div
        ref={(el) => {
          // 新建/完成时把该行平滑滚动到可视区中央（每次 flash 仅滚一次）
          if (el && isFlash && scrolledFlashRef.current !== taskUid) {
            scrolledFlashRef.current = taskUid;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }}
        onDragOver={canDrag && dragUid ? (e) => { e.preventDefault(); if (dragOverUid !== taskUid) setDragOverUid(taskUid); } : undefined}
        onDrop={canDrag && dragUid ? (e) => { e.preventDefault(); handleDropReorder(groupKey, groupItems, taskUid); } : undefined}
        style={carried && !isDeletedView && !isFlash ? {
          backgroundColor: 'color-mix(in srgb, var(--tag-carry) 7%, transparent)',
          borderColor: 'color-mix(in srgb, var(--tag-carry) 30%, transparent)',
        } : undefined}
        className={`flex items-stretch overflow-hidden rounded-xl border ease-out ${
          isRemoving ? 'row-exit' : ''
        } ${
          expanded ? 'rounded-b-none' : ''
        } ${isDragging ? 'opacity-40' : ''} ${
          isDragOver || selected ? 'ring-2 ring-[var(--accent-blue)] ring-offset-0' : ''
        } ${
          flashKind === 'create'
            ? 'flash-create animate-in slide-in-from-top-4 duration-500 border-[var(--accent-blue)]/40'
            : flashKind === 'done'
              ? 'flash-done border-[var(--accent-green)]/40'
              : carried && !isDeletedView
                ? ''
                : isDeletedView
                  ? 'bg-[var(--bg-card)] border-[var(--border)]'
                  : 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors'
        }`}
      >
        {/* 批量归类：选择模式下显示复选框；否则显示拖拽手柄 */}
        {selectMode ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleSelect(taskUid); }}
            aria-label="选择任务"
            className={`flex w-9 shrink-0 items-center justify-center border-r border-[var(--border)] ${selected ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'}`}
          >
            {selected ? '✓' : ''}
          </button>
        ) : canDrag ? (
          <div
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragUid(taskUid); setDragGroupKey(groupKey); }}
            onDragEnd={() => { setDragUid(null); setDragOverUid(null); setDragGroupKey(null); }}
            onClick={(e) => e.stopPropagation()}
            title="拖拽排序（同分类内）"
            aria-label="拖拽排序"
            className="flex w-6 shrink-0 cursor-grab items-center justify-center bg-[var(--bg-surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text-secondary)] active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        ) : null}
        {/* 卡片主体：选择模式下点击=选中；否则点击=就地展开 */}
        <div
          onClick={isDeletedView ? undefined : selectMode ? () => toggleSelect(taskUid) : () => { setEditing(false); setExpandedUid(expanded ? null : taskUid); }}
          className={`flex min-w-0 flex-1 items-stretch justify-between gap-3 px-4 py-2.5 ${isDeletedView ? 'cursor-default opacity-75' : 'cursor-pointer'}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
            <h3 className="truncate text-sm font-medium text-[var(--text-primary)]">{t.title}</h3>
            <StatusBadge status={t.status} />
            {(() => {
              const n = t.delay_count ?? t.delayCount ?? 0;
              if (n < 1) return null;
              const c = n >= 3 ? 'var(--accent-red)' : 'var(--accent-orange)';
              return (
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                  style={{ color: c, backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`, borderColor: `color-mix(in srgb, ${c} 28%, transparent)` }}
                >
                  延期 {n} 次
                </span>
              );
            })()}
            {carried && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{ color: 'var(--tag-carry)', backgroundColor: 'color-mix(in srgb, var(--tag-carry) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--tag-carry) 35%, transparent)' }}
              >
                继承{(t.carry_over_count ?? t.carryOverCount ?? 0) > 1 ? ` ×${t.carry_over_count ?? t.carryOverCount}` : ''}
              </span>
            )}
            {t.visibility === 'private' && (
              <span
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{ color: 'var(--tag-private)', backgroundColor: 'color-mix(in srgb, var(--tag-private) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--tag-private) 28%, transparent)' }}
              >
                🔒
              </span>
            )}
            {role === 'collaborator' && (
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
                style={{ color: 'var(--tag-collab)', backgroundColor: 'color-mix(in srgb, var(--tag-collab) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--tag-collab) 28%, transparent)' }}
              >
                协作
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-stretch gap-3">
            <span className="hidden self-center text-xs text-[var(--text-muted)] sm:inline tabular-nums">
              {t.due_at || t.dueAt ? new Date(t.due_at || t.dueAt).toLocaleDateString('zh-CN') : '-'}
              <span className="mx-1 opacity-50">·</span>
              {t.assignee_name || t.assigneeName || '-'}
            </span>
            {/* #3 项目色块：负责人之后，方形上下满填充，颜色取自项目分类 */}
            <div
              title={`项目：${proj.name}`}
              className="-my-2.5 flex w-[4.5rem] shrink-0 items-center justify-center px-1.5 text-[11px] font-semibold leading-tight text-white"
              style={{ backgroundColor: projectColor(proj.category) }}
            >
              <span className="line-clamp-2 text-center">{proj.name}</span>
            </div>
            {/* 完成度：紧凑环形指示，项目之后 */}
            <div className="flex items-center"><MiniProgress pct={pct} /></div>
            <div className="flex items-center gap-2">
              {isDeletedView ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRestore(taskUid); }}
                  disabled={restoring === taskUid}
                  className="rounded-full border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-blue)] transition-all hover:bg-[var(--accent-blue)]/20 disabled:opacity-50"
                >
                  {restoring === taskUid ? '恢复中...' : '恢复'}
                </button>
              ) : (
                <>
                  {!isDone && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleComplete(taskUid, t.version); }}
                      disabled={completing === taskUid}
                      className="rounded-full border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-green)] transition-all hover:bg-[var(--accent-green)]/20 disabled:opacity-50"
                    >
                      {completing === taskUid ? '...' : '完成'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget({ uid: taskUid, title: t.title }); }}
                    className="rounded-full border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-red)] transition-all hover:bg-[var(--accent-red)]/20"
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {expanded && !selectMode && renderExpanded(t)}
      </div>
    );
  }

  function renderExpanded(t: any) {
    const taskUid = t.task_uid || t.taskUid;
    const v = t.version;
    const dueStr = t.due_at || t.dueAt;
    const startStr = t.start_at || t.startAt;
    const collabs: any[] = Array.isArray(t.collaborators) ? t.collaborators : [];
    const pct = t.progress_percent ?? t.progressPercent ?? 0;
    const projName = t.project_uid || t.projectUid ? projectNames[t.project_uid || t.projectUid] : null;
    const Info = ({ label, children }: { label: string; children: ReactNode }) => (
      <div className="flex gap-2 text-sm">
        <span className="w-16 shrink-0 text-[var(--text-muted)]">{label}</span>
        <span className="min-w-0 flex-1 text-[var(--text-secondary)]">{children}</span>
      </div>
    );
    const inputCls = 'rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40';
    const isEditing = editing && expandedUid === taskUid && !isDeletedView;

    return (
      <div className="rounded-b-xl border border-t-0 border-[var(--border)] bg-[var(--bg-surface)]/40 px-4 py-3 space-y-3">
        {isEditing ? (
          /* 编辑模式：标题/优先级/截止/详情/最新进展 */
          <div className="space-y-2.5" onClick={(e) => e.stopPropagation()}>
            <input className={`${inputCls} w-full`} value={ef.title} onChange={(e) => setEf({ ...ef, title: e.target.value })} placeholder="标题" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <select className={inputCls} value={ef.priority} onChange={(e) => setEf({ ...ef, priority: e.target.value })}>
                <option value="urgent_important">重要紧急</option>
                <option value="important_not_urgent">重要不紧急</option>
                <option value="urgent_not_important">紧急不重要</option>
                <option value="not_urgent_not_important">不紧急不重要</option>
              </select>
              <input type="date" className={inputCls} value={ef.due} onChange={(e) => setEf({ ...ef, due: e.target.value })} />
            </div>
            <textarea className={`${inputCls} w-full resize-y`} rows={2} value={ef.detail} onChange={(e) => setEf({ ...ef, detail: e.target.value })} placeholder="详情" />
            <textarea className={`${inputCls} w-full resize-y`} rows={2} value={ef.latest} onChange={(e) => setEf({ ...ef, latest: e.target.value })} placeholder="最新进展" />
            <div className="flex gap-2">
              <button type="button" disabled={savingAction} onClick={() => saveEdit(t)} className="rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">{savingAction ? '保存中...' : '保存'}</button>
              <button type="button" disabled={savingAction} onClick={() => setEditing(false)} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">取消</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Info label="详情">{t.detail || <span className="text-[var(--text-muted)]">—</span>}</Info>
              <Info label="最新进展">{t.latest_progress || t.latestProgress || <span className="text-[var(--text-muted)]">—</span>}</Info>
              <Info label="负责人">{t.assignee_name || t.assigneeName || '—'}</Info>
              <Info label="Leader">{t.leader_name || t.leaderName || '—'}</Info>
              <Info label="开始">{startStr ? new Date(startStr).toLocaleDateString('zh-CN') : '—'}</Info>
              <Info label="截止">{dueStr ? new Date(dueStr).toLocaleDateString('zh-CN') : '—'}</Info>
              <Info label="项目">{projName || '—'}</Info>
              <Info label="协作人">{collabs.length ? collabs.map((c) => c.user_name || c.userName).join('、') : '—'}</Info>
              {isCarried(t) && <Info label="继承自">{t.source_month || t.sourceMonth || '—'}（已 {t.carry_over_count ?? t.carryOverCount ?? 0} 次）</Info>}
              <Info label="进度">{pct}%</Info>
            </div>

            {!isDeletedView && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); startEdit(t); }}
                  className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >编辑</button>
                {/* 改状态 */}
                <select
                  value={t.status}
                  disabled={savingAction}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); patchTask(taskUid, { status: e.target.value, version: v }, '状态已更新'); }}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
                >
                  {['pending', 'not_started', 'in_progress', 'stalled', 'done', 'shelved'].map((s) => (
                    <option key={s} value={s}>{({ pending: '待办', not_started: '待开始', in_progress: '进行中', stalled: '已停滞', done: '已完成', shelved: '已搁置' } as any)[s]}</option>
                  ))}
                </select>
                {/* 更新进度 */}
                <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number" min={0} max={100} defaultValue={pct} disabled={savingAction}
                    id={`pct-${taskUid}`}
                    className="w-16 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
                  />
                  <span className="text-xs text-[var(--text-muted)]">%</span>
                  <button
                    type="button" disabled={savingAction}
                    onClick={() => {
                      const el = document.getElementById(`pct-${taskUid}`) as HTMLInputElement | null;
                      const n = Math.max(0, Math.min(100, parseInt(el?.value ?? `${pct}`, 10) || 0));
                      patchTask(taskUid, { progress_percent: n, version: v }, '进度已更新');
                    }}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  >更新进度</button>
                </div>
                {t.visibility === 'private' && (
                  <button
                    type="button" disabled={savingAction}
                    onClick={(e) => { e.stopPropagation(); handlePublish(taskUid); }}
                    className="rounded-full border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20 disabled:opacity-50"
                  >转为公开</button>
                )}
                {/* V2d：逾期或连续延期(≥2) → 建议登记事故（预填关联任务，自动带出项目） */}
                {(() => {
                  const n = t.delay_count ?? t.delayCount ?? 0;
                  const overdue = (t.is_overdue ?? t.isOverdue) ||
                    (dueStr && new Date(dueStr).getTime() < Date.now() && !['done', 'shelved', 'closed'].includes(t.status));
                  if (!overdue && n < 2) return null;
                  return (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); router.push(`/incidents/create?task=${taskUid}`); }}
                      className="rounded-full border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-[var(--accent-red)]/20"
                      title={overdue ? '该任务已逾期' : `已延期 ${n} 次`}
                    >⚠ 建议登记事故</button>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>
    );
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
            onClick={() => setRole(r.value)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
              role === r.value
                ? 'bg-[var(--accent-blue)] text-white'
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
            onClick={() => setBucket(o.value)}
            className={`rounded-full px-3 py-1 text-xs transition-all ${
              bucket === o.value
                ? 'bg-[var(--accent-blue)] text-white'
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
            onClick={() => setStatus(f.value)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
              status === f.value
                ? 'bg-[var(--accent-blue)] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Quick add bar (between filters and task list — most prominent CTA) */}
      <QuickAddTask onCreated={handleQuickCreated} />

      {/* 分组维度切换 + 批量归类入口 */}
      <div className="mb-4 mt-6 flex items-center justify-end gap-2">
        {!isDeletedView && (
          <button
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            className={`mr-auto rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              selectMode
                ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {selectMode ? '退出批量归类' : '批量归类'}
          </button>
        )}
        <span className="text-xs text-[var(--text-muted)]">分组</span>
        <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1">
          {([
            { v: 'priority', label: '按优先级' },
            { v: 'project', label: '按项目' },
          ] as const).map((o) => (
            <button
              key={o.v}
              onClick={() => setGroupMode(o.v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                groupMode === o.v
                  ? 'bg-[var(--accent-blue)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task cards */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[var(--accent-red)]">加载失败: {error.message}</p>
        </div>
      ) : (
        <>
          {data?.items?.length === 0 ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <p className="text-[var(--text-muted)]">暂无任务</p>
            </div>
          ) : (
            <div className="space-y-7">
              {buildGroups(data?.items ?? []).map((g) => {
                if (g.items.length === 0) return null;
                return (
                  // 一级分组：左侧色条 + 大标题 + 计数胶囊（按优先级或按项目）
                  <section key={g.key} className="border-l-[3px] pl-4" style={{ borderColor: g.accent }}>
                    <div className="mb-3 flex items-center gap-2.5">
                      <h3 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">{g.label}</h3>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                        style={{ backgroundColor: `color-mix(in srgb, ${g.accent} 18%, transparent)`, color: g.accent }}
                      >
                        {g.items.length}
                      </span>
                    </div>
                    <div className="grid gap-2.5">
                      {g.items.map((t: any) => renderRow(t, g.key, g.items))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 批量归类：底部固定操作条 */}
      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--bg-card)]/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <span className="text-sm font-medium text-[var(--text-primary)]">已选 {selectedUids.size} 项</span>
            <span className="text-xs text-[var(--text-muted)]">挂到</span>
            <select
              value={bulkProject}
              onChange={(e) => setBulkProject(e.target.value)}
              className="min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            >
              <option value="">未归属（移出项目）</option>
              {projectList.map((p) => (
                <option key={p.projectUid} value={p.projectUid}>{p.parentProjectUid ? `↳ ${p.name}` : p.name}</option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={selectedUids.size === 0 || bulkSubmitting}
              className="rounded-lg bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {bulkSubmitting ? '归类中...' : '挂上'}
            </button>
            <button onClick={exitSelect} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">取消</button>
          </div>
        </div>
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
