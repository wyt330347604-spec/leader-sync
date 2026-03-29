const STATUS_CONFIG: Record<string, { label: string; dotColor: string; textColor: string; bgColor: string }> = {
  pending: { label: '待办', dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' },
  not_started: { label: '待开始', dotColor: 'bg-[#0071e3]', textColor: 'text-[#0071e3]', bgColor: 'bg-[#0071e3]/5' },
  assigned: { label: '已指派', dotColor: 'bg-[#0071e3]', textColor: 'text-[#0071e3]', bgColor: 'bg-[#0071e3]/5' },
  in_progress: { label: '进行中', dotColor: 'bg-[#ff9500]', textColor: 'text-[#ff9500]', bgColor: 'bg-[#ff9500]/5' },
  stalled: { label: '已停滞', dotColor: 'bg-[#ff3b30]', textColor: 'text-[#ff3b30]', bgColor: 'bg-[#ff3b30]/5' },
  blocked: { label: '阻塞', dotColor: 'bg-[#ff3b30]', textColor: 'text-[#ff3b30]', bgColor: 'bg-[#ff3b30]/5' },
  done: { label: '已完成', dotColor: 'bg-[#34c759]', textColor: 'text-[#34c759]', bgColor: 'bg-[#34c759]/5' },
  shelved: { label: '已搁置', dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' },
  pending_review: { label: '待验收', dotColor: 'bg-[#af52de]', textColor: 'text-[#af52de]', bgColor: 'bg-[#af52de]/5' },
  reopened: { label: '重新打开', dotColor: 'bg-[#ff9500]', textColor: 'text-[#ff9500]', bgColor: 'bg-[#ff9500]/5' },
  closed: { label: '已归档', dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' },
  cancelled: { label: '已取消', dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' },
  draft: { label: '草稿', dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, dotColor: 'bg-[#86868b]', textColor: 'text-[#86868b]', bgColor: 'bg-[#86868b]/5' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bgColor} ${config.textColor}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
