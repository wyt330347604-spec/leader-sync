import type { Metadata } from 'next';
import { ThemeToggle } from '@/components/theme-toggle';
import './globals.css';

export const metadata: Metadata = {
  title: '领导月度督办系统',
  description: '飞书领导月度督办系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] antialiased">
        <header className="fixed top-0 right-0 left-0 z-50 h-12 bg-[var(--bg-page)]/80 backdrop-blur-xl border-b border-[var(--border)]">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
            <a href="/dashboard" className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              督办系统
            </a>
            <nav className="flex items-center gap-6">
              <a
                href="/tasks"
                className="text-xs text-[var(--text-secondary)] transition-all duration-300 ease-out hover:text-[var(--text-primary)]"
              >
                我的任务
              </a>
              <a
                href="/tasks/create"
                className="text-xs text-[var(--text-secondary)] transition-all duration-300 ease-out hover:text-[var(--text-primary)]"
              >
                新建任务
              </a>
              <a
                href="/dashboard"
                className="text-xs text-[var(--text-secondary)] transition-all duration-300 ease-out hover:text-[var(--text-primary)]"
              >
                驾驶舱
              </a>
              <a
                href="/projects"
                className="text-xs text-[var(--text-secondary)] transition-all duration-300 ease-out hover:text-[var(--text-primary)]"
              >
                项目管理
              </a>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 pt-16">
          {children}
        </main>
      </body>
    </html>
  );
}
