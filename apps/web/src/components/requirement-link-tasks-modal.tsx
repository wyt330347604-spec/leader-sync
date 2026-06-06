'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useCandidateTasks } from '@/hooks/use-requirements';

interface Props {
  open: boolean;
  requirementUid: string;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (taskUids: string[], estEffortDays?: number, allocationPct?: number) => Promise<void> | void;
}

/** 挂载任务：从同业务线/app 的未挂需求任务中多选，回填工时(人天)+投入度(%)。 */
export function RequirementLinkTasksModal({ open, requirementUid, submitting, onClose, onSubmit }: Props) {
  const { data: candidates, isLoading } = useCandidateTasks(requirementUid, open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [effort, setEffort] = useState('');
  const [allocation, setAllocation] = useState('100');

  const toggle = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const handleSubmit = () => {
    if (selected.size === 0) return;
    const e = effort.trim() ? Number(effort) : undefined;
    const a = allocation.trim() ? Number(allocation) : undefined;
    onSubmit(Array.from(selected), Number.isFinite(e!) ? e : undefined, Number.isFinite(a!) ? a : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border)] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">挂载任务到需求</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="max-h-[40vh] space-y-1.5 overflow-y-auto">
            {isLoading && <div className="py-6 text-center text-sm text-[var(--text-muted)]">加载候选任务...</div>}
            {!isLoading && (candidates?.length ?? 0) === 0 && (
              <div className="py-6 text-center text-sm text-[var(--text-muted)]">该业务线/app 下暂无未挂载的任务</div>
            )}
            {candidates?.map((t) => (
              <label
                key={t.taskUid}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 hover:bg-[var(--bg-hover)]"
              >
                <input type="checkbox" checked={selected.has(t.taskUid)} onChange={() => toggle(t.taskUid)} />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{t.title}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{t.assigneeName}</span>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">预估工时（人天）</label>
              <input
                type="number" step="0.5" min="0" value={effort} onChange={(e) => setEffort(e.target.value)}
                placeholder="如 3"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">投入度（%）</label>
              <input
                type="number" step="10" min="0" max="100" value={allocation} onChange={(e) => setAllocation(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <button onClick={onClose} disabled={submitting} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">取消</button>
          <button onClick={handleSubmit} disabled={selected.size === 0 || submitting} className="rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-medium text-white disabled:opacity-40">
            {submitting ? '挂载中...' : `挂载 ${selected.size} 个任务`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
