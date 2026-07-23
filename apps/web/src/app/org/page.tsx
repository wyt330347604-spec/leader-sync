'use client';
import { useState } from 'react';
import { useOrgTree, setManager, resetManagerToFeishu, setHidden, setLeft } from '@/hooks/use-org-tree';
import { OrgCanvas } from './org-canvas';
import type { OrgUser } from './org-layout';

export default function OrgPage() {
  const [includeHidden, setIncludeHidden] = useState(false);
  const [line, setLine] = useState<'xt' | 'dfw' | 'ungrouped'>('xt');
  const { data, error, isLoading, mutate } = useOrgTree(includeHidden);
  const canEdit = data?.can_edit ?? false;
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setErrMsg(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setErrMsg((e as Error).message || '操作失败');
    }
  };

  const allUsers = (data?.users ?? []) as OrgUser[];
  const countBy = (l: string) => allUsers.filter((u) => (u.business_line ?? 'ungrouped') === l).length;
  const users = allUsers.filter((u) => (u.business_line ?? 'ungrouped') === line);

  return (
    <div className="pb-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">组织架构</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {data?.last_feishu_sync_at
              ? `飞书通讯录最近同步：${new Date(data.last_feishu_sync_at).toLocaleString('zh-CN')}（每日 07:00 自动）`
              : '尚未从飞书通讯录同步过上下级关系'}
            {canEdit && ' · 拖拽卡片到新上级上调整汇报线 · 滚轮缩放、拖空白平移'}
          </p>
        </div>
        {canEdit && (data?.hidden_count ?? 0) >= 0 && (
          <button
            type="button"
            onClick={() => setIncludeHidden((v) => !v)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {includeHidden ? '隐藏已离职/隐藏成员' : `显示已隐藏 (${data?.hidden_count ?? 0})`}
          </button>
        )}
      </div>

      <div className="mb-3 flex gap-1">
        {([['xt', '虾条'], ['dfw', '曙条'], ['ungrouped', '未分组']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setLine(key)}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              line === key
                ? 'bg-[var(--accent-blue)] text-white'
                : 'border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label} ({countBy(key)})
          </button>
        ))}
      </div>

      {errMsg && (
        <div className="mb-3 rounded-lg border border-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] px-3 py-2 text-xs text-[var(--accent-red)]">
          {errMsg}
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--text-secondary)]">加载中…</p>}
      {error && <p className="text-sm text-[var(--accent-red)]">组织数据加载失败，请刷新重试</p>}
      {!isLoading && !error && allUsers.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          暂无组织数据。成员首次登录系统或飞书通讯录同步后会出现在这里。
        </div>
      )}

      {!isLoading && !error && allUsers.length > 0 && users.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          此业务线暂无成员。
        </div>
      )}

      {!isLoading && !error && users.length > 0 && (
        <OrgCanvas
          users={users}
          canEdit={canEdit}
          onSetManager={(uid, mid) => run(() => setManager(uid, mid))}
          onReset={(uid) => run(() => resetManagerToFeishu(uid))}
          onSetHidden={(uid, hidden) => run(() => setHidden(uid, hidden))}
          onSetRoot={(uid) => run(() => setManager(uid, null))}
          onSetLeft={(uid, left) => run(() => setLeft(uid, left))}
        />
      )}
    </div>
  );
}
