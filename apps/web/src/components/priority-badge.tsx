const PRIORITY_CONFIG: Record<string, { label: string; textColor: string; bgColor: string; borderColor: string }> = {
  urgent_important: { label: '重要紧急', textColor: 'text-[#ef4444]', bgColor: 'bg-[#ef4444]/10', borderColor: 'border-[#ef4444]/20' },
  important_not_urgent: { label: '重要不紧急', textColor: 'text-[#f59e0b]', bgColor: 'bg-[#f59e0b]/10', borderColor: 'border-[#f59e0b]/20' },
  urgent_not_important: { label: '紧急不重要', textColor: 'text-[#3b82f6]', bgColor: 'bg-[#3b82f6]/10', borderColor: 'border-[#3b82f6]/20' },
  not_urgent_not_important: { label: '不紧急不重要', textColor: 'text-[#5a5a6e]', bgColor: 'bg-[#5a5a6e]/10', borderColor: 'border-[#5a5a6e]/20' },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const config = PRIORITY_CONFIG[priority] || { label: priority, textColor: 'text-[#5a5a6e]', bgColor: 'bg-[#5a5a6e]/10', borderColor: 'border-[#5a5a6e]/20' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.bgColor} ${config.textColor} ${config.borderColor}`}>
      {config.label}
    </span>
  );
}
