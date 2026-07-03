import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService, JwtPayload } from '../auth.service';
import type { FeishuAuthService } from '../feishu-auth.service';

function createMockFeishuAuth(): FeishuAuthService {
  return {
    getUserAccessToken: vi.fn().mockResolvedValue('fake-user-access-token'),
    getUserInfo: vi.fn().mockResolvedValue({
      user_id: 'u_abc123',
      open_id: 'ou_abc123',
      name: 'Test User',
      department_ids: ['dept_001'],
    }),
    getAppAccessToken: vi.fn().mockResolvedValue('fake-app-token'),
    getOAuthRedirectUrl: vi.fn().mockReturnValue('https://example.com'),
  } as unknown as FeishuAuthService;
}

function createMockJwtService() {
  return {
    signAsync: vi.fn().mockResolvedValue('signed-jwt-token'),
    verifyAsync: vi.fn(),
  };
}

function createMockDb() {
  const chainable = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockReturnThis(),
  };
  return {
    insert: vi.fn().mockReturnValue(chainable),
    select: vi.fn().mockReturnValue(chainable),
    update: vi.fn().mockReturnValue(chainable),
    _chainable: chainable,
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  let mockFeishuAuth: ReturnType<typeof createMockFeishuAuth>;
  let mockJwtService: ReturnType<typeof createMockJwtService>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockFeishuAuth = createMockFeishuAuth();
    mockJwtService = createMockJwtService();
    mockDb = createMockDb();

    authService = new AuthService(
      mockDb as any,
      mockJwtService as any,
      mockFeishuAuth,
    );
  });

  describe('loginWithCode', () => {
    it('should exchange code for JWT token and return user payload', async () => {
      const result = await authService.loginWithCode('feishu-auth-code');

      expect(mockFeishuAuth.getUserAccessToken).toHaveBeenCalledWith(
        'feishu-auth-code',
      );
      expect(mockFeishuAuth.getUserInfo).toHaveBeenCalledWith(
        'fake-user-access-token',
      );
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockJwtService.signAsync).toHaveBeenCalledWith({
        user_id: 'u_abc123',
        open_id: 'ou_abc123',
        user_name: 'Test User',
        role: 'employee',
        dept_id: 'dept_001',
      });
      expect(result).toEqual({
        token: 'signed-jwt-token',
        user: {
          user_id: 'u_abc123',
          open_id: 'ou_abc123',
          user_name: 'Test User',
          role: 'employee',
          dept_id: 'dept_001',
        },
      });
    });

    it('should use existing role from DB when available', async () => {
      const insertChain = {
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(insertChain as any);

      // 新流程有两次 select：①org_cache 既有行匹配（返回空 → 走 insert）②角色查询
      const orgSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      const roleSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi
          .fn()
          .mockResolvedValue([
            { userId: 'u_abc123', role: 'manager', createdAt: new Date() },
          ]),
      };
      mockDb.select
        .mockReturnValueOnce(orgSelect as any)
        .mockReturnValueOnce(roleSelect as any);

      const result = await authService.loginWithCode('feishu-auth-code');

      expect(result.user.role).toBe('manager');
    });
  });

  describe('getMe', () => {
    it('should return user profile from DB', async () => {
      const selectChain1 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            userId: 'u_abc123',
            openId: 'ou_abc123',
            userName: 'Test User',
            deptId: 'dept_001',
            syncedAt: new Date(),
          },
        ]),
      };
      const selectChain2 = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          { userId: 'u_abc123', role: 'admin', createdAt: new Date() },
        ]),
      };
      mockDb.select
        .mockReturnValueOnce(selectChain1 as any)
        .mockReturnValueOnce(selectChain2 as any);

      const result = await authService.getMe('u_abc123');

      expect(result).toEqual({
        user_id: 'u_abc123',
        open_id: 'ou_abc123',
        user_name: 'Test User',
        role: 'admin',
        dept_id: 'dept_001',
      });
    });

    it('should return null when user not found', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain as any);

      const result = await authService.getMe('nonexistent');

      expect(result).toBeNull();
    });
  });
});
