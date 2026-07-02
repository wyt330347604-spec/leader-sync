'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, RotateCcw } from 'lucide-react';
import { useOrgTree, setManager, resetManagerToFeishu, type OrgTreeUser } from '@/hooks/use-org-tree';
import { useMe } from '@/hooks/use-me';
import { getAvatar } from '@/lib/avatar';

// 可编辑组织架构的角色（与后端 org.service 口径一致）
const EDIT_ROLES = new Set(['boss', 'pmo', 'admin']);

interface OrgNode {
  user: OrgTreeUser;
  children: OrgNode[];
  /** manager 有值但在树里解析不到（离职/未同步）→ 挂根并提示 */
  unresolvedManager: boolean;
}

/** 双 key（user_id/open_id）解析 manager，把平铺用户组成森林 */
function buildForest(users: readonly OrgTreeUser[]): OrgNode[] {
  const nodeByKey = new Map<string, OrgNode>();
  const nodes: OrgNode[] = users.map((u) => ({ user: u, children: [], unresolvedManager: false }));
  for (const n of nodes) {
    nodeByKey.set(n.user.user_id, n);
    if (n.user.open_id && !nodeByKey.has(n.user.open_id)) nodeByKey.set(n.user.open_id, n);
  }
  const roots: OrgNode[] = [];
  for (const n of nodes) {
    const mid = n.user.manager_user_id;
    const parent = mid ? nodeByKey.get(mid) : undefined;
    if (parent && parent !== n) {
      parent.children.push(n);
    } else {
      n.unresolvedManager = Boolean(mid && !parent);
      roots.push(n);
    }
  }
  const byName = (a: OrgNode, b: OrgNode) => (a.user.user_name ?? '').localeCompare(b.user.user_name ?? '', 'zh');
  const sortRec = (list: OrgNode[]) => {
    list.sort(byName);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** 自己 + 全部下属的 key 集合（拖拽时禁止落到自己子树，防环的客户端预检） */
function subtreeKeys(node: OrgNode): Set<string> {
  const keys = new Set<string>();
  const walk = (n: OrgNode) => {
    keys.add(n.user.user_id);
    if (n.user.open_id) keys.add(n.user.open_id);
    n.children.forEach(walk);
  };
  walk(node);
  return keys;
}

export default function OrgPage() {
  const { data, error, isLoading, mutate } = useOrgTree();
  const { data: me } = useMe();
  const canEdit = EDIT_ROLES.has(((me as any)?.role as string) ?? 'employee');

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 原生 DnD 事件不等 React 重渲染：拖拽负载/禁投集合放 ref（同步可读），state 只管视觉
  const dragRef = useRef<{ userId: string; forbidden: Set<string> } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const roots = useMemo(() => buildForest(data?.users ?? []), [data?.users]);

  const applyMove = async (targetManagerId: string | null) => {
    const drag = dragRef.current;
    if (!drag || busy) return;
    setBusy(true);
    setErrMsg(null);
    try {
      await setManager(drag.userId, targetManagerId);
      await mutate();
    } catch (e) {
      setErrMsg((e as Error).message || '调整失败');
    } finally {
      setBusy(false);
      dragRef.current = null;
      setDraggingId(null);
      setDropTarget(null);
    }
  };

  const handleReset = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    setErrMsg(null);
    try {
      await resetManagerToFeishu(userId);
      await mutate();
    } catch (e) {
      setErrMsg((e as Error).message || '恢复失败');
    } finally {
      setBusy(false);
    }
  };

  const renderNode = (node: OrgNode, depth: number) => {
    const u = node.user;
    const isCollapsed = collapsed.has(u.user_id);
    const avatar = getAvatar(u.user_name);
    // 读 ref（同步）判断可投放，不依赖 state 重渲染时序
    const dropOk = () => {
      const drag = dragRef.current;
      return Boolean(canEdit && drag && !drag.forbidden.has(u.user_id));
    };
    const isDropHover = dropTarget === u.user_id;

    return (
      <div key={u.user_id}>
        <div
          draggable={canEdit}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', u.user_id);
            dragRef.current = { userId: u.user_id, forbidden: subtreeKeys(node) };
            setDraggingId(u.user_id);
          }}
          onDragEnd={() => {
            dragRef.current = null;
            setDraggingId(null);
            setDropTarget(null);
          }}
          onDragOver={(e) => {
            if (!dropOk()) return;
            e.preventDefault();
            setDropTarget((t) => (t === u.user_id ? t : u.user_id));
          }}
          onDragLeave={() => setDropTarget((t) => (t === u.user_id ? null : t))}
          onDrop={(e) => {
            if (!dropOk()) return;
            e.preventDefault();
            void applyMove(u.user_id);
          }}
          className={`group flex items-center gap-2 rounded-lg border px-3 py-2 mb-1 transition-colors ${
            isDropHover
              ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_12%,transparent)]'
              : 'border-[var(--border)] bg-[var(--bg-card)]'
          } ${draggingId === u.user_id ? 'opacity-50' : ''}`}
          style={{ marginLeft: depth * 28 }}
          data-testid={`org-node-${u.user_id}`}
        >
          {canEdit && (
            <GripVertical className="size-4 shrink-0 cursor-grab text-[var(--text-muted)] opacity-40 group-hover:opacity-100" />
          )}
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(u.user_id)) next.delete(u.user_id);
                  else next.add(u.user_id);
                  return next;
                })
              }
              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label={isCollapsed ? '展开' : '收起'}
            >
              {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
            style={{ background: avatar.bg, color: avatar.fg }}
          >
            {avatar.initial}
          </span>
          <span className="text-sm font-medium text-[var(--text-primary)]">{u.user_name ?? u.user_id}</span>
          {u.current_grade && (
            <span className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border)]">
              {u.current_grade}
            </span>
          )}
          {u.manager_source === 'manual' && (
            <span className="rounded px-1.5 py-0.5 text-[10px] bg-[color-mix(in_srgb,var(--tag-private)_18%,transparent)] text-[var(--tag-private)]">
              手动调整
            </span>
          )}
          {node.unresolvedManager && (
            <span className="rounded px-1.5 py-0.5 text-[10px] bg-[color-mix(in_srgb,var(--accent-orange)_18%,transparent)] text-[var(--accent-orange)]">
              上级未识别：{u.manager_name ?? u.manager_user_id}
            </span>
          )}
          {node.children.length > 0 && (
            <span className="text-[10px] text-[var(--text-muted)]">{node.children.length} 名下属</span>
          )}
          {canEdit && u.manager_source === 'manual' && (
            <button
              type="button"
              onClick={() => void handleReset(u.user_id)}
              disabled={busy}
              className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]"
              title="恢复为飞书通讯录的上级（下次同步刷新）"
            >
              <RotateCcw className="size-3" /> 恢复飞书默认
            </button>
          )}
        </div>
        {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="pb-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">组织架构</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {data?.last_feishu_sync_at
              ? `飞书通讯录最近同步：${new Date(data.last_feishu_sync_at).toLocaleString('zh-CN')}（每日 07:00 自动）`
              : '尚未从飞书通讯录同步过上下级关系'}
            {canEdit && ' · 拖拽成员卡片放到新上级上即可调整汇报线（手动调整不会被同步覆盖）'}
          </p>
        </div>
      </div>

      {errMsg && (
        <div className="mb-3 rounded-lg border border-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] px-3 py-2 text-xs text-[var(--accent-red)]">
          {errMsg}
        </div>
      )}

      {/* 常驻渲染（不随拖拽出现/消失）：拖拽中途布局位移会让投放坐标失效 */}
      {canEdit && (
        <div
          onDragOver={(e) => {
            if (!dragRef.current) return;
            e.preventDefault();
            setDropTarget('__root__');
          }}
          onDragLeave={() => setDropTarget((t) => (t === '__root__' ? null : t))}
          onDrop={(e) => {
            if (!dragRef.current) return;
            e.preventDefault();
            void applyMove(null);
          }}
          className={`mb-3 rounded-lg border border-dashed px-3 py-2 text-center text-xs transition-colors ${
            dropTarget === '__root__'
              ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_12%,transparent)] text-[var(--text-primary)]'
              : draggingId
                ? 'border-[var(--accent-blue)] text-[var(--text-secondary)]'
                : 'border-[var(--border)] text-[var(--text-muted)]'
          }`}
        >
          拖到这里 = 设为根节点（无上级）
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--text-secondary)]">加载中…</p>}
      {error && <p className="text-sm text-[var(--accent-red)]">组织数据加载失败，请刷新重试</p>}
      {!isLoading && !error && roots.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          暂无组织数据。成员首次登录系统或飞书通讯录同步后会出现在这里。
        </div>
      )}

      <div>{roots.map((n) => renderNode(n, 0))}</div>
    </div>
  );
}
