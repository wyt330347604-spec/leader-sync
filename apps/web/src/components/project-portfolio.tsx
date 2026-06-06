'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProjectPortfolio, type PortfolioNode, type ProjectHealth } from '@/hooks/use-project-portfolio';
import { ProjectGantt } from '@/components/project-gantt';

/** 关联事故徽章（可点击 → 跳转到按项目过滤的事故列表）。 */
function IncidentBadge({ projectUid, count }: { projectUid: string; count: number }) {
  const router = useRouter();
  if (count <= 0) return null;
  return (
    <span
      role="button"
      title="查看关联事故"
      onClick={(e) => { e.stopPropagation(); router.push(`/incidents?project=${projectUid}`); }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
      style={{ color: 'var(--accent-red)', backgroundColor: 'color-mix(in srgb, var(--accent-red) 14%, transparent)' }}
    >⚠ {count} 事故</span>
  );
}

/** 需求徽章（可点击 → 跳转到按业务线过滤的需求池）。R1c 联动。 */
function RequirementBadge({ businessLineUid, count, label }: { businessLineUid: string; count: number; label?: string }) {
  const router = useRouter();
  if (count <= 0) return null;
  return (
    <span
      role="button"
      title="查看需求池"
      onClick={(e) => { e.stopPropagation(); router.push(`/requirements?business_line=${businessLineUid}`); }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
      style={{ color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 14%, transparent)' }}
    >🧩 {count} {label ?? '需求'}</span>
  );
}

/** app 维度需求徽章 → 跳转到按 app 过滤的需求池。 */
function RequirementBadgeApp({ appProjectUid, count }: { appProjectUid: string; count: number }) {
  const router = useRouter();
  if (count <= 0) return null;
  return (
    <span
      role="button"
      title="查看该 app 需求"
      onClick={(e) => { e.stopPropagation(); router.push(`/requirements?app=${appProjectUid}`); }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
      style={{ color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 14%, transparent)' }}
    >🧩 {count} 需求</span>
  );
}

const HEALTH: Record<ProjectHealth, { label: string; color: string }> = {
  on_track: { label: '正常', color: 'var(--accent-green)' },
  at_risk: { label: '预警', color: 'var(--accent-orange)' },
  overdue: { label: '逾期', color: 'var(--accent-red)' },
};

function projectColor(category?: string | null): string {
  return category ? `var(--cat-${category})` : '#94A3B8';
}

function fmtSpan(start: string | null, end: string | null): string {
  const f = (s: string | null) => (s ? new Date(s).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—');
  if (!start && !end) return '无排期';
  return `${f(start)} → ${f(end)}`;
}

/** 紧凑环形进度。 */
function Ring({ pct, color }: { pct: number; color: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="relative h-10 w-10 shrink-0 rounded-full"
      style={{ background: `conic-gradient(${color} ${p * 3.6}deg, color-mix(in srgb, var(--border) 70%, transparent) 0deg)` }}
    >
      <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-[var(--bg-card)]">
        <span className="text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">{p}</span>
      </div>
    </div>
  );
}

function HealthDot({ health }: { health: ProjectHealth }) {
  const h = HEALTH[health];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: h.color, backgroundColor: `color-mix(in srgb, ${h.color} 14%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: h.color }} />
      {h.label}
    </span>
  );
}

function CountPills({ counts }: { counts: PortfolioNode['counts'] }) {
  return (
    <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)] tabular-nums">
      <span>{counts.done}/{counts.total} 完成</span>
      {counts.overdue > 0 && <span className="text-[var(--accent-red)]">{counts.overdue} 逾期</span>}
    </span>
  );
}

function SubRow({ node }: { node: PortfolioNode }) {
  const health = HEALTH[node.health];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]/50 px-3 py-2">
      <span className="h-8 w-1 shrink-0 rounded" style={{ backgroundColor: health.color }} />
      <Ring pct={node.progress} color={health.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">{node.name}</span>
          <HealthDot health={node.health} />
        </div>
        <div className="mt-0.5 flex items-center gap-3">
          <CountPills counts={node.counts} />
          <RequirementBadgeApp appProjectUid={node.projectUid} count={node.requirementCount ?? 0} />
          <IncidentBadge projectUid={node.projectUid} count={node.incidentCount ?? 0} />
          <span className="text-xs text-[var(--text-muted)]">{fmtSpan(node.spanStart, node.spanEnd)}</span>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ node }: { node: PortfolioNode }) {
  const [open, setOpen] = useState(false);
  const health = HEALTH[node.health];
  const subs = node.subProjects ?? [];
  return (
    <div
      className="overflow-hidden rounded-xl border bg-[var(--bg-card)]"
      style={{ borderColor: 'var(--border)', borderLeft: `4px solid ${projectColor(node.category)}` }}
    >
      <button
        type="button"
        onClick={() => subs.length && setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${subs.length ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'cursor-default'}`}
      >
        <Ring pct={node.progress} color={health.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{node.name}</h3>
            <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">业务线·永续</span>
            <HealthDot health={node.health} />
            {node.picName ? (
              <span className="text-xs text-[var(--text-secondary)]">PIC {node.picName}</span>
            ) : node.ownerName ? (
              <span className="text-xs text-[var(--text-muted)]">负责人 {node.ownerName}</span>
            ) : null}
          </div>
          {/* R0：业务线永续、无交付日，展示 app 数 + 预警/逾期里程碑数 */}
          <div className="mt-1 flex items-center gap-3 flex-wrap text-xs">
            <span className="text-[var(--text-secondary)]"><b className="text-[var(--text-primary)]">{node.appCount ?? subs.length}</b> 个 app</span>
            {(node.atRiskCount ?? 0) > 0 && <span style={{ color: 'var(--accent-orange)' }}>预警 {node.atRiskCount}</span>}
            {(node.overdueCount ?? 0) > 0 && <span style={{ color: 'var(--accent-red)' }}>逾期 {node.overdueCount}</span>}
            <CountPills counts={node.counts} />
            <RequirementBadge businessLineUid={node.projectUid} count={node.requirementCount ?? 0} />
            {(node.requirementOnLineCount ?? 0) > 0 && (
              <span className="text-[11px] text-[var(--text-muted)]">（{node.requirementOnLineCount} 挂业务线）</span>
            )}
            <IncidentBadge projectUid={node.projectUid} count={node.incidentCount ?? 0} />
            {subs.length > 0 && (
              <span className="text-[var(--text-secondary)]">{open ? '▾ 收起' : '▸ 展开 app'}</span>
            )}
          </div>
        </div>
      </button>
      {open && subs.length > 0 && (
        <div className="space-y-2 border-t border-[var(--border)] bg-[var(--bg-page)]/30 px-4 py-3">
          {subs.map((s) => <SubRow key={s.projectUid} node={s} />)}
        </div>
      )}
    </div>
  );
}

export function ProjectPortfolio({ enabled = true }: { enabled?: boolean }) {
  const { data, error, isLoading } = useProjectPortfolio(enabled);
  const [view, setView] = useState<'cards' | 'timeline'>('cards');
  const [picFilter, setPicFilter] = useState('');

  if (isLoading) return <div className="flex min-h-[30vh] items-center justify-center text-[var(--text-muted)]">加载中...</div>;
  if (error) return <div className="flex min-h-[30vh] items-center justify-center text-[var(--accent-red)]">加载失败: {error.message}</div>;
  if (!data || data.length === 0) return <div className="flex min-h-[30vh] items-center justify-center text-[var(--text-muted)]">暂无项目</div>;

  // PIC 过滤候选（去重，按出现的 picName）
  const pics = Array.from(new Set(data.map((p) => p.picName).filter(Boolean))) as string[];
  // 健康度排序：逾期 → 预警 → 正常；可选按 PIC 过滤
  const order: Record<ProjectHealth, number> = { overdue: 0, at_risk: 1, on_track: 2 };
  const sorted = [...data]
    .filter((p) => !picFilter || p.picName === picFilter)
    .sort((a, b) => order[a.health] - order[b.health]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {pics.length > 0 && (
          <>
            <span className="text-xs text-[var(--text-muted)]">PIC</span>
            <select
              value={picFilter}
              onChange={(e) => setPicFilter(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
            >
              <option value="">全部</option>
              {pics.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="mx-1 text-[var(--border)]">|</span>
          </>
        )}
        <span className="text-xs text-[var(--text-muted)]">视图</span>
        <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1">
          {([
            { v: 'cards', label: '卡片' },
            { v: 'timeline', label: '时间线' },
          ] as const).map((o) => (
            <button
              key={o.v}
              onClick={() => setView(o.v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                view === o.v ? 'bg-[var(--accent-blue)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {view === 'cards' ? (
        <div className="grid gap-3">
          {sorted.map((p) => <ProjectCard key={p.projectUid} node={p} />)}
        </div>
      ) : (
        <ProjectGantt nodes={sorted} />
      )}
    </div>
  );
}
