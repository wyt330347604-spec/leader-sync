const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  p0: { label: 'P0 极高', className: 'bg-red-100 text-red-700' },
  p1: { label: 'P1 高', className: 'bg-orange-100 text-orange-700' },
  p2: { label: 'P2 中', className: 'bg-blue-100 text-blue-700' },
  p3: { label: 'P3 低', className: 'bg-gray-100 text-gray-600' },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const config = PRIORITY_CONFIG[priority] || { label: priority, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
