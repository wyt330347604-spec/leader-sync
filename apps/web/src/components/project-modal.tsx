'use client';
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  ProjectCategory,
  ProjectCategoryLabel,
  ProjectCategoryOrder,
  ProjectRegion,
  ProjectRegionList,
} from '@leader-sync/shared-types';

export interface ProjectFormValue {
  name: string;
  category: ProjectCategory | null;
  ownerName: string | null;
  region: ProjectRegion | null;
  subtitle: string | null;
  isDefault: boolean;
}

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<ProjectFormValue>;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (value: ProjectFormValue) => Promise<void> | void;
}

const EMPTY: ProjectFormValue = {
  name: '',
  category: null,
  ownerName: '',
  region: null,
  subtitle: '',
  isDefault: false,
};

const REGION_OPTIONS: ComboboxOption[] = [
  { value: '', label: '无' },
  ...ProjectRegionList.map((r) => ({ value: r, label: r })),
];

export function ProjectModal({ open, mode, initial, submitting, onClose, onSubmit }: Props) {
  const [v, setV] = useState<ProjectFormValue>(EMPTY);

  useEffect(() => {
    if (open) {
      setV({ ...EMPTY, ...initial });
    }
  }, [open, initial]);

  const canSubmit = v.name.trim() !== '' && !submitting;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      ...v,
      name: v.name.trim(),
      ownerName: v.ownerName?.trim() || null,
      subtitle: v.subtitle?.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">
            {mode === 'create' ? '新建项目' : '编辑项目'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="项目名称" required>
            <input
              value={v.name}
              onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))}
              placeholder="例如：XT 印度"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
              autoFocus
            />
          </Field>

          <Field label="业务板块">
            <div className="flex flex-wrap gap-2">
              {ProjectCategoryOrder.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setV((s) => ({ ...s, category: s.category === c ? null : c }))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
                    v.category === c
                      ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white'
                      : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)]'
                  }`}
                >
                  {ProjectCategoryLabel[c]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="负责人">
            <input
              value={v.ownerName ?? ''}
              onChange={(e) => setV((s) => ({ ...s, ownerName: e.target.value }))}
              placeholder="留空则显示「空缺」"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          <Field label="国家/地区">
            <Combobox
              value={v.region ?? ''}
              onChange={(val) => setV((s) => ({ ...s, region: (val || null) as ProjectRegion | null }))}
              options={REGION_OPTIONS}
              placeholder="无"
              searchPlaceholder="搜索国家"
            />
          </Field>

          <Field label="副标签">
            <input
              value={v.subtitle ?? ''}
              onChange={(e) => setV((s) => ({ ...s, subtitle: e.target.value }))}
              placeholder="例如：NBFC × 2 / 联合负责"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={v.isDefault}
              onChange={(e) => setV((s) => ({ ...s, isDefault: e.target.checked }))}
            />
            设为默认项目
          </label>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-full bg-[#3b82f6] px-6 py-2 text-sm font-medium text-white hover:bg-[#2563eb] disabled:opacity-50"
          >
            {submitting ? '提交中...' : (mode === 'create' ? '创建' : '保存')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
        {label}{required && <span className="text-[#ef4444] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
