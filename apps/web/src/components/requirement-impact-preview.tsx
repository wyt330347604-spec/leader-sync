'use client';
import { useState, useEffect } from 'react';
import { previewImpact, type ImpactResult } from '@/hooks/use-requirements';

interface Props {
  priority: string;
  businessLineUid: string;
  appProjectUid: string | null;
  expectedReleaseDate: string | null;
}

const LEVEL_STYLE: Record<string, string> = {
  overloaded: 'text-[var(--accent-red)]',
  tight: 'text-[var(--accent-orange)]',
  ok: 'text-[var(--text-secondary)]',
};

/** R3：P0 + 期望上线日齐备时，展示影响评估（不改期，仅算影响 + 通知名单，供人工确认）。 */
export function RequirementImpactPreview({ priority, businessLineUid, appProjectUid, expectedReleaseDate }: Props) {
  const active = priority === 'P0' && !!businessLineUid && !!expectedReleaseDate;
  const [data, setData] = useState<ImpactResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active) { setData(null); setErr(null); return; }
    let cancelled = false;
    setLoading(true); setErr(null);
    const handle = setTimeout(() => {
      previewImpact({ business_line_uid: businessLineUid, app_project_uid: appProjectUid, expected_release_date: expectedReleaseDate! })
        .then((r) => { if (!cancelled) setData(r); })
        .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [active, businessLineUid, appProjectUid, expectedReleaseDate]);

  if (!active) return null;

  return (
    <div className="rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--accent-red)]">
        ⚠ P0 影响评估
        <span className="font-normal text-[var(--text-muted)]">不会自动改期，提交后将通知相关人确认</span>
      </div>

      {loading && <div className="py-2 text-center text-xs text-[var(--text-muted)]">评估中...</div>}
      {err && <div className="py-2 text-xs text-[var(--accent-red)]">评估失败：{err}</div>}

      {data && !loading && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
            <span>受影响 <b className="text-[var(--text-primary)]">{data.summary.peopleCount}</b> 人</span>
            <span><b className="text-[var(--text-primary)]">{data.summary.taskCount}</b> 个在飞任务可能顺延</span>
            {data.summary.overloadedCount > 0 && (
              <span className="text-[var(--accent-red)]"><b>{data.summary.overloadedCount}</b> 人将过载</span>
            )}
          </div>

          {data.affectedPeople.length > 0 ? (
            <div className="space-y-1">
              {data.affectedPeople.slice(0, 6).map((p) => (
                <div key={p.userId} className="flex items-center justify-between rounded bg-[var(--bg-surface)]/60 px-2 py-1 text-[11px]">
                  <span className="text-[var(--text-primary)]">{p.userName}</span>
                  <span className={LEVEL_STYLE[p.level]}>
                    窗口峰值 {p.peakLoadPct}%{p.level === 'overloaded' ? ' · 过载' : p.level === 'tight' ? ' · 偏紧' : ''} · {p.tasks.length} 任务
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--text-secondary)]">该窗口内暂无在飞任务冲突。</div>
          )}

          {data.notify.length > 0 && (
            <div className="border-t border-[var(--accent-red)]/20 pt-2 text-[11px] text-[var(--text-muted)]">
              将通知：{data.notify.map((n) => `${n.name}（${n.reason}）`).join('、')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
