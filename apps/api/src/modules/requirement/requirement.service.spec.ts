import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { RequirementService, type Requester } from './requirement.service';
import { RequirementRepository } from './requirement.repository';
import { BusinessException } from '../../common/exceptions/business.exception';
import { RequirementStatus } from '@leader-sync/shared-types';

function mockRepo(): Record<keyof RequirementRepository, ReturnType<typeof vi.fn>> {
  return {
    insert: vi.fn((v) => Promise.resolve({ requirementUid: 'r', ...v })),
    findByUid: vi.fn(),
    update: vi.fn((uid, v) => Promise.resolve({ requirementUid: uid, ...v })),
    list: vi.fn().mockResolvedValue([]),
    findArtifacts: vi.fn().mockResolvedValue([]),
    insertArtifact: vi.fn(),
    findTasksByRequirement: vi.fn().mockResolvedValue([]),
    linkTasks: vi.fn().mockResolvedValue(2),
    findOrgUser: vi.fn().mockResolvedValue(null),
    findLinkableTasks: vi.fn().mockResolvedValue([]),
    taskSpansByRequirement: vi.fn().mockResolvedValue(new Map()),
    capacityTasks: vi.fn().mockResolvedValue([]),
    findProjects: vi.fn().mockResolvedValue([]),
    findOrgUsersByIds: vi.fn().mockResolvedValue([]),
  } as any;
}
function mockFeishu() {
  return { notifyP0Impact: vi.fn().mockResolvedValue(0), sendTextToUser: vi.fn().mockResolvedValue(true) };
}
const PM: Requester = { userIds: ['ou_pm'], userName: 'PM', role: 'pmo' };
const EMP: Requester = { userIds: ['ou_emp'], userName: '员工', role: 'employee' };

describe('RequirementService', () => {
  let svc: RequirementService;
  let repo: ReturnType<typeof mockRepo>;
  let feishu: ReturnType<typeof mockFeishu>;
  beforeEach(() => { repo = mockRepo(); feishu = mockFeishu(); svc = new RequirementService(repo as any, feishu as any); });

  describe('create', () => {
    it('默认 collected + reporter', async () => {
      repo.insert.mockResolvedValue({ requirementUid: 'req_1' });
      await svc.create({ userId: 'ou_emp', userName: '员工' }, { title: 'X', business_line_uid: 'bl', priority: 'P2' } as any);
      const arg = repo.insert.mock.calls[0][0];
      expect(arg.status).toBe(RequirementStatus.COLLECTED);
      expect(arg.reporterUserId).toBe('ou_emp');
      expect(arg.priority).toBe('P2');
    });
    it('P0 缺期望上线 → 报错', async () => {
      await expect(svc.create({ userId: 'u', userName: 'u' }, { title: 'X', business_line_uid: 'bl', priority: 'P0' } as any))
        .rejects.toBeInstanceOf(BusinessException);
    });
  });

  describe('R3 P0 飞书下发', () => {
    it('新提 P0（含期望上线）→ 触发影响下发', async () => {
      await svc.create({ userId: 'ou_emp', userName: '员工' },
        { title: 'X', business_line_uid: 'bl', priority: 'P0', expected_release_date: '2026-07-15' } as any);
      await vi.waitFor(() => expect(feishu.notifyP0Impact).toHaveBeenCalled());
      expect(feishu.notifyP0Impact.mock.calls[0][1].kind).toBe('create');
    });
    it('非 P0 不下发', async () => {
      await svc.create({ userId: 'ou_emp', userName: '员工' },
        { title: 'X', business_line_uid: 'bl', priority: 'P2' } as any);
      await new Promise((r) => setTimeout(r, 20));
      expect(feishu.notifyP0Impact).not.toHaveBeenCalled();
    });
    it('变更升级为 P0（含期望上线）→ 触发变更下发', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'collected', version: 1, priority: 'P2', pmUserId: 'ou_pm', businessLineUid: 'bl', appProjectUid: null, expectedReleaseDate: null });
      await svc.update('r', PM, { priority: 'P0', expected_release_date: '2026-07-15' } as any);
      await vi.waitFor(() => expect(feishu.notifyP0Impact).toHaveBeenCalled());
      expect(feishu.notifyP0Impact.mock.calls[0][1].kind).toBe('change');
    });
  });

  describe('状态流转', () => {
    it('合法前进：analyzing → req_review（PM）', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'analyzing', version: 1, pmUserId: 'ou_pm' });
      await svc.update('r', PM, { status: 'req_review' } as any);
      expect(repo.update.mock.calls[0][1].status).toBe('req_review');
    });
    it('合法回退：req_review → analyzing（PM）', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'req_review', version: 1, pmUserId: 'ou_pm' });
      await svc.update('r', PM, { status: 'analyzing' } as any);
      expect(repo.update.mock.calls[0][1].status).toBe('analyzing');
    });
    it('任意态 → rejected 允许', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'developing', version: 1, pmUserId: 'ou_pm' });
      await svc.update('r', PM, { status: 'rejected' } as any);
      expect(repo.update.mock.calls[0][1].status).toBe('rejected');
    });
    it('非法跳转：collected → developing → 400', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'collected', version: 1, pmUserId: 'ou_pm' });
      await expect(svc.update('r', PM, { status: 'developing' } as any))
        .rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
    it('提出人无权流转 → 403', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'analyzing', version: 1, pmUserId: 'ou_pm', reporterUserId: 'ou_emp' });
      await expect(svc.update('r', EMP, { status: 'req_review' } as any))
        .rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  });

  describe('claim', () => {
    it('PM 认领：设承接人 + collected→analyzing', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'collected', version: 1 });
      await svc.claim('r', PM);
      const v = repo.update.mock.calls[0][1];
      expect(v.pmUserId).toBe('ou_pm');
      expect(v.status).toBe('analyzing');
    });
    it('非 PM 角色不能认领 → 403', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', status: 'collected', version: 1 });
      await expect(svc.claim('r', EMP)).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  });

  describe('linkTasks', () => {
    it('PM 挂候选任务 → 项目归属随需求（app 优先），不回写需求级工时', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', pmUserId: 'ou_pm', businessLineUid: 'bl', appProjectUid: 'app1' });
      repo.findLinkableTasks.mockResolvedValue([{ taskUid: 't1' }, { taskUid: 't2' }]);
      const res = await svc.linkTasks('r', PM, { task_uids: ['t1', 't2'], est_effort_days: 3 } as any);
      // 末位 projectUid = appProjectUid('app1')；任务随需求项目
      expect(repo.linkTasks).toHaveBeenCalledWith('r', ['t1', 't2'], 3, undefined, 'app1');
      expect(res).toEqual({ linked: 2 });
      expect(repo.update).not.toHaveBeenCalled();
    });
    it('需求只挂业务线时，任务项目归属落到业务线', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', pmUserId: 'ou_pm', businessLineUid: 'bl', appProjectUid: null });
      repo.findLinkableTasks.mockResolvedValue([{ taskUid: 't1' }]);
      await svc.linkTasks('r', PM, { task_uids: ['t1'] } as any);
      expect(repo.linkTasks).toHaveBeenCalledWith('r', ['t1'], undefined, undefined, 'bl');
    });
    it('挂载范围外的任务 → 400（防越权重挂别的线/已删任务）', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', pmUserId: 'ou_pm', businessLineUid: 'bl', appProjectUid: null });
      repo.findLinkableTasks.mockResolvedValue([{ taskUid: 't1' }]); // t2 不在候选集
      await expect(svc.linkTasks('r', PM, { task_uids: ['t1', 't2'] } as any))
        .rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(repo.linkTasks).not.toHaveBeenCalled();
    });
  });

  describe('行级安全 / 角色门禁', () => {
    it('list：非特权角色注入 viewerUserIds', async () => {
      await svc.list(EMP, {});
      expect(repo.list.mock.calls[0][0].viewerUserIds).toEqual(['ou_emp']);
    });
    it('list：PM/特权不注入 viewerUserIds（看全部）', async () => {
      await svc.list(PM, {});
      expect(repo.list.mock.calls[0][0].viewerUserIds).toBeUndefined();
    });
    it('getOne：提出人可看自己的', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', reporterUserId: 'ou_emp', pmUserId: null });
      await expect(svc.getOne('r', EMP)).resolves.toMatchObject({ requirementUid: 'r' });
    });
    it('getOne：非提出人/非承接的普通用户 → 403', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', reporterUserId: 'ou_other', pmUserId: 'ou_pmx' });
      await expect(svc.getOne('r', EMP)).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
    it('getOne：PM 可看任意', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', reporterUserId: 'ou_other', pmUserId: null });
      await expect(svc.getOne('r', PM)).resolves.toMatchObject({ requirementUid: 'r' });
    });
    it('candidateTasks：非 PM → 403', async () => {
      repo.findByUid.mockResolvedValue({ requirementUid: 'r', businessLineUid: 'bl', appProjectUid: null, pmUserId: null });
      await expect(svc.candidateTasks('r', EMP)).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
    it('capacity：非 PM → 403', async () => {
      await expect(svc.capacity(EMP)).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
    it('capacity：PM 可查看', async () => {
      await expect(svc.capacity(PM)).resolves.toEqual([]);
    });
  });

  describe('impact 窗口钳制（过去期望上线日不误报无影响）', () => {
    it('过去日期 → windowEnd 钳到至少当天，仍计算负载', async () => {
      const tasks = [{
        taskUid: 't', title: 'x', assigneeUserId: 'ou_a', assigneeName: 'A',
        startAt: new Date(Date.now() - 5 * 86400000), dueAt: new Date(Date.now() + 5 * 86400000),
        allocationPct: 120, estEffortDays: '3', requirementUid: null, status: 'in_progress', projectUid: 'bl',
      }];
      repo.capacityTasks.mockResolvedValue(tasks);
      repo.findProjects.mockResolvedValue([]);
      const res = await svc.impactPreview({ business_line_uid: 'bl', expected_release_date: '2020-01-01' } as any);
      expect(res.summary.peopleCount).toBe(1);
      expect(res.affectedPeople[0].peakLoadPct).toBe(120); // 循环执行了（未因过去日期跳过）
    });
  });
});
