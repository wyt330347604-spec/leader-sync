const SEVERITY_CONFIG: Record<string, { label: string; textColor: string; bgColor: string; borderColor: string }> = {
  P0: { label: 'P0', textColor: 'text-[var(--accent-red)]', bgColor: 'bg-[var(--accent-red)]/10', borderColor: 'border-[var(--accent-red)]/30' },
  P1: { label: 'P1', textColor: 'text-[#f97316]', bgColor: 'bg-[#f97316]/10', borderColor: 'border-[#f97316]/30' },
  P2: { label: 'P2', textColor: 'text-[#eab308]', bgColor: 'bg-[#eab308]/10', borderColor: 'border-[#eab308]/30' },
  P3: { label: 'P3', textColor: 'text-[var(--accent-blue)]', bgColor: 'bg-[var(--accent-blue)]/10', borderColor: 'border-[var(--accent-blue)]/20' },
};

export function IncidentSeverityBadge({ severity }: { severity: string }) {
  const config = SEVERITY_CONFIG[severity] ?? {
    label: severity,
    textColor: 'text-[var(--text-muted)]',
    bgColor: 'bg-[var(--text-muted)]/10',
    borderColor: 'border-[var(--text-muted)]/20',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${config.bgColor} ${config.textColor} ${config.borderColor}`}
    >
      {config.label}
    </span>
  );
}
