const STATUS_CONFIG: Record<string, { label: string; textColor: string; bgColor: string; borderColor: string }> = {
  pending: { label: '待办', textColor: 'text-[#3b82f6]', bgColor: 'bg-[#3b82f6]/10', borderColor: 'border-[#3b82f6]/20' },
  not_started: { label: '待开始', textColor: 'text-[#8b5cf6]', bgColor: 'bg-[#8b5cf6]/10', borderColor: 'border-[#8b5cf6]/20' },
  assigned: { label: '已指派', textColor: 'text-[#8b5cf6]', bgColor: 'bg-[#8b5cf6]/10', borderColor: 'border-[#8b5cf6]/20' },
  in_progress: { label: '进行中', textColor: 'text-[#f59e0b]', bgColor: 'bg-[#f59e0b]/10', borderColor: 'border-[#f59e0b]/20' },
  stalled: { label: '已停滞', textColor: 'text-[#ef4444]', bgColor: 'bg-[#ef4444]/10', borderColor: 'border-[#ef4444]/20' },
  blocked: { label: '阻塞', textColor: 'text-[#ef4444]', bgColor: 'bg-[#ef4444]/10', borderColor: 'border-[#ef4444]/20' },
  done: { label: '已完成', textColor: 'text-[#22c55e]', bgColor: 'bg-[#22c55e]/10', borderColor: 'border-[#22c55e]/20' },
  shelved: { label: '已搁置', textColor: 'text-[#5a5a6e]', bgColor: 'bg-[#5a5a6e]/10', borderColor: 'border-[#5a5a6e]/20' },
  pending_review: { label: '待验收', textColor: 'text-[#8b5cf6]', bgColor: 'bg-[#8b5cf6]/10', borderColor: 'border-[#8b5cf6]/20' },
  reopened: { label: '重新打开', textColor: 'text-[#f59e0b]', bgColor: 'bg-[#f59e0b]/10', borderColor: 'border-[#f59e0b]/20' },
  closed: { label: '已归档', textColor: 'text-[#5a5a6e]', bgColor: 'bg-[#5a5a6e]/10', borderColor: 'border-[#5a5a6e]/20' },
  cancelled: { label: '已取消', textColor: 'text-[#5a5a6e]', bgColor: 'bg-[#5a5a6e]/10', borderColor: 'border-[#5a5a6e]/20' },
  draft: { label: '草稿', textColor: 'text-[#5a5a6e]', bgColor: 'bg-[#5a5a6e]/10', borderColor: 'border-[#5a5a6e]/20' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, textColor: 'text-[#5a5a6e]', bgColor: 'bg-[#5a5a6e]/10', borderColor: 'border-[#5a5a6e]/20' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.bgColor} ${config.textColor} ${config.borderColor}`}>
      {config.label}
    </span>
  );
}
