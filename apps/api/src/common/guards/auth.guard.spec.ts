import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthGuard } from './auth.guard';
import { UnauthorizedException } from '@nestjs/common';

function mkContext(cookies: Record<string, string>) {
  const request: any = { cookies };
  return {
    request,
    ctx: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any,
  };
}

function mkDb(bindings: Array<{ role: string }> | Error) {
  return {
    select: () => ({
      from: () => ({
        where: () => {
          if (bindings instanceof Error) return Promise.reject(bindings);
          return Promise.resolve(bindings);
        },
      }),
    }),
  };
}

describe('AuthGuard — 角色实时读库（绑定变更即时生效，无需重新登录）', () => {
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };
  let config: { getOrThrow: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwt = { verifyAsync: vi.fn() };
    config = { getOrThrow: vi.fn().mockReturnValue('secret') };
  });

  it('JWT 里的旧角色被 DB 最新绑定覆盖（employee→leader）', async () => {
    jwt.verifyAsync.mockResolvedValue({ user_id: 'emp_1', open_id: 'ou_1', role: 'employee' });
    const guard = new AuthGuard(jwt as any, config as any, mkDb([{ role: 'leader' }]) as any);
    const { request, ctx } = mkContext({ token: 't' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user.role).toBe('leader');
  });

  it('绑定被删除后回落 employee（撤权即时生效）', async () => {
    jwt.verifyAsync.mockResolvedValue({ user_id: 'ou_gone', role: 'leader' });
    const guard = new AuthGuard(jwt as any, config as any, mkDb([]) as any);
    const { request, ctx } = mkContext({ token: 't' });

    await guard.canActivate(ctx);
    expect(request.user.role).toBe('employee');
  });

  it('角色查询故障时回落 JWT 快照角色，不阻断请求', async () => {
    jwt.verifyAsync.mockResolvedValue({ user_id: 'ou_1', role: 'pmo' });
    const guard = new AuthGuard(jwt as any, config as any, mkDb(new Error('db down')) as any);
    const { request, ctx } = mkContext({ token: 't' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user.role).toBe('pmo');
  });

  it('无 token 抛 401', async () => {
    const guard = new AuthGuard(jwt as any, config as any, mkDb([]) as any);
    const { ctx } = mkContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token 无效抛 401', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('bad token'));
    const guard = new AuthGuard(jwt as any, config as any, mkDb([]) as any);
    const { ctx } = mkContext({ token: 'bad' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
