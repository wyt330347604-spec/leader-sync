import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-lg font-semibold text-[var(--text-primary)]">页面不存在</p>
      <p className="text-sm text-[var(--text-secondary)]">你访问的页面找不到了。</p>
      <Link
        href="/tasks"
        className="rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-sm text-white hover:opacity-90"
      >
        回到我的任务
      </Link>
    </div>
  );
}
