const PRIORITY_CONFIG: Record<string, { label: string; dotColor: string; textColor: string; bgColor: string }> = {
  urgent_important: { label: '重要紧急', dotColor: 'bg-[#ff3b30]', textColor: 'text-[#ff3b30]', bgColor: 'bg-[#ff3b30]/5' },
  important_not_urgent: { label: '重要不紧急', dotColor: 'bg-[#ff9500]', textColor: 'text-[#ff9500]', bgColor: 'bg-[#ff9500]/5' },
  urgent_not_important: { label: '紧急不重要', dotColor: 'bg-[#0071e3]', textColor: 'text-[#0071e3]', bgColor: 'bg-[#0071e3]/5' },
  not_urgent_not_important: { label: '不紧急不重要', dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const config = PRIORITY_CONFIG[priority] || { label: priority, dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bgColor} ${config.textColor}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
