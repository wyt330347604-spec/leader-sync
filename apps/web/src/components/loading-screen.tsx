interface LoadingScreenProps {
  readonly message?: string;
}

/**
 * Full-page loading state used during ensureAuth() / redirects so users never
 * see a fully white blank page (was P0 from 2026-05-08 visual audit).
 */
export function LoadingScreen({ message = '正在跳转登录...' }: LoadingScreenProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 bg-[var(--bg-page)]">
      <div className="size-10 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent-blue)]" />
      <p className="text-sm text-[var(--text-secondary)]">{message}</p>
    </div>
  );
}
