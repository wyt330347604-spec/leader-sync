import { isFeishuEnv, feishuLogin } from './feishu';
import { apiFetch } from './api-client';

export async function ensureAuth(): Promise<boolean> {
  try {
    await apiFetch('/api/v1/auth/me');
    return true;
  } catch {
    if (isFeishuEnv()) {
      try {
        const code = await feishuLogin();
        await apiFetch('/api/v1/auth/feishu/jsapi-auth', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        return true;
      } catch {
        return false;
      }
    }
    // Defer redirect briefly so the LoadingScreen has a chance to render
    // (avoids users seeing a fully white blank page during navigation).
    const target = `/api/v1/auth/feishu/callback?redirect=${encodeURIComponent(window.location.pathname)}`;
    setTimeout(() => { window.location.href = target; }, 800);
    return false;
  }
}
