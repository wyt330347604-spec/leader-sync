import type { Metadata } from 'next';
import { TopNav } from '@/components/top-nav';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: '领导月度督办系统',
  description: '飞书领导月度督办系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] antialiased">
        <TopNav />
        <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-16">
          {children}
        </main>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
