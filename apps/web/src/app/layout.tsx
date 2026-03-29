import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '领导月度督办系统',
  description: '飞书领导月度督办系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f] antialiased">
        <header className="fixed top-0 right-0 left-0 z-50 h-12 backdrop-blur-xl bg-white/80">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
            <a href="/dashboard" className="text-base font-semibold tracking-tight text-[#1d1d1f]">
              督办系统
            </a>
            <nav className="flex items-center gap-6">
              <a
                href="/tasks"
                className="text-xs text-[#1d1d1f]/80 transition-all duration-300 ease-out hover:text-[#0071e3]"
              >
                我的任务
              </a>
              <a
                href="/tasks/create"
                className="text-xs text-[#1d1d1f]/80 transition-all duration-300 ease-out hover:text-[#0071e3]"
              >
                新建任务
              </a>
              <a
                href="/dashboard"
                className="text-xs text-[#1d1d1f]/80 transition-all duration-300 ease-out hover:text-[#0071e3]"
              >
                驾驶舱
              </a>
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
