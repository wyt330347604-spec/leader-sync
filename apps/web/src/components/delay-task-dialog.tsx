'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DatePicker } from '@/components/date-picker';

interface DelayTaskDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly currentDueAt: string | Date;
  readonly delayCount: number;
  readonly submitting: boolean;
  readonly onConfirm: (newDate: string) => void | Promise<void>;
}

function startOfTodayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDate(v: string | Date): Date {
  return typeof v === 'string' ? parseISO(v) : v;
}

export function DelayTaskDialog({
  open,
  onOpenChange,
  currentDueAt,
  delayCount,
  submitting,
  onConfirm,
}: DelayTaskDialogProps) {
  const [newDate, setNewDate] = useState('');

  useEffect(() => {
    if (!open) setNewDate('');
  }, [open]);

  const currentDue = toDate(currentDueAt);
  const today = startOfTodayLocal();
  const minDate = currentDue > today ? currentDue : today;

  const canSubmit = newDate.length === 10 && !submitting;
  const showWarn = delayCount >= 3;
  const showInfo = delayCount > 0 && delayCount < 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[var(--bg-card)] border-[var(--border)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">延期任务</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            原截止日期：{format(currentDue, 'yyyy 年 M 月 d 日', { locale: zhCN })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label htmlFor="new-due-date" className="block text-xs font-medium text-[var(--text-secondary)]">
            新截止日期 <span className="text-[var(--accent-red)]">*</span>
          </label>
          <DatePicker
            id="new-due-date"
            value={newDate}
            onChange={setNewDate}
            minDate={minDate}
            placeholder="点击选择日期"
            disabled={submitting}
          />

          {showWarn && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-3 py-2 text-xs text-[var(--accent-red)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>此任务已延期 {delayCount} 次，请审慎延期。</span>
            </div>
          )}
          {showInfo && (
            <p className="text-xs text-[var(--text-muted)]">
              此任务已延期 {delayCount} 次。
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={() => canSubmit && onConfirm(newDate)}
            disabled={!canSubmit}
            className="bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange)]/90"
          >
            {submitting ? '提交中...' : '确认延期'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
