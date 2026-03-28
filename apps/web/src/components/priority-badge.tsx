const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  urgent_important: { label: '重要紧急', className: 'bg-red-100 text-red-700' },
  important_not_urgent: { label: '重要不紧急', className: 'bg-orange-100 text-orange-700' },
  urgent_not_important: { label: '紧急不重要', className: 'bg-blue-100 text-blue-700' },
  not_urgent_not_important: { label: '不紧急不重要', className: 'bg-gray-100 text-gray-600' },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const config = PRIORITY_CONFIG[priority] || { label: priority, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
