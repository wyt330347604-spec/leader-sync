import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '领导月度督办系统',
  description: '飞书领导月度督办系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="border-b bg-white px-6 py-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">督办系统</h1>
            <nav className="flex items-center gap-4">
              <a href="/tasks" className="text-sm text-gray-600 hover:text-gray-900">我的任务</a>
              <a href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">驾驶舱</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
