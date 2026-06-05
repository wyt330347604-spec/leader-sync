import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthController } from '../auth.controller';

// 30 天（毫秒），与 SESSION_MAX_AGE_MS / JWT_EXPIRES_IN=30d 对齐
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function makeRes() {
  return {
    cookie: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
  };
}

function makeController(appEnv: string) {
  const authService = {
    loginWithCode: vi.fn().mockResolvedValue({
      token: 'jwt-token',
      user: { user_id: 'ou_x', user_name: 'X', role: 'employee', dept_id: '' },
    }),
  };
  const feishuAuth = { getOAuthRedirectUrl: vi.fn().mockReturnValue('https://feishu/oauth') };
  const config = { get: vi.fn((k: string) => (k === 'APP_ENV' ? appEnv : undefined)) };
  const controller = new AuthController(
    authService as any,
    feishuAuth as any,
    config as any,
  );
  return { controller, authService, config };
}

describe('AuthController cookie 会话策略', () => {
  let res: ReturnType<typeof makeRes>;

  beforeEach(() => {
    res = makeRes();
  });

  it('jsapi-auth: cookie maxAge = 30 天，httpOnly，sameSite lax', async () => {
    const { controller } = makeController('production');
    await controller.jsApiAuth('code123', res as any);

    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [name, token, opts] = res.cookie.mock.calls[0];
    expect(name).toBe('token');
    expect(token).toBe('jwt-token');
    expect(opts.maxAge).toBe(THIRTY_DAYS_MS);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
  });

  it('production 环境 secure=true（HTTPS-only cookie）', async () => {
    const { controller } = makeController('production');
    await controller.jsApiAuth('code123', res as any);
    expect(res.cookie.mock.calls[0][2].secure).toBe(true);
  });

  it('非 production 环境 secure=false（本地 http 开发可用）', async () => {
    const { controller } = makeController('development');
    await controller.jsApiAuth('code123', res as any);
    expect(res.cookie.mock.calls[0][2].secure).toBe(false);
  });

  it('oauth callback 成功路径: 30 天 cookie + 重定向到安全内部路径', async () => {
    const { controller } = makeController('production');
    await controller.oauthCallback('code123', '/dashboard', '', res as any);

    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie.mock.calls[0][2].maxAge).toBe(THIRTY_DAYS_MS);
    expect(res.cookie.mock.calls[0][2].secure).toBe(true);
    expect(res.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('oauth callback 无 code: 重定向到飞书授权页，不种 cookie', async () => {
    const { controller } = makeController('production');
    await controller.oauthCallback('', '', '/tasks', res as any);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('https://feishu/oauth');
  });
});
