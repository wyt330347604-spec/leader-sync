import { describe, it, expect, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { UserRole } from '@leader-sync/shared-types';
import { DashboardController } from '../dashboard.controller';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';

function makeUser(role: string, overrides: Partial<CurrentUserPayload> = {}): CurrentUserPayload {
  return { user_id: 'emp_test', open_id: 'ou_test', user_name: 'Test', role, dept_id: 'd1', ...overrides };
}

function makeController() {
  const service = {
    getBossDashboard: vi.fn().mockResolvedValue({ ok: true }),
    getGanttData: vi.fn().mockResolvedValue({ ok: true }),
    getProjectPortfolio: vi.fn().mockResolvedValue([{ projectUid: 'p1' }]),
    getLeaderMonthly: vi.fn().mockResolvedValue({ ok: true }),
    getLeaderMemberTasks: vi.fn().mockResolvedValue({ ok: true }),
    getLeaderWeekly: vi.fn().mockResolvedValue({ ok: true }),
  };
  return { controller: new DashboardController(service as any), service };
}

const COMPANY_ROLES = [UserRole.BOSS, UserRole.PMO, UserRole.ADMIN];
const DENIED_ROLES = [UserRole.EMPLOYEE, UserRole.LEADER];

describe('DashboardController 全员概览权限', () => {
  describe('GET /dashboard/boss', () => {
    for (const role of COMPANY_ROLES) {
      it(`放行：${role} 可查看全员概览`, async () => {
        const { controller, service } = makeController();
        await expect(controller.bossDashboard(makeUser(role), '2026-06')).resolves.toEqual({ ok: true });
        expect(service.getBossDashboard).toHaveBeenCalledOnce();
      });
    }

    for (const role of DENIED_ROLES) {
      it(`拒绝：${role} 无权限 → 抛 1002 / 403，且不触达 service`, async () => {
        const { controller, service } = makeController();
        await expect(controller.bossDashboard(makeUser(role), '2026-06')).rejects.toMatchObject({
          businessCode: 1002,
          status: HttpStatus.FORBIDDEN,
        });
        expect(service.getBossDashboard).not.toHaveBeenCalled();
      });
    }
  });

  describe('GET /dashboard/projects（项目组合）', () => {
    it('放行：boss 可看项目组合', async () => {
      const { controller, service } = makeController();
      await expect(controller.projectPortfolio(makeUser(UserRole.BOSS))).resolves.toEqual([{ projectUid: 'p1' }]);
      expect(service.getProjectPortfolio).toHaveBeenCalledOnce();
    });

    it('拒绝：employee → 1002 / 403，且不触达 service', async () => {
      const { controller, service } = makeController();
      await expect(controller.projectPortfolio(makeUser(UserRole.EMPLOYEE))).rejects.toMatchObject({
        businessCode: 1002,
        status: HttpStatus.FORBIDDEN,
      });
      expect(service.getProjectPortfolio).not.toHaveBeenCalled();
    });
  });

  describe('GET /dashboard/gantt', () => {
    it('放行：boss 可查看甘特图', async () => {
      const { controller, service } = makeController();
      await expect(controller.ganttData(makeUser(UserRole.BOSS), '2026-06')).resolves.toEqual({ ok: true });
      expect(service.getGanttData).toHaveBeenCalledOnce();
    });

    it('拒绝：employee 无权限 → 抛 1002 / 403，且不触达 service', async () => {
      const { controller, service } = makeController();
      await expect(controller.ganttData(makeUser(UserRole.EMPLOYEE), '2026-06')).rejects.toMatchObject({
        businessCode: 1002,
        status: HttpStatus.FORBIDDEN,
      });
      expect(service.getGanttData).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Leader 端点必须把登录者的 open_id 透传给 service。
// 任务行上的 leaderUserId 存在两套命名空间（员工 user_id / 飞书 ou_ open_id），
// service 靠 open_id 兜底匹配；控制器漏传 open_id 会让匹配退化成仅 user_id，
// 导致「领导看不到下属数据」。这三条是防止该回归的守卫。
// ---------------------------------------------------------------------------
describe('DashboardController Leader 端点透传 open_id（双命名空间）', () => {
  it('leaderMonthly 把 user.open_id 作为第 4 个参数传给 getLeaderMonthly', async () => {
    const { controller, service } = makeController();
    const user = makeUser(UserRole.LEADER, { user_id: 'emp_harvey', open_id: 'ou_harvey' });

    await controller.leaderMonthly(user, '2026-05');

    expect(service.getLeaderMonthly).toHaveBeenCalledWith('emp_harvey', 'Test', '2026-05', 'ou_harvey');
  });

  it('leaderMemberTasks 把 user.open_id 作为末位参数传给 getLeaderMemberTasks', async () => {
    const { controller, service } = makeController();
    const user = makeUser(UserRole.LEADER, { user_id: 'emp_harvey', open_id: 'ou_harvey' });

    await controller.leaderMemberTasks(user, 'emp_alice', '2026-05');

    expect(service.getLeaderMemberTasks).toHaveBeenCalledWith('emp_harvey', 'emp_alice', '2026-05', 'ou_harvey');
  });

  it('leaderWeekly 把 user.open_id 作为第 3 个参数传给 getLeaderWeekly', async () => {
    const { controller, service } = makeController();
    const user = makeUser(UserRole.LEADER, { user_id: 'emp_harvey', open_id: 'ou_harvey' });

    await controller.leaderWeekly(user);

    expect(service.getLeaderWeekly).toHaveBeenCalledWith('emp_harvey', 'Test', 'ou_harvey');
  });
});
