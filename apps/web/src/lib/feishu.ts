export function isFeishuEnv(): boolean {
  if (typeof window === 'undefined') return false;
  return /Lark|Feishu/i.test(navigator.userAgent);
}

export async function feishuLogin(): Promise<string> {
  // Feishu JS-SDK is only available inside Feishu webview at runtime.
  // The actual SDK is injected by the Feishu client, not installed via npm.
  // We access it via the global `window.h5sdk` or `window.tt` object.
  const w = window as any;
  const tt = w.tt || w.h5sdk || w.lark;
  if (!tt?.requestAuthCode) {
    throw new Error('Feishu JS-SDK not available — not running inside Feishu');
  }
  return new Promise((resolve, reject) => {
    tt.requestAuthCode({
      appId: process.env.NEXT_PUBLIC_FEISHU_APP_ID || '',
      success: (res: { code: string }) => resolve(res.code),
      fail: (err: unknown) => reject(err),
    });
  });
}
