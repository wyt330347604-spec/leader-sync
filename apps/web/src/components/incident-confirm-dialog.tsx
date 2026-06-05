'use client';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => Promise<void>;
  readonly incidentTitle: string;
}

interface RejectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onReject: (reason: string) => Promise<void>;
  readonly incidentTitle: string;
}

export function IncidentConfirmDialog({ open, onOpenChange, onConfirm, incidentTitle }: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[var(--text-primary)]">确认事故生效？</AlertDialogTitle>
          <AlertDialogDescription className="text-[var(--text-secondary)]">
            「{incidentTitle}」将被确认生效，涉及员工将收到飞书通知。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            className="bg-[var(--accent-green)] text-white hover:bg-[var(--accent-green)]/90"
          >
            {loading ? '处理中...' : '确认生效'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function IncidentRejectDialog({ open, onOpenChange, onReject, incidentTitle }: RejectDialogProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleReject() {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await onReject(reason.trim());
      setReason('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!loading) { setReason(''); onOpenChange(o); } }}>
      <AlertDialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[var(--text-primary)]">驳回事故记录</AlertDialogTitle>
          <AlertDialogDescription className="text-[var(--text-secondary)]">
            驳回「{incidentTitle}」，请填写驳回理由：
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请输入驳回理由（必填）"
            rows={3}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none resize-none"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading || !reason.trim()}
            onClick={(e) => {
              e.preventDefault();
              handleReject();
            }}
            className="bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red)]/90"
          >
            {loading ? '处理中...' : '确认驳回'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
