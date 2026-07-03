'use client';
import { useEffect } from 'react';

// 路由级错误边界：任何页面渲染/数据抛错（含 API 502 时 api-client 抛出的错误）
// 都落到这里，而不是整页白屏。
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('page error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-lg font-semibold text-[var(--text-primary)]">页面出错了</p>
      <p className="max-w-md text-sm text-[var(--text-secondary)]">
        {error.message?.includes('fetch') || error.message?.includes('JSON')
          ? '暂时连不上服务器，请稍后重试。'
          : '发生了一个错误，请重试或刷新页面。'}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-sm text-white hover:opacity-90"
        >
          重试
        </button>
        <button
          onClick={() => location.reload()}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          刷新页面
        </button>
      </div>
    </div>
  );
}
