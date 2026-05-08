'use client';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV_LINKS = [
  { href: '/tasks', label: '我的任务' },
  { href: '/tasks/create', label: '新建任务' },
  { href: '/dashboard', label: '驾驶舱' },
  { href: '/projects', label: '项目管理' },
  { href: '/settings/notifications', label: '设置' },
];

export function TopNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 right-0 left-0 z-50 h-12 bg-[var(--bg-page)]/80 backdrop-blur-xl border-b border-[var(--border)]">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="/dashboard" className="text-base font-semibold tracking-tight text-[var(--text-primary)] whitespace-nowrap">
          督办系统
        </a>

        {/* Desktop nav (≥ sm) */}
        <nav className="hidden sm:flex items-center gap-6">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-xs text-[var(--text-secondary)] whitespace-nowrap transition-all duration-300 ease-out hover:text-[var(--text-primary)]"
            >
              {l.label}
            </a>
          ))}
          <ThemeToggle />
        </nav>

        {/* Mobile hamburger (< sm) */}
        <div className="flex sm:hidden items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="菜单"
            className="rounded-md p-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="sm:hidden absolute top-full inset-x-0 bg-[var(--bg-card)] border-b border-[var(--border)] shadow-lg">
          <nav className="flex flex-col py-2">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-6 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
