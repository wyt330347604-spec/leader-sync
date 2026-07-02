import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgService } from './org.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '@leader-sync/shared-types';

function mkRow(overrides: Record<string, any> = {}): any {
  return {
    id: Math.floor(Math.random() * 100000),
    userId: 'ou_user',
    openId: 'ou_user',
    userName: 'User',
    managerUserId: null,
    managerName: null,
    managerSource: 'feishu',
    managerUpdatedAt: null,
    currentGrade: null,
    ...overrides,
  };
}

describe('OrgService', () => {
  let repo: { listAll: ReturnType<typeof vi.fn>; setManager: ReturnType<typeof vi.fn>; setManagerSource: ReturnType<typeof vi.fn> };
  let service: OrgService;

  beforeEach(() => {
    repo = { listAll: vi.fn(), setManager: vi.fn(), setManagerSource: vi.fn() };
    service = new OrgService(repo as any);
  });

  describe('getTree', () => {
    it('返回全员节点 + 最近一次飞书同步时间', async () => {
      const t1 = new Date('2026-07-01T23:00:00Z');
      const t2 = new Date('2026-07-02T23:00:00Z');
      repo.listAll.mockResolvedValue([
        mkRow({ userId: 'ou_a', userName: 'A', managerUserId: 'ou_b', managerName: 'B', managerUpdatedAt: t1 }),
        mkRow({ userId: 'ou_b', userName: 'B', managerUpdatedAt: t2 }),
        mkRow({ userId: 'ou_c', userName: 'C', managerSource: 'manual', managerUpdatedAt: new Date('2026-07-03T00:00:00Z') }),
      ]);

      const r = await service.getTree();

      expect(r.users).toHaveLength(3);
      expect(r.users[0]).toMatchObject({ user_id: 'ou_a', manager_user_id: 'ou_b', manager_source: 'feishu' });
      // manual 行的时间不计入 last_feishu_sync_at
      expect(r.last_feishu_sync_at).toBe(t2.toISOString());
    });
  });

  describe('setManager', () => {
    it('非特权角色被拒（1002）', async () => {
      await expect(service.setManager('ou_emp', 'employee', 'ou_a', 'ou_b')).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
      });
      expect(repo.listAll).not.toHaveBeenCalled();
    });

    it('目标用户不存在 → 1016', async () => {
      repo.listAll.mockResolvedValue([mkRow({ userId: 'ou_b' })]);
      await expect(service.setManager('ou_admin', 'admin', 'ou_ghost', 'ou_b')).rejects.toMatchObject({
        businessCode: ErrorCode.ORG_USER_NOT_FOUND,
      });
    });

    it('新上级不存在 → 1017', async () => {
      repo.listAll.mockResolvedValue([mkRow({ userId: 'ou_a' })]);
      await expect(service.setManager('ou_admin', 'admin', 'ou_a', 'ou_ghost')).rejects.toMatchObject({
        businessCode: ErrorCode.ORG_INVALID_MANAGER,
      });
    });

    it('自己不能当自己的上级 → 1017', async () => {
      repo.listAll.mockResolvedValue([mkRow({ id: 1, userId: 'ou_a', openId: 'ou_a' })]);
      await expect(service.setManager('ou_admin', 'admin', 'ou_a', 'ou_a')).rejects.toMatchObject({
        businessCode: ErrorCode.ORG_INVALID_MANAGER,
      });
    });

    it('汇报环被拒：A→B→C 链上把 C 的下属 A 设为 C 的上级', async () => {
      // c 的上级是 b，b 的上级是 a；现在试图把 a 的上级设为 c → a→c→b→a 环
      repo.listAll.mockResolvedValue([
        mkRow({ id: 1, userId: 'ou_a', openId: 'ou_a' }),
        mkRow({ id: 2, userId: 'ou_b', openId: 'ou_b', managerUserId: 'ou_a' }),
        mkRow({ id: 3, userId: 'ou_c', openId: 'ou_c', managerUserId: 'ou_b' }),
      ]);
      await expect(service.setManager('ou_admin', 'admin', 'ou_a', 'ou_c')).rejects.toMatchObject({
        businessCode: ErrorCode.ORG_INVALID_MANAGER,
      });
      expect(repo.setManager).not.toHaveBeenCalled();
    });

    it('合法调整：写 manual 来源 + 审计字段 + ou_ 上级句柄', async () => {
      repo.listAll.mockResolvedValue([
        mkRow({ id: 1, userId: 'ou_a', openId: 'ou_a', userName: 'A' }),
        // 上级行是员工 ID 命名空间，但 open_id 是 ou_ → 存 ou_
        mkRow({ id: 2, userId: 'emp_boss', openId: 'ou_boss_open', userName: 'Boss' }),
      ]);
      repo.setManager.mockResolvedValue(undefined);

      const r = await service.setManager('ou_admin', 'admin', 'ou_a', 'emp_boss');

      expect(r).toMatchObject({ user_id: 'ou_a', manager_user_id: 'ou_boss_open', manager_source: 'manual' });
      expect(repo.setManager).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          managerUserId: 'ou_boss_open',
          managerName: 'Boss',
          managerSource: 'manual',
          managerUpdatedBy: 'ou_admin',
        }),
      );
    });

    it('manager_user_id=null → 设为根节点（清空上级）', async () => {
      repo.listAll.mockResolvedValue([mkRow({ id: 1, userId: 'ou_a', managerUserId: 'ou_b' })]);
      repo.setManager.mockResolvedValue(undefined);

      const r = await service.setManager('ou_admin', 'admin', 'ou_a', null);

      expect(r.manager_user_id).toBeNull();
      expect(repo.setManager).toHaveBeenCalledWith(1, expect.objectContaining({ managerUserId: null }));
    });

    it('目标用户可通过 open_id 命中（双命名空间）', async () => {
      repo.listAll.mockResolvedValue([
        mkRow({ id: 1, userId: 'emp_10001', openId: 'ou_alice_open', userName: 'Alice' }),
        mkRow({ id: 2, userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss' }),
      ]);
      repo.setManager.mockResolvedValue(undefined);

      const r = await service.setManager('ou_admin', 'boss', 'ou_alice_open', 'ou_boss');

      expect(r.user_id).toBe('emp_10001');
      expect(repo.setManager).toHaveBeenCalledWith(1, expect.anything());
    });
  });

  describe('resetManagerToFeishu', () => {
    it('翻转来源为 feishu（保留现值），带审计', async () => {
      repo.listAll.mockResolvedValue([
        mkRow({ id: 1, userId: 'ou_a', managerUserId: 'ou_handpicked', managerSource: 'manual' }),
      ]);
      repo.setManagerSource.mockResolvedValue(undefined);

      const r = await service.resetManagerToFeishu('ou_admin', 'pmo', 'ou_a');

      expect(r).toMatchObject({ user_id: 'ou_a', manager_source: 'feishu' });
      expect(repo.setManagerSource).toHaveBeenCalledWith(1, 'feishu', expect.any(Date), 'ou_admin');
    });

    it('非特权角色被拒（1002）', async () => {
      await expect(service.resetManagerToFeishu('ou_emp', 'employee', 'ou_a')).rejects.toBeInstanceOf(
        BusinessException,
      );
    });
  });
});
