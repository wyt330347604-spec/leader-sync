const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-700' },
  assigned: { label: '已指派', className: 'bg-blue-100 text-blue-700' },
  in_progress: { label: '进行中', className: 'bg-yellow-100 text-yellow-700' },
  blocked: { label: '阻塞', className: 'bg-red-100 text-red-700' },
  pending_review: { label: '待验收', className: 'bg-purple-100 text-purple-700' },
  done: { label: '已完成', className: 'bg-green-100 text-green-700' },
  reopened: { label: '重新打开', className: 'bg-orange-100 text-orange-700' },
  cancelled: { label: '已取消', className: 'bg-gray-200 text-gray-500' },
  closed: { label: '已归档', className: 'bg-gray-200 text-gray-500' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
