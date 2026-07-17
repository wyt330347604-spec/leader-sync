'use client';
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, RotateCcw, EyeOff, Eye } from 'lucide-react';
import { getAvatar } from '@/lib/avatar';
import type { OrgTreeDatum } from './org-layout';

export interface OrgNodeActions {
  canEdit: boolean;
  collapsed: boolean;
  onToggle: (key: string) => void;
  onReset: (userId: string) => void;
  onSetHidden: (userId: string, hidden: boolean) => void;
}

/** React Flow 自定义节点：一个人的卡片。actions 经 node.data.__actions 注入。 */
function OrgNodeCardImpl({ data }: NodeProps) {
  const datum = data as OrgTreeDatum;
  const actions = (data as any).__actions as OrgNodeActions;
  const u = datum.user;
  const avatar = getAvatar(u.user_name);
  const isLeft = Boolean(u.left_at);
  const isHidden = Boolean(u.hidden_at);
  const hasChildren = datum.childCount > 0;

  return (
    <div
      data-testid={`org-node-${u.user_id}`}
      className={`org-card flex items-center gap-2 rounded-xl border px-3 py-2 ${
        isLeft || isHidden ? 'opacity-50 border-dashed' : ''
      } border-[var(--border)] bg-[var(--bg-card)]`}
      style={{ width: 240 }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: avatar.bg, color: avatar.fg }}
      >
        {avatar.initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {u.user_name ?? u.user_id}
          </span>
          {u.current_grade && (
            <span className="rounded border border-[var(--border)] px-1 py-0.5 text-[10px] text-[var(--text-secondary)]">
              {u.current_grade}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {hasChildren && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {datum.collapsed ? `+${datum.hiddenDescendantCount}` : `${datum.childCount} 名下属`}
            </span>
          )}
          {u.manager_source === 'manual' && (
            <span className="rounded bg-[color-mix(in_srgb,var(--tag-private)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--tag-private)]">
              手动
            </span>
          )}
          {datum.unresolvedManager && (
            <span className="rounded bg-[color-mix(in_srgb,var(--accent-orange)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--accent-orange)]">
              上级未识别
            </span>
          )}
          {isLeft && (
            <span className="rounded bg-[color-mix(in_srgb,var(--accent-orange)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--accent-orange)]">
              离职
            </span>
          )}
          {isHidden && (
            <span className="rounded bg-[color-mix(in_srgb,var(--text-muted)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">
              已隐藏
            </span>
          )}
        </span>
      </span>

      {actions.canEdit && u.manager_source === 'manual' && !isLeft && (
        <button
          type="button"
          onClick={() => actions.onReset(u.user_id)}
          className="nodrag shrink-0 rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title="恢复为飞书通讯录的上级"
        >
          <RotateCcw className="size-3" />
        </button>
      )}
      {actions.canEdit && !isLeft && (
        <button
          type="button"
          onClick={() => actions.onSetHidden(u.user_id, !isHidden)}
          className="nodrag shrink-0 rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={isHidden ? '取消隐藏' : '隐藏（不入目录）'}
        >
          {isHidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
      )}
      {hasChildren && (
        <button
          type="button"
          onClick={() => actions.onToggle(u.user_id)}
          className="nodrag shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label={datum.collapsed ? '展开' : '收起'}
        >
          {datum.collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      )}
    </div>
  );
}

export const OrgNodeCard = memo(OrgNodeCardImpl);
