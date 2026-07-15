'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, RotateCcw } from 'lucide-react';
import { useOrgTree, setManager, resetManagerToFeishu, type OrgTreeUser } from '@/hooks/use-org-tree';
import { getAvatar } from '@/lib/avatar';

interface OrgNode {
  user: OrgTreeUser;
  children: OrgNode[];
  /** manager 有值但在树里解析不到（离职/未同步）→ 挂根并提示 */
  unresolvedManager: boolean;
}

/** 规范身份：ou_ open_id 优先，否则 user_id。用于跨双命名空间去重。 */
function canonicalId(u: OrgTreeUser): string {
  if (u.open_id && u.open_id.startsWith('ou_')) return u.open_id;
  if (u.user_id && u.user_id.startsWith('ou_')) return u.user_id;
  return u.user_id;
}

/** 一行的信息量打分：有直属/手动/职级/姓名 越全越优先保留。 */
function rowRichness(u: OrgTreeUser): number {
  let s = 0;
  if (u.manager_user_id) s += 4;
  if (u.manager_source === 'manual') s += 2;
  if (u.current_grade) s += 1;
  if (u.user_name) s += 1;
  return s;
}

/** 同一人可能有多行（user_id 行 + open_id 行）→ 按规范身份去重，保留信息最全的一行。 */
function dedupeUsers(users: readonly OrgTreeUser[]): OrgTreeUser[] {
  const byCanon = new Map<string, OrgTreeUser>();
  for (const u of users) {
    const k = canonicalId(u);
    const prev = byCanon.get(k);
    if (!prev || rowRichness(u) > rowRichness(prev)) byCanon.set(k, u);
  }
  return [...byCanon.values()];
}

/** 双 key（user_id/open_id）解析 manager，把去重后的用户组成森林 */
function buildForest(rawUsers: readonly OrgTreeUser[]): OrgNode[] {
  const users = dedupeUsers(rawUsers);
  const nodeByKey = new Map<string, OrgNode>();
  const nodes: OrgNode[] = users.map((u) => ({ user: u, children: [], unresolvedManager: false }));
  for (const n of nodes) {
    // 一个节点同时以 user_id 与 open_id 登记，manager 指针用任一命名空间都能命中同一节点
    if (n.user.user_id) nodeByKey.set(n.user.user_id, n);
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
  const canEdit = data?.can_edit ?? false;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** 一个人的卡片（拖拽/收起/恢复都挂在这里） */
  const renderCard = (node: OrgNode) => {
    const u = node.user;
    const key = u.user_id;
    const isCollapsed = collapsed.has(key);
    const avatar = getAvatar(u.user_name);
    const dropOk = () => {
      const drag = dragRef.current;
      return Boolean(canEdit && drag && !drag.forbidden.has(u.user_id));
    };
    const isDropHover = dropTarget === key;
    const hasChildren = node.children.length > 0;

    return (
      <div
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', u.user_id);
          dragRef.current = { userId: u.user_id, forbidden: subtreeKeys(node) };
          setDraggingId(key);
        }}
        onDragEnd={() => {
          dragRef.current = null;
          setDraggingId(null);
          setDropTarget(null);
        }}
        onDragOver={(e) => {
          if (!dropOk()) return;
          e.preventDefault();
          setDropTarget((t) => (t === key ? t : key));
        }}
        onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
        onDrop={(e) => {
          if (!dropOk()) return;
          e.preventDefault();
          void applyMove(u.user_id);
        }}
        data-testid={`org-node-${u.user_id}`}
        className={`org-card group inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
          isDropHover
            ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_14%,transparent)]'
            : 'border-[var(--border)] bg-[var(--bg-card)]'
        } ${draggingId === key ? 'opacity-50' : ''}`}
      >
        {canEdit && (
          <GripVertical className="size-4 shrink-0 cursor-grab text-[var(--text-muted)] opacity-30 group-hover:opacity-100" />
        )}
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={{ background: avatar.bg, color: avatar.fg }}
        >
          {avatar.initial}
        </span>
        <span className="flex flex-col">
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-[var(--text-primary)] whitespace-nowrap">
              {u.user_name ?? u.user_id}
            </span>
            {u.current_grade && (
              <span className="rounded px-1 py-0.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border)]">
                {u.current_grade}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            {hasChildren && (
              <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">{node.children.length} 名下属</span>
            )}
            {u.manager_source === 'manual' && (
              <span className="rounded px-1 py-0.5 text-[10px] bg-[color-mix(in_srgb,var(--tag-private)_18%,transparent)] text-[var(--tag-private)] whitespace-nowrap">
                手动
              </span>
            )}
            {node.unresolvedManager && (
              <span className="rounded px-1 py-0.5 text-[10px] bg-[color-mix(in_srgb,var(--accent-orange)_18%,transparent)] text-[var(--accent-orange)] whitespace-nowrap">
                上级未识别
              </span>
            )}
          </span>
        </span>
        {canEdit && u.manager_source === 'manual' && (
          <button
            type="button"
            onClick={() => void handleReset(u.user_id)}
            disabled={busy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]"
            title="恢复为飞书通讯录的上级（下次同步刷新）"
          >
            <RotateCcw className="size-3" />
          </button>
        )}
        {hasChildren && (
          <button
            type="button"
            onClick={() => toggle(key)}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={isCollapsed ? '展开' : '收起'}
          >
            {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        )}
      </div>
    );
  };

  /** 递归：自上而下树节点（li + 连接线 + 子级 ul） */
  const renderTreeNode = (node: OrgNode) => {
    const key = node.user.user_id;
    const isCollapsed = collapsed.has(key);
    const showChildren = node.children.length > 0 && !isCollapsed;
    return (
      <li key={key}>
        {renderCard(node)}
        {showChildren && <ul>{node.children.map((c) => renderTreeNode(c))}</ul>}
      </li>
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

      {/* 自上而下树：每个根一棵独立树，横向可滚动 */}
      <div className="overflow-x-auto pb-4">
        <div className="inline-flex min-w-full flex-col gap-8">
          {roots.map((root) => (
            <div key={root.user.user_id} className="orgtree">
              <ul>{renderTreeNode(root)}</ul>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .orgtree ul {
          display: flex;
          justify-content: center;
          padding-top: 22px;
          position: relative;
        }
        .orgtree li {
          list-style: none;
          position: relative;
          padding: 22px 12px 0;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        /* 子级到父级的两段连接线 */
        .orgtree li::before,
        .orgtree li::after {
          content: '';
          position: absolute;
          top: 0;
          right: 50%;
          width: 50%;
          height: 22px;
          border-top: 1px solid var(--border);
        }
        .orgtree li::after {
          right: auto;
          left: 50%;
          border-left: 1px solid var(--border);
        }
        /* 独子：只留一条竖线，不画横线 */
        .orgtree li:only-child::before,
        .orgtree li:only-child::after {
          display: none;
        }
        .orgtree li:only-child {
          padding-top: 22px;
        }
        /* 两端修边，避免横线出头 */
        .orgtree li:first-child::before,
        .orgtree li:last-child::after {
          border: 0 none;
        }
        .orgtree li:last-child::before {
          border-right: 1px solid var(--border);
        }
        /* 父级往下引出的竖线 */
        .orgtree ul ul::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          width: 0;
          height: 22px;
          border-left: 1px solid var(--border);
        }
        /* 顶层根：不需要上方连接线 */
        .orgtree > ul {
          padding-top: 0;
        }
        .orgtree > ul > li {
          padding-top: 0;
        }
        .orgtree > ul > li::before,
        .orgtree > ul > li::after {
          display: none;
        }
      `}</style>
    </div>
  );
}
