import { describe, it, expect, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { UserRole } from '@leader-sync/shared-types';
import { DashboardController } from '../dashboard.controller';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';

function makeUser(role: string): CurrentUserPayload {
  return { user_id: 'ou_test', user_name: 'Test', role, dept_id: 'd1' };
}

function makeController() {
  const service = {
    getBossDashboard: vi.fn().mockResolvedValue({ ok: true }),
    getGanttData: vi.fn().mockResolvedValue({ ok: true }),
    getProjectPortfolio: vi.fn().mockResolvedValue([{ projectUid: 'p1' }]),
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
