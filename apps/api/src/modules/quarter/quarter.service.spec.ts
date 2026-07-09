/**
 * quarter.service.spec.ts — 季度考核核心流 P2 单测（repository 全 mock，无 DB）。
 * 覆盖：开周期权限、串行门控解锁/锁定 403、他人任务不可读、
 *       打分 raw 越界/OCC/goal 上界、stage 流转、管理层 sheet 排除名单、
 *       同事指定权限与连任校验、mgmt_required(leader 不可关)、目标 revision。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { QuarterService } from './quarter.service';
import { QuarterRepository } from './quarter.repository';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';

function createMockRepo(): Record<keyof QuarterRepository, ReturnType<typeof vi.fn>> {
  return {
    findCycleByUid: vi.fn(),
    findCycleByQuarter: vi.fn(),
    listCycles: vi.fn(),
    insertCycle: vi.fn(),
    stageCounts: vi.fn(),
    findTaskByUid: vi.fn(),
    listTasksByCycle: vi.fn(),
    findTasksByRatee: vi.fn(),
    insertTasksIgnoreConflict: vi.fn(),
    updateTask: vi.fn(),
    findSheetByUid: vi.fn(),
    findSheetsByTask: vi.fn(),
    findItemsBySheet: vi.fn(),
    insertSheetsIgnoreConflict: vi.fn(),
    findSheetsByRater: vi.fn(),
    submitSheetAndAdvance: vi.fn(),
    upsertPeerSheet: vi.fn(),
    findPeerAssignment: vi.fn(),
    findPeerHistory: vi.fn(),
    listPeerAssignmentsByCycle: vi.fn(),
    upsertPeerAssignment: vi.fn(),
    findTemplateWithDimensions: vi.fn(),
    findActiveQuarterTemplates: vi.fn(),
    listAllOrgRows: vi.fn(),
    listAllPerfRoles: vi.fn(),
    listManagementRoleRows: vi.fn(),
    findPerfRoleFlags: vi.fn(),
    findOrgByCandidates: vi.fn(),
    listAllDepartments: vi.fn(),
    findMonthlyScores: vi.fn(),
    findIncidentsForRatee: vi.fn(),
    findGoal: vi.fn(),
    findGoalByUid: vi.fn(),
    listGoals: vi.fn(),
    insertGoal: vi.fn(),
    updateGoalWithRevision: vi.fn(),
    setGoalProposal: vi.fn(),
    applyGoalProposal: vi.fn(),
    clearGoalProposal: vi.fn(),
    listGoalRevisions: vi.fn(),
  } as unknown as Record<keyof QuarterRepository, ReturnType<typeof vi.fn>>;
}

// quarterly_employee 模板（4 软项和 55，目标 45）
function employeeTemplate() {
  return {
    template: { templateUid: 'spt_q_emp', code: 'quarterly_employee', goalWeight: 45, gradeBands: [] },
    dimensions: [
      { code: 'expertise', name: '专业', weight: '18', sort: 0, scale: 'one_to_ten', anchors: [] },
      { code: 'initiative', name: '主动担当', weight: '15', sort: 1, scale: 'one_to_ten', anchors: [] },
      { code: 'collaboration', name: '协作', weight: '10', sort: 2, scale: 'one_to_ten', anchors: [] },
      { code: 'learning', name: '学习自省', weight: '12', sort: 3, scale: 'one_to_ten', anchors: [] },
    ],
  };
}
const FULL_ITEMS = [
  { dimension_code: 'expertise', raw: 8 },
  { dimension_code: 'initiative', raw: 8 },
  { dimension_code: 'collaboration', raw: 8 },
  { dimension_code: 'learning', raw: 8 },
];

function makeTask(o: Record<string, unknown> = {}) {
  return {
    taskUid: 'qt_1',
    cycleUid: 'qc_1',
    rateeUserId: 'ou_alice',
    rateeName: 'Alice',
    sheetType: 'employee',
    templateUid: 'spt_q_emp',
    mgmtRequired: false,
    mgmtReason: null,
    enrolled: true,
    skipReason: null,
    stage: 'pending_self',
    selfSkipped: false,
    stageDeadlines: null,
    mgmtTrace: null,
    ...o,
  };
}
function makeSheet(o: Record<string, unknown> = {}) {
  return {
    sheetUid: 'qs_self',
    cycleUid: 'qc_1',
    taskUid: 'qt_1',
    rateeUserId: 'ou_alice',
    raterUserId: 'ou_alice',
    raterName: 'Alice',
    raterRole: 'self',
    status: 'draft',
    softTotal: null,
    goalScore: null,
    version: 1,
    ...o,
  };
}

describe('QuarterService', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: QuarterService;

  const notifier = { notifyPeerAssigned: vi.fn().mockResolvedValue(true) };

  beforeEach(() => {
    repo = createMockRepo();
    service = new QuarterService(repo as unknown as QuarterRepository, notifier as any);
    vi.clearAllMocks();
  });

  // ── 开周期 ────────────────────────────────────────────────────────────────
  describe('openCycle', () => {
    it('普通员工无权开周期 → FORBIDDEN', async () => {
      await expect(
        service.openCycle('2026-Q3', { userId: 'ou_emp', role: UserRole.EMPLOYEE, openId: 'ou_emp' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
      expect(repo.insertCycle).not.toHaveBeenCalled();
    });

    it('admin 开周期：建 cycle + 生成 task/sheet（幂等复用已存在任务的 uid）', async () => {
      repo.findCycleByQuarter.mockResolvedValue(null);
      repo.insertCycle.mockResolvedValue({ cycleUid: 'qc_1', quarter: '2026-Q3', status: 'scoring', openAt: new Date('2026-10-01') });
      repo.listAllOrgRows.mockResolvedValue([
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
        { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null, joinedAt: new Date('2019-01-01'), scoreExempt: true },
      ]);
      repo.listAllPerfRoles.mockResolvedValue([]);
      repo.listPeerAssignmentsByCycle.mockResolvedValue([]);
      repo.findActiveQuarterTemplates.mockResolvedValue({ employeeUid: 'spt_q_emp', leaderUid: 'spt_q_leader' });
      repo.listTasksByCycle.mockResolvedValue([]); // 无已存在任务
      repo.insertTasksIgnoreConflict.mockResolvedValue(1);
      repo.insertSheetsIgnoreConflict.mockResolvedValue(2);

      const res = await service.openCycle('2026-Q3', { userId: 'ou_admin', role: UserRole.ADMIN, openId: 'ou_admin' });

      expect(repo.insertCycle).toHaveBeenCalled();
      // alice 一个任务；boss 被豁免不建
      const taskRows = repo.insertTasksIgnoreConflict.mock.calls[0][0];
      expect(taskRows).toHaveLength(1);
      expect(taskRows[0]).toMatchObject({ rateeUserId: 'ou_alice', sheetType: 'employee', templateUid: 'spt_q_emp', mgmtRequired: false });
      // alice sheets: self + manager（有直属），无 peer（未指定）
      const sheetRows = repo.insertSheetsIgnoreConflict.mock.calls[0][0];
      const roles = sheetRows.map((s: any) => s.raterRole).sort();
      expect(roles).toEqual(['manager', 'self']);
      expect(res.taskCount).toBe(1);
    });
  });

  // ── getSheet 门控与权限 ─────────────────────────────────────────────────
  describe('getSheet', () => {
    it('直属 sheet 在 pending_self 阶段被锁 → 403 + 原因（等待自评）', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterName: 'Boss', raterRole: 'manager' }));
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));

      await expect(
        service.getSheet('qs_mgr', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
    });

    it('普通员工读不了别人的任务/sheet → 403', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' }));
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_peer_manager' }));
      repo.findPerfRoleFlags.mockResolvedValue(null);

      await expect(
        service.getSheet('qs_mgr', { userId: 'ou_stranger', role: UserRole.EMPLOYEE, openId: 'ou_stranger' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
    });

    it('自评人读自己的 self sheet（pending_self）→ 返回模板+items，自评标记 notScored', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet());
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findItemsBySheet.mockResolvedValue([]);

      const res = await service.getSheet('qs_self', { userId: 'ou_alice', role: UserRole.EMPLOYEE, openId: 'ou_alice' });
      expect(res.locked).toBe(false);
      expect(res.template?.dimensions).toHaveLength(4);
      expect(res.raterRole).toBe('self');
      expect(res.notScored).toBe(true); // 自评仅参照、不计分
    });

    it('manager sheet 解锁时带出 context（月度底稿/目标/自评参照/事故）', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' }));
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_peer_manager' }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findItemsBySheet.mockResolvedValue([]);
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_1', quarter: '2026-Q3' });
      repo.findMonthlyScores.mockResolvedValue([{ scoreMonth: '2026-07', totalScore: '88', grade: 'B', challengeNote: null, score: null, status: 'locked' }]);
      repo.findGoal.mockResolvedValue({ content: '拿下印尼站' });
      repo.findSheetsByTask.mockResolvedValue([makeSheet({ status: 'submitted' })]); // self 已提交作参照
      repo.findItemsBySheet.mockResolvedValueOnce([]); // manager 自己 items
      repo.findIncidentsForRatee.mockResolvedValue([]);
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', openId: 'ou_alice' });

      const res = await service.getSheet('qs_mgr', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' });
      expect(res.locked).toBe(false);
      expect(res.context).toBeTruthy();
      expect(res.context!.monthlyBaselines).toHaveLength(1);
      expect(res.context!.goal?.content).toBe('拿下印尼站');
    });
  });

  // ── submitSheet 校验与门控 ───────────────────────────────────────────────
  describe('submitSheet', () => {
    it('非本人提交他人 sheet → FORBIDDEN', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet());
      repo.findTaskByUid.mockResolvedValue(makeTask());
      await expect(
        service.submitSheet('qs_self', { userId: 'ou_intruder', role: UserRole.EMPLOYEE, openId: 'ou_intruder' }, { items: FULL_ITEMS, version: 1 }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED });
      expect(repo.submitSheetAndAdvance).not.toHaveBeenCalled();
    });

    it('锁定的 manager sheet（自评未完成）提交 → 403 + 原因', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' }));
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));
      await expect(
        service.submitSheet('qs_mgr', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { items: FULL_ITEMS, goal_score: 40, version: 1 }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
      expect(repo.submitSheetAndAdvance).not.toHaveBeenCalled();
    });

    it('raw 越界（0）→ INVALID_PARAMS，不写库', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet());
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findSheetsByTask.mockResolvedValue([makeSheet()]);
      await expect(
        service.submitSheet('qs_self', { userId: 'ou_alice', role: UserRole.EMPLOYEE, openId: 'ou_alice' }, {
          items: [{ dimension_code: 'expertise', raw: 0 }, { dimension_code: 'initiative', raw: 8 }, { dimension_code: 'collaboration', raw: 8 }, { dimension_code: 'learning', raw: 8 }],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
      expect(repo.submitSheetAndAdvance).not.toHaveBeenCalled();
    });

    it('维度缺失 → INVALID_PARAMS', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet());
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findSheetsByTask.mockResolvedValue([makeSheet()]);
      await expect(
        service.submitSheet('qs_self', { userId: 'ou_alice', role: UserRole.EMPLOYEE, openId: 'ou_alice' }, {
          items: [{ dimension_code: 'expertise', raw: 8 }],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('自评提交 → soft_total 计算、stage 推进到 pending_peer_manager', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet());
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findSheetsByTask.mockResolvedValue([
        makeSheet(), // self（本次提交）
        makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager', status: 'draft' }),
        makeSheet({ sheetUid: 'qs_peer', raterUserId: 'ou_bob', raterRole: 'peer', status: 'draft' }),
      ]);
      repo.submitSheetAndAdvance.mockResolvedValue(makeSheet({ status: 'submitted', version: 2 }));

      await service.submitSheet('qs_self', { userId: 'ou_alice', role: UserRole.EMPLOYEE, openId: 'ou_alice' }, { items: FULL_ITEMS, version: 1 });

      const args = repo.submitSheetAndAdvance.mock.calls[0][0];
      expect(args.newStage).toBe('pending_peer_manager');
      // 8/10×(18+15+10+12)=0.8×55=44
      expect(args.sheetValues.softTotal).toBe('44.00');
      expect(args.mgmtSheetRows ?? []).toHaveLength(0);
    });

    it('manager 提交(mgmt_required=false) 且同事已提交 → scored；goal_score 记录', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' }));
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_peer_manager', mgmtRequired: false }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findSheetsByTask.mockResolvedValue([
        makeSheet({ status: 'submitted' }), // self
        makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager', status: 'draft' }),
        makeSheet({ sheetUid: 'qs_peer', raterUserId: 'ou_bob', raterRole: 'peer', status: 'submitted' }),
      ]);
      repo.submitSheetAndAdvance.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', status: 'submitted', version: 2 }));

      await service.submitSheet('qs_mgr', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { items: FULL_ITEMS, goal_score: 40, version: 1 });

      const args = repo.submitSheetAndAdvance.mock.calls[0][0];
      expect(args.newStage).toBe('scored');
      expect(args.sheetValues.goalScore).toBe('40.00');
    });

    it('manager goal_score 超过模板上界(>45) → INVALID_PARAMS', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' }));
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_peer_manager' }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findSheetsByTask.mockResolvedValue([makeSheet({ status: 'submitted' }), makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' })]);
      await expect(
        service.submitSheet('qs_mgr', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { items: FULL_ITEMS, goal_score: 46, version: 1 }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('manager 提交(mgmt_required=true) → stage=pending_mgmt 且建管理层 sheet（排除名单生效）', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' }));
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_peer_manager', mgmtRequired: true, sheetType: 'leader', templateUid: 'spt_q_leader' }));
      repo.findTemplateWithDimensions.mockResolvedValue({
        template: { templateUid: 'spt_q_leader', code: 'quarterly_leader', goalWeight: 40, gradeBands: [] },
        dimensions: employeeTemplate().dimensions,
      });
      repo.findSheetsByTask.mockResolvedValue([
        makeSheet({ status: 'submitted' }),
        makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager', status: 'draft' }),
      ]); // 无 management sheet 存在
      // 排除数据：一级部门 leader = ou_cto，直属 = ou_boss；管理层 = cto/ceo/pm
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', openId: 'ou_alice', managerUserId: 'ou_boss', deptId: 'd_be' });
      repo.listAllDepartments.mockResolvedValue([
        { deptId: 'd_root', parentDeptId: '0', leaderUserId: 'ou_ceo', level: 0 },
        { deptId: 'd_tech', parentDeptId: 'd_root', leaderUserId: 'ou_cto', level: 1 },
        { deptId: 'd_be', parentDeptId: 'd_tech', leaderUserId: 'ou_belead', level: 2 },
      ]);
      repo.listManagementRoleRows.mockResolvedValue([
        { userId: 'ou_cto', openId: 'ou_cto' },
        { userId: 'ou_ceo', openId: 'ou_ceo' },
        { userId: 'ou_pm', openId: 'ou_pm' },
      ]);
      repo.listAllOrgRows.mockResolvedValue([
        { userId: 'ou_cto', openId: 'ou_cto', userName: 'CTO', managerUserId: 'ou_ceo', deptId: 'd_tech' },
        { userId: 'ou_ceo', openId: 'ou_ceo', userName: 'CEO', managerUserId: null, deptId: 'd_root' },
        { userId: 'ou_pm', openId: 'ou_pm', userName: 'PM', managerUserId: 'ou_ceo', deptId: 'd_pm' },
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', deptId: 'd_be' },
      ]);
      repo.submitSheetAndAdvance.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', status: 'submitted', version: 2 }));

      await service.submitSheet('qs_mgr', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { items: FULL_ITEMS, goal_score: 38, version: 1 });

      const args = repo.submitSheetAndAdvance.mock.calls[0][0];
      expect(args.newStage).toBe('pending_mgmt');
      // 一级部门 = d_tech，leader ou_cto 排除；ceo/pm 入选
      const mgmtRaters = (args.mgmtSheetRows ?? []).map((s: any) => s.raterUserId).sort();
      expect(mgmtRaters).toEqual(['ou_ceo', 'ou_pm']);
      expect(args.mgmtTrace.rule).toBe('first_level_dept');
      expect(args.mgmtTrace.excludedIds).toContain('ou_cto');
    });

    it('硬化2：manager 提交(mgmt_required) 但管理层评分人全排除 → 直接 scored + 留痕 all_excluded_fallback（不建 sheet、不进 pending_mgmt）', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager' }));
      // leader 任务，无同事；stage 已在 pending_peer_manager（自评已完成）
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_peer_manager', mgmtRequired: true, sheetType: 'leader', templateUid: 'spt_q_leader' }));
      repo.findTemplateWithDimensions.mockResolvedValue({
        template: { templateUid: 'spt_q_leader', code: 'quarterly_leader', goalWeight: 40, gradeBands: [] },
        dimensions: employeeTemplate().dimensions,
      });
      repo.findSheetsByTask.mockResolvedValue([
        makeSheet({ status: 'submitted' }), // self
        makeSheet({ sheetUid: 'qs_mgr', raterUserId: 'ou_boss', raterRole: 'manager', status: 'draft' }),
      ]); // 无 peer、无 management
      // 被评人一级部门 leader = ou_cto，直属 = ou_boss；管理层名单里唯一成员就是 ou_cto → 全排除
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', openId: 'ou_alice', managerUserId: 'ou_boss', deptId: 'd_be' });
      repo.listAllDepartments.mockResolvedValue([
        { deptId: 'd_root', parentDeptId: '0', leaderUserId: 'ou_ceo', level: 0 },
        { deptId: 'd_tech', parentDeptId: 'd_root', leaderUserId: 'ou_cto', level: 1 },
        { deptId: 'd_be', parentDeptId: 'd_tech', leaderUserId: 'ou_belead', level: 2 },
      ]);
      repo.listManagementRoleRows.mockResolvedValue([{ userId: 'ou_cto', openId: 'ou_cto' }]);
      repo.listAllOrgRows.mockResolvedValue([
        { userId: 'ou_cto', openId: 'ou_cto', userName: 'CTO', managerUserId: 'ou_ceo', deptId: 'd_tech' },
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', deptId: 'd_be' },
      ]);
      repo.submitSheetAndAdvance.mockResolvedValue(makeSheet({ sheetUid: 'qs_mgr', status: 'submitted', version: 2 }));

      await service.submitSheet('qs_mgr', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { items: FULL_ITEMS, goal_score: 38, version: 1 });

      const args = repo.submitSheetAndAdvance.mock.calls[0][0];
      expect(args.newStage).toBe('scored');
      expect(args.mgmtSheetRows ?? []).toHaveLength(0);
      expect(args.mgmtTrace.rule).toBe('all_excluded_fallback');
      expect(args.mgmtTrace.raterIds).toEqual([]);
      expect(args.mgmtTrace.excludedIds).toContain('ou_cto');
    });

    it('OCC 冲突（submitSheetAndAdvance 返回 null）→ VERSION_CONFLICT', async () => {
      repo.findSheetByUid.mockResolvedValue(makeSheet());
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));
      repo.findTemplateWithDimensions.mockResolvedValue(employeeTemplate());
      repo.findSheetsByTask.mockResolvedValue([makeSheet()]);
      repo.submitSheetAndAdvance.mockResolvedValue(null);
      await expect(
        service.submitSheet('qs_self', { userId: 'ou_alice', role: UserRole.EMPLOYEE, openId: 'ou_alice' }, { items: FULL_ITEMS, version: 3 }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.VERSION_CONFLICT });
    });
  });

  // ── assignPeer 权限 + 连任 ───────────────────────────────────────────────
  describe('assignPeer', () => {
    it('非直属、非 admin/hr → FORBIDDEN', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask());
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      await expect(
        service.assignPeer('qt_1', { userId: 'ou_other', role: UserRole.LEADER, openId: 'ou_other' }, { peer_user_id: 'ou_bob' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
    });

    it('直属指定同事：校验通过 → upsert 指定 + peer sheet', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask());
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_1', quarter: '2026-Q3' });
      repo.findPeerHistory.mockResolvedValue([]);
      repo.findSheetsByTask.mockResolvedValue([]);
      repo.findPerfRoleFlags.mockResolvedValue(null);
      repo.upsertPeerAssignment.mockResolvedValue({ assignUid: 'pa_1', peerUserId: 'ou_bob' });
      repo.upsertPeerSheet.mockResolvedValue(makeSheet({ raterRole: 'peer' }));

      await service.assignPeer('qt_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { peer_user_id: 'ou_bob' });
      expect(repo.upsertPeerAssignment).toHaveBeenCalled();
      expect(repo.upsertPeerSheet).toHaveBeenCalled();
    });

    it('peer 不能是被评人本人 → INVALID_PARAMS', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask());
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      await expect(
        service.assignPeer('qt_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { peer_user_id: 'ou_alice' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('连任超限（同一 peer 连续两季）→ INVALID_PARAMS', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask());
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_1', quarter: '2026-Q3' });
      repo.findPeerHistory.mockResolvedValue([
        { quarter: '2026-Q1', peerId: 'ou_bob' },
        { quarter: '2026-Q2', peerId: 'ou_bob' },
      ]);
      repo.findSheetsByTask.mockResolvedValue([]);
      await expect(
        service.assignPeer('qt_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { peer_user_id: 'ou_bob' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('已提交的 peer sheet 不许换人 → INVALID_PARAMS', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask());
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_1', quarter: '2026-Q3' });
      repo.findPeerHistory.mockResolvedValue([]);
      repo.findSheetsByTask.mockResolvedValue([makeSheet({ raterRole: 'peer', status: 'submitted', raterUserId: 'ou_old' })]);
      await expect(
        service.assignPeer('qt_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { peer_user_id: 'ou_bob' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });
  });

  // ── mgmt_required ─────────────────────────────────────────────────────────
  describe('setMgmtRequired', () => {
    it('leader 任务恒 true，不许关 → INVALID_PARAMS', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask({ sheetType: 'leader', mgmtRequired: true }));
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      await expect(
        service.setMgmtRequired('qt_1', { userId: 'ou_admin', role: UserRole.ADMIN, openId: 'ou_admin' }, { required: false }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('开启但无理由 → INVALID_PARAMS', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask());
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      await expect(
        service.setMgmtRequired('qt_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { required: true }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('直属开启（带理由）→ 更新任务', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_self' }));
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      repo.updateTask.mockResolvedValue(makeTask({ mgmtRequired: true, mgmtReason: '晋级申请' }));
      await service.setMgmtRequired('qt_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { required: true, reason: '晋级申请' });
      expect(repo.updateTask).toHaveBeenCalledWith('qt_1', expect.objectContaining({ mgmtRequired: true, mgmtReason: '晋级申请' }));
    });

    it('stage 已过 pending_peer_manager 后不许改 → INVALID_PARAMS', async () => {
      repo.findTaskByUid.mockResolvedValue(makeTask({ stage: 'pending_mgmt' }));
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      await expect(
        service.setMgmtRequired('qt_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { required: true, reason: 'x' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });
  });

  // ── 目标 ────────────────────────────────────────────────────────────────
  describe('goals', () => {
    it('改目标写 revision（记录 before/after/reason）', async () => {
      repo.findGoalByUid.mockResolvedValue({ goalUid: 'qg_1', rateeUserId: 'ou_alice', half: '2026-H2', content: '旧目标' });
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      repo.updateGoalWithRevision.mockResolvedValue({ goalUid: 'qg_1', content: '新目标' });
      await service.updateGoal('qg_1', { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' }, { content: '新目标', reason: '战略调整' });
      const [, newContent, revision] = repo.updateGoalWithRevision.mock.calls[0];
      expect(newContent).toBe('新目标');
      expect(revision).toMatchObject({ before: '旧目标', after: '新目标', reason: '战略调整' });
    });

    it('非直属、非 admin 改目标 → FORBIDDEN', async () => {
      repo.findGoalByUid.mockResolvedValue({ goalUid: 'qg_1', rateeUserId: 'ou_alice', half: '2026-H2', content: '旧' });
      repo.findOrgByCandidates.mockResolvedValue({ userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' });
      await expect(
        service.updateGoal('qg_1', { userId: 'ou_other', role: UserRole.LEADER, openId: 'ou_other' }, { content: 'x' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED });
    });
  });

  // ── 目标提案流（员工发起 → 直属确认留痕）─────────────────────────────────────
  describe('目标提案流', () => {
    const goal = { goalUid: 'qg_1', rateeUserId: 'ou_alice', half: '2026-H2', content: '旧目标', proposedAt: null, proposedContent: null, proposedBy: null };
    const aliceOrg = { userId: 'ou_alice', managerUserId: 'ou_boss', openId: 'ou_alice' };
    const alice = { userId: 'ou_alice', role: UserRole.EMPLOYEE, openId: 'ou_alice' };
    const boss = { userId: 'ou_boss', role: UserRole.LEADER, openId: 'ou_boss' };

    it('员工本人发起调整建议 → 写 pending 提案（不直接改正式内容）', async () => {
      repo.findGoalByUid.mockResolvedValue({ ...goal });
      repo.findOrgByCandidates.mockResolvedValue(aliceOrg);
      repo.setGoalProposal.mockResolvedValue({ ...goal, proposedContent: '新目标建议', proposedBy: 'ou_alice' });
      await service.proposeGoalChange('qg_1', alice, { content: '新目标建议' });
      const [, values] = repo.setGoalProposal.mock.calls[0];
      expect(values).toMatchObject({ proposedContent: '新目标建议', proposedBy: 'ou_alice' });
      // 未走 applyGoalProposal（不直接改正式内容）
      expect(repo.applyGoalProposal).not.toHaveBeenCalled();
    });

    it('已有待确认提案时再次发起 → INVALID_PARAMS', async () => {
      repo.findGoalByUid.mockResolvedValue({ ...goal, proposedAt: new Date(), proposedContent: '前一个建议' });
      repo.findOrgByCandidates.mockResolvedValue(aliceOrg);
      await expect(
        service.proposeGoalChange('qg_1', alice, { content: '又一个建议' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('直属确认接受 → 应用为正式内容 + 写 revision（before/after/revisedBy）', async () => {
      repo.findGoalByUid.mockResolvedValue({ ...goal, proposedAt: new Date(), proposedContent: '新目标建议', proposedBy: 'ou_alice' });
      repo.findOrgByCandidates.mockResolvedValue(aliceOrg);
      repo.applyGoalProposal.mockResolvedValue({ ...goal, content: '新目标建议' });
      await service.confirmGoalProposal('qg_1', boss, { accept: true, reason: '合理' });
      const [, newContent, revision] = repo.applyGoalProposal.mock.calls[0];
      expect(newContent).toBe('新目标建议');
      expect(revision).toMatchObject({ before: '旧目标', after: '新目标建议', revisedBy: 'ou_boss' });
      expect(repo.clearGoalProposal).not.toHaveBeenCalled();
    });

    it('直属确认驳回 → 关提案 + 留痕（不改正式内容）', async () => {
      repo.findGoalByUid.mockResolvedValue({ ...goal, proposedAt: new Date(), proposedContent: '新目标建议', proposedBy: 'ou_alice' });
      repo.findOrgByCandidates.mockResolvedValue(aliceOrg);
      repo.clearGoalProposal.mockResolvedValue({ ...goal });
      await service.confirmGoalProposal('qg_1', boss, { accept: false, reason: '暂不调整' });
      expect(repo.clearGoalProposal).toHaveBeenCalled();
      const [, revision] = repo.clearGoalProposal.mock.calls[0];
      expect(revision.reason).toContain('暂不调整');
      expect(repo.applyGoalProposal).not.toHaveBeenCalled();
    });

    it('无待确认提案时确认 → INVALID_PARAMS', async () => {
      repo.findGoalByUid.mockResolvedValue({ ...goal });
      repo.findOrgByCandidates.mockResolvedValue(aliceOrg);
      await expect(
        service.confirmGoalProposal('qg_1', boss, { accept: true }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('非直属确认 → FORBIDDEN', async () => {
      repo.findGoalByUid.mockResolvedValue({ ...goal, proposedAt: new Date(), proposedContent: 'x' });
      repo.findOrgByCandidates.mockResolvedValue(aliceOrg);
      await expect(
        service.confirmGoalProposal('qg_1', { userId: 'ou_other', role: UserRole.LEADER, openId: 'ou_other' }, { accept: true }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED });
    });
  });
});
