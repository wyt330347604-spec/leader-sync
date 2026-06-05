const PRIORITY_CONFIG: Record<string, { label: string; textColor: string; bgColor: string; borderColor: string }> = {
  urgent_important: { label: '重要紧急', textColor: 'text-[var(--accent-red)]', bgColor: 'bg-[var(--accent-red)]/10', borderColor: 'border-[var(--accent-red)]/20' },
  important_not_urgent: { label: '重要不紧急', textColor: 'text-[var(--accent-orange)]', bgColor: 'bg-[var(--accent-orange)]/10', borderColor: 'border-[var(--accent-orange)]/20' },
  urgent_not_important: { label: '紧急不重要', textColor: 'text-[var(--accent-blue)]', bgColor: 'bg-[var(--accent-blue)]/10', borderColor: 'border-[var(--accent-blue)]/20' },
  not_urgent_not_important: { label: '不紧急不重要', textColor: 'text-[var(--text-muted)]', bgColor: 'bg-[var(--text-muted)]/10', borderColor: 'border-[var(--text-muted)]/20' },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const config = PRIORITY_CONFIG[priority] || { label: priority, textColor: 'text-[var(--text-muted)]', bgColor: 'bg-[var(--text-muted)]/10', borderColor: 'border-[var(--text-muted)]/20' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.bgColor} ${config.textColor} ${config.borderColor}`}>
      {config.label}
    </span>
  );
}
