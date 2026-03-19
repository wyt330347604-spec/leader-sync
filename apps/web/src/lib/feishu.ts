export function isFeishuEnv(): boolean {
  if (typeof window === 'undefined') return false;
  return /Lark|Feishu/i.test(navigator.userAgent);
}

export async function feishuLogin(): Promise<string> {
  const lark = await import('@niceteam/lark-js-sdk').catch(() => null);
  if (!lark) {
    throw new Error('Feishu JS-SDK not available');
  }
  return new Promise((resolve, reject) => {
    (lark.default || lark).auth.login({
      success: (res: { code: string }) => resolve(res.code),
      fail: (err: unknown) => reject(err),
    });
  });
}
