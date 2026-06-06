'use client';
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useProjects } from '@/hooks/use-projects';
import { RequirementSource, RequirementSourceLabel, RequirementPriority } from '@leader-sync/shared-types';
import type { CreateRequirementInput } from '@/hooks/use-requirements';

interface Props {
  open: boolean;
  submitting?: boolean;
  /** 预选业务线（从业务线概览「提需求」进入时带入）。 */
  defaultBusinessLineUid?: string | null;
  /** R3：P0/期望上线变化时渲染的影响预览插槽。 */
  impactSlot?: (ctx: { priority: string; businessLineUid: string; appProjectUid: string | null; expectedReleaseDate: string | null }) => ReactNode;
  onClose: () => void;
  onSubmit: (value: CreateRequirementInput) => Promise<void> | void;
}

const SOURCE_OPTIONS: ComboboxOption[] = Object.values(RequirementSource).map((s) => ({
  value: s, label: RequirementSourceLabel[s] ?? s,
}));
const PRIORITIES = [RequirementPriority.P0, RequirementPriority.P1, RequirementPriority.P2];
const PRIORITY_DESC: Record<string, string> = {
  P0: '紧急 · 须填期望上线 · 触发影响评估',
  P1: '高',
  P2: '普通',
};

const APP_SELF = '__self__'; // 挂业务线本身

export function RequirementFormModal({ open, submitting, defaultBusinessLineUid, impactSlot, onClose, onSubmit }: Props) {
  const { businessLines, appsByLine } = useProjects(open);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [businessLineUid, setBusinessLineUid] = useState('');
  const [appProjectUid, setAppProjectUid] = useState(APP_SELF);
  const [source, setSource] = useState<string>(RequirementSource.BIZ);
  const [priority, setPriority] = useState<string>(RequirementPriority.P2);
  const [expectedReleaseDate, setExpectedReleaseDate] = useState('');

  useEffect(() => {
    if (open) {
      setTitle(''); setValue(''); setDescription('');
      setBusinessLineUid(defaultBusinessLineUid ?? '');
      setAppProjectUid(APP_SELF);
      setSource(RequirementSource.BIZ); setPriority(RequirementPriority.P2);
      setExpectedReleaseDate('');
    }
  }, [open, defaultBusinessLineUid]);

  const lineOptions: ComboboxOption[] = useMemo(
    () => businessLines.map((b) => ({ value: b.projectUid, label: b.name })),
    [businessLines],
  );
  const appOptions: ComboboxOption[] = useMemo(() => {
    const apps = businessLineUid ? appsByLine.get(businessLineUid) ?? [] : [];
    return [{ value: APP_SELF, label: '挂在业务线本身' }, ...apps.map((a) => ({ value: a.projectUid, label: a.name }))];
  }, [businessLineUid, appsByLine]);

  const isP0 = priority === RequirementPriority.P0;
  const canSubmit =
    title.trim() !== '' &&
    businessLineUid !== '' &&
    (!isP0 || expectedReleaseDate !== '') &&
    !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      value: value.trim() || undefined,
      description: description.trim() || undefined,
      business_line_uid: businessLineUid,
      app_project_uid: appProjectUid === APP_SELF ? null : appProjectUid,
      source,
      priority,
      expected_release_date: expectedReleaseDate || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border)] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">提需求</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <Field label="标题" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="一句话说清要解决什么"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="业务线" required>
              <Combobox options={lineOptions} value={businessLineUid} onChange={(val) => { setBusinessLineUid(val ?? ''); setAppProjectUid(APP_SELF); }} placeholder="选择业务线" />
            </Field>
            <Field label="归属 App">
              <Combobox options={appOptions} value={appProjectUid} onChange={(val) => setAppProjectUid(val ?? APP_SELF)} placeholder="挂业务线本身" />
            </Field>
          </div>

          <Field label="价值 / 解决的问题">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={2}
              placeholder="为什么要做、带来什么价值"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          <Field label="详细描述">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="背景、范围、约束"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="来源">
              <Combobox options={SOURCE_OPTIONS} value={source} onChange={(val) => setSource(val ?? RequirementSource.BIZ)} />
            </Field>
            <Field label="优先级">
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                      priority === p
                        ? p === 'P0'
                          ? 'border-[var(--accent-red)] bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
                          : 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <p className="-mt-2 text-[11px] text-[var(--text-muted)]">{PRIORITY_DESC[priority]}</p>

          {isP0 && (
            <Field label="期望上线日期" required>
              <input
                type="date"
                value={expectedReleaseDate}
                onChange={(e) => setExpectedReleaseDate(e.target.value)}
                className="w-full rounded-lg border border-[var(--accent-red)]/40 bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-red)]"
              />
            </Field>
          )}

          {impactSlot?.({ priority, businessLineUid, appProjectUid: appProjectUid === APP_SELF ? null : appProjectUid, expectedReleaseDate: expectedReleaseDate || null })}
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {submitting ? '提交中...' : '提交需求'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
        {label}{required && <span className="ml-0.5 text-[var(--accent-red)]">*</span>}
      </label>
      {children}
    </div>
  );
}
