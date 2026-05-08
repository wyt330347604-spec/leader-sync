'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { LoadingScreen } from "@/components/loading-screen";
import { ensureAuth } from '@/lib/auth';
import {
  useNotificationPreference,
  updateNotificationPreference,
  type NotificationPreference,
} from '@/hooks/use-notification-preference';

interface SwitchRowProps {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}

function SwitchRow({ id, title, description, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </label>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40 disabled:opacity-50 ${
          checked ? 'bg-[var(--accent-blue)]' : 'bg-[var(--bg-surface)] border border-[var(--border)]'
        }`}
      >
        <span
          className={`inline-block size-4 transform rounded-full bg-white shadow-sm transition-transform duration-300 ease-out ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export default function NotificationSettingsPage() {
  const [authed, setAuthed] = useState(false);
  const { data, isLoading, mutate } = useNotificationPreference();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  async function handleToggle(field: keyof NotificationPreference, next: boolean) {
    if (!data) return;
    setSaving(true);
    const optimistic = { ...data, [field]: next };
    mutate(optimistic, { revalidate: false });
    try {
      const saved = await updateNotificationPreference({ [field]: next });
      mutate(saved, { revalidate: false });
      toast.success('设置已保存');
    } catch (err: unknown) {
      mutate(data, { revalidate: false });
      const message = err instanceof Error ? err.message : '保存失败';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (!authed) {
    return <LoadingScreen />;
  }

  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">通知设置</h1>
      <p className="mb-8 text-sm text-[var(--text-secondary)]">
        关闭某项后，飞书将不再向你推送对应消息。下属延期周报为履职信息，不可关闭。
      </p>

      {isLoading || !data ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-10 text-center text-sm text-[var(--text-muted)]">
          加载中...
        </div>
      ) : (
        <div className="space-y-4">
          <SwitchRow
            id="daily_overdue"
            title="每日延期任务提醒"
            description="每天 10:00 通过飞书推送你名下已逾期的任务列表。"
            checked={data.dailyOverdueEnabled}
            disabled={saving}
            onChange={(next) => handleToggle('dailyOverdueEnabled', next)}
          />
          <SwitchRow
            id="weekly_summary"
            title="每周一周报"
            description="每周一 9:00 推送本周到期任务和已逾期任务汇总。"
            checked={data.weeklySummaryEnabled}
            disabled={saving}
            onChange={(next) => handleToggle('weeklySummaryEnabled', next)}
          />
        </div>
      )}
    </div>
  );
}
