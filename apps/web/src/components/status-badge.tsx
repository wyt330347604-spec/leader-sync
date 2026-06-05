// 状态徽章：颜色统一走 globals.css 的 --st-* 语义 token（高级灰体系，压低饱和）。
const STATUS_CONFIG: Record<string, { label: string; varName: string }> = {
  pending: { label: '待办', varName: '--st-pending' },
  not_started: { label: '待开始', varName: '--st-not-started' },
  assigned: { label: '已指派', varName: '--st-not-started' },
  in_progress: { label: '进行中', varName: '--st-in-progress' },
  stalled: { label: '已停滞', varName: '--st-stalled' },
  blocked: { label: '阻塞', varName: '--st-stalled' },
  done: { label: '已完成', varName: '--st-done' },
  shelved: { label: '已搁置', varName: '--st-shelved' },
  pending_review: { label: '待验收', varName: '--st-not-started' },
  reopened: { label: '重新打开', varName: '--st-in-progress' },
  closed: { label: '已归档', varName: '--st-shelved' },
  cancelled: { label: '已取消', varName: '--st-shelved' },
  draft: { label: '草稿', varName: '--st-shelved' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, varName: '--st-shelved' };
  const c = `var(${config.varName})`;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{
        color: c,
        backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 28%, transparent)`,
      }}
    >
      {config.label}
    </span>
  );
}
