import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgService } from './org.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '@leader-sync/shared-types';

// 白名单内的请求者（dev fixture 与生产杨平 open_id，见 org.service ORG_STRUCTURE_ADMINS）
const ADMIN = { userId: 'ou_dev_harvey' };
const YANGPING_BY_OPENID = { userId: 'emp_yangping', openId: 'ou_5a06e17c2ec88a72a2ef4ce040b3d77d' };
// 白名单外（哪怕原来是 boss/admin 角色也不再放行——权限只认白名单）
const OUTSIDER = { userId: 'ou_emp', openId: 'ou_emp' };

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
    it('返回全员节点 + 最近一次飞书同步时间；白名单用户 can_edit=true', async () => {
      const t1 = new Date('2026-07-01T23:00:00Z');
      const t2 = new Date('2026-07-02T23:00:00Z');
      repo.listAll.mockResolvedValue([
        mkRow({ userId: 'ou_a', userName: 'A', managerUserId: 'ou_b', managerName: 'B', managerUpdatedAt: t1 }),
        mkRow({ userId: 'ou_b', userName: 'B', managerUpdatedAt: t2 }),
        mkRow({ userId: 'ou_c', userName: 'C', managerSource: 'manual', managerUpdatedAt: new Date('2026-07-03T00:00:00Z') }),
      ]);

      const r = await service.getTree(ADMIN);

      expect(r.users).toHaveLength(3);
      expect(r.users[0]).toMatchObject({ user_id: 'ou_a', manager_user_id: 'ou_b', manager_source: 'feishu' });
      // manual 行的时间不计入 last_feishu_sync_at
      expect(r.last_feishu_sync_at).toBe(t2.toISOString());
      expect(r.can_edit).toBe(true);
    });

    it('非白名单用户 can_edit=false（树仍可读）', async () => {
      repo.listAll.mockResolvedValue([mkRow({ userId: 'ou_a' })]);
      const r = await service.getTree(OUTSIDER);
      expect(r.users).toHaveLength(1);
      expect(r.can_edit).toBe(false);
    });

    it('白名单可经 open_id 命中（杨平场景）', async () => {
      repo.listAll.mockResolvedValue([]);
      const r = await service.getTree(YANGPING_BY_OPENID);
      expect(r.can_edit).toBe(true);
    });
  });

  describe('getTree 离职/隐藏过滤', () => {
    const rows = [
      { id: 1, userId: 'ou_a', openId: 'ou_a', userName: 'A', managerSource: 'feishu', leftAt: null, hiddenAt: null },
      { id: 2, userId: 'ou_left', openId: 'ou_left', userName: 'Left', managerSource: 'feishu', leftAt: new Date(), hiddenAt: null },
      { id: 3, userId: 'ou_hidden', openId: 'ou_hidden', userName: 'Hidden', managerSource: 'feishu', leftAt: null, hiddenAt: new Date() },
    ];
    const makeService = () => {
      const r = { listAll: vi.fn(async () => rows) } as any;
      return new OrgService(r);
    };
    const admin = { userId: 'ou_dev_harvey', openId: 'ou_dev_harvey' };
    const plain = { userId: 'ou_a', openId: 'ou_a' };

    it('默认只返回在册（滤离职+隐藏）', async () => {
      const svc = makeService();
      const res = await svc.getTree(plain);
      expect(res.users.map((u) => u.user_id)).toEqual(['ou_a']);
      expect(res.hidden_count).toBe(1); // 手动隐藏 1 人（离职不算 hidden_count）
    });

    it('管理员 include_hidden=true 返回全部并带 left_at/hidden_at', async () => {
      const svc = makeService();
      const res = await svc.getTree(admin, true);
      expect(res.users.map((u) => u.user_id).sort()).toEqual(['ou_a', 'ou_hidden', 'ou_left']);
      const hidden = res.users.find((u) => u.user_id === 'ou_hidden');
      expect(hidden!.hidden_at).not.toBeNull();
    });

    it('非管理员传 include_hidden=true 仍只拿在册（防越权）', async () => {
      const svc = makeService();
      const res = await svc.getTree(plain, true);
      expect(res.users.map((u) => u.user_id)).toEqual(['ou_a']);
    });
  });

  describe('setManager', () => {
    it('非白名单被拒（1002），boss/admin 角色不再自动放行', async () => {
      await expect(service.setManager(OUTSIDER, 'ou_a', 'ou_b')).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
      });
      expect(repo.listAll).not.toHaveBeenCalled();
    });

    it('目标用户不存在 → 1016', async () => {
      repo.listAll.mockResolvedValue([mkRow({ userId: 'ou_b' })]);
      await expect(service.setManager(ADMIN, 'ou_ghost', 'ou_b')).rejects.toMatchObject({
        businessCode: ErrorCode.ORG_USER_NOT_FOUND,
      });
    });

    it('新上级不存在 → 1017', async () => {
      repo.listAll.mockResolvedValue([mkRow({ userId: 'ou_a' })]);
      await expect(service.setManager(ADMIN, 'ou_a', 'ou_ghost')).rejects.toMatchObject({
        businessCode: ErrorCode.ORG_INVALID_MANAGER,
      });
    });

    it('自己不能当自己的上级 → 1017', async () => {
      repo.listAll.mockResolvedValue([mkRow({ id: 1, userId: 'ou_a', openId: 'ou_a' })]);
      await expect(service.setManager(ADMIN, 'ou_a', 'ou_a')).rejects.toMatchObject({
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
      await expect(service.setManager(ADMIN, 'ou_a', 'ou_c')).rejects.toMatchObject({
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

      const r = await service.setManager(ADMIN, 'ou_a', 'emp_boss');

      expect(r).toMatchObject({ user_id: 'ou_a', manager_user_id: 'ou_boss_open', manager_source: 'manual' });
      expect(repo.setManager).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          managerUserId: 'ou_boss_open',
          managerName: 'Boss',
          managerSource: 'manual',
          managerUpdatedBy: 'ou_dev_harvey',
        }),
      );
    });

    it('manager_user_id=null → 设为根节点（清空上级）', async () => {
      repo.listAll.mockResolvedValue([mkRow({ id: 1, userId: 'ou_a', managerUserId: 'ou_b' })]);
      repo.setManager.mockResolvedValue(undefined);

      const r = await service.setManager(ADMIN, 'ou_a', null);

      expect(r.manager_user_id).toBeNull();
      expect(repo.setManager).toHaveBeenCalledWith(1, expect.objectContaining({ managerUserId: null }));
    });

    it('目标用户可通过 open_id 命中（双命名空间）；杨平经 open_id 过白名单', async () => {
      repo.listAll.mockResolvedValue([
        mkRow({ id: 1, userId: 'emp_10001', openId: 'ou_alice_open', userName: 'Alice' }),
        mkRow({ id: 2, userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss' }),
      ]);
      repo.setManager.mockResolvedValue(undefined);

      const r = await service.setManager(YANGPING_BY_OPENID, 'ou_alice_open', 'ou_boss');

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

      const r = await service.resetManagerToFeishu(YANGPING_BY_OPENID, 'ou_a');

      expect(r).toMatchObject({ user_id: 'ou_a', manager_source: 'feishu' });
      expect(repo.setManagerSource).toHaveBeenCalledWith(1, 'feishu', expect.any(Date), 'emp_yangping');
    });

    it('非白名单被拒（1002）', async () => {
      await expect(service.resetManagerToFeishu(OUTSIDER, 'ou_a')).rejects.toBeInstanceOf(BusinessException);
    });
  });
});
