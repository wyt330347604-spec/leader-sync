'use client';

// 兜底错误边界：连 root layout 都渲染失败时生效（必须自带 html/body）。
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, margin: 0 }}>
        <p style={{ fontSize: 18, fontWeight: 600 }}>系统暂时不可用</p>
        <p style={{ fontSize: 14, color: '#666' }}>请稍后重试。若持续出现，请联系管理员。</p>
        <button onClick={() => reset()} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }}>
          重试
        </button>
      </body>
    </html>
  );
}
