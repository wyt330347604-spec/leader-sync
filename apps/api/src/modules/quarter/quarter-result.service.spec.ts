/**
 * quarter-result.service.spec.ts — 季度评分会 + 合成/公示/申诉 P3 单测（repo 全 mock，无 DB）。
 * 覆盖：compute（三方合成 55/35/10、90/10 回退、mgmtAverage 排除、红线）、非 scored/已公示不合成、
 *       panel 权限、改分重算 total/grade + revision 留痕、published 后禁改、
 *       公示（+3 工作日 + 只公示 draft）、my-result 未公示 403、
 *       申诉本人/公示/过期/去重、hr 处理、列表权限。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { QuarterResultService } from './quarter-result.service';
import { QuarterRepository } from './quarter.repository';
import { QuarterResultRepository } from './quarter-result.repository';
import { QuarterNotifierService } from './quarter-notifier.service';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';

function baseRepo() {
  return {
    findPerfRoleFlags: vi.fn().mockResolvedValue(null),
    findTaskByUid: vi.fn(),
    findCycleByUid: vi.fn(),
    findCycleByQuarter: vi.fn().mockResolvedValue(null),
    listTasksByCycle: vi.fn(),
    findSheetsByTask: vi.fn(),
    findOrgByCandidates: vi.fn().mockResolvedValue(null),
    listMonthlyScoresByMonth: vi.fn().mockResolvedValue([]),
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

function baseResultRepo() {
  return {
    findResultByUid: vi.fn(),
    findResultByTask: vi.fn().mockResolvedValue(null),
    listResultsByCycle: vi.fn().mockResolvedValue([]),
    findResultByCycleAndRatee: vi.fn(),
    upsertResult: vi.fn(),
    updateResultWithRevision: vi.fn(),
    listRevisionsByResult: vi.fn().mockResolvedValue([]),
    publishDraftResults: vi.fn(),
    updateCycleStatus: vi.fn(),
    managerAveragesByCycle: vi.fn().mockResolvedValue([]),
    insertAppeal: vi.fn(),
    findAppealByUid: vi.fn(),
    findOpenAppealByResult: vi.fn().mockResolvedValue(null),
    listAppealsByResult: vi.fn().mockResolvedValue([]),
    updateAppeal: vi.fn(),
    listAppealsByCycle: vi.fn().mockResolvedValue([]),
    resolveOpenId: vi.fn().mockResolvedValue('ou_ratee'),
    listHrOpenIds: vi.fn().mockResolvedValue(['ou_hr']),
    listPublishedResultsForQuarters: vi.fn().mockResolvedValue([]),
    upsertHalfYearResult: vi.fn().mockImplementation(async (v: any) => ({ ...v })),
    listHalfYearResults: vi.fn().mockResolvedValue([]),
    listPublishedGradesByRatee: vi.fn().mockResolvedValue([]),
    findLatestGradeHistory: vi.fn().mockResolvedValue(null),
    updateGradeSnapshot: vi.fn().mockResolvedValue({}),
    deptNamesByRatees: vi.fn().mockResolvedValue(new Map()),
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

function baseNotifier() {
  return {
    notifyPublished: vi.fn().mockResolvedValue(true),
    notifyAppeal: vi.fn().mockResolvedValue(1),
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

const ADMIN = { userId: 'ou_admin', role: UserRole.ADMIN, openId: 'ou_admin' };
const EMP = { userId: 'ou_x', role: UserRole.EMPLOYEE, openId: 'ou_x' };

function makeService(repo: any, resultRepo: any, notifier: any) {
  return new QuarterResultService(
    repo as unknown as QuarterRepository,
    resultRepo as unknown as QuarterResultRepository,
    notifier as unknown as QuarterNotifierService,
  );
}

describe('QuarterResultService', () => {
  let repo: ReturnType<typeof baseRepo>;
  let resultRepo: ReturnType<typeof baseResultRepo>;
  let notifier: ReturnType<typeof baseNotifier>;
  let service: QuarterResultService;

  beforeEach(() => {
    repo = baseRepo();
    resultRepo = baseResultRepo();
    notifier = baseNotifier();
    service = makeService(repo, resultRepo, notifier);
    vi.clearAllMocks();
    resultRepo.findResultByTask.mockResolvedValue(null);
    repo.findPerfRoleFlags.mockResolvedValue(null);
    resultRepo.resolveOpenId.mockResolvedValue('ou_ratee');
    resultRepo.listHrOpenIds.mockResolvedValue(['ou_hr']);
  });

  // ── 合成 ────────────────────────────────────────────────────────────────
  describe('computeResult', () => {
    it('mgmt_required：三方合成 55/35/10，mgmtAverage 单人=carol，total/grade 正确', async () => {
      repo.findTaskByUid.mockResolvedValue({
        taskUid: 'qt_alice',
        cycleUid: 'qc_q2',
        rateeUserId: 'ou_alice',
        rateeName: 'Alice',
        sheetType: 'employee',
        enrolled: true,
        stage: 'scored',
        mgmtRequired: true,
        mgmtTrace: { rule: 'first_level_dept', excludedIds: ['ou_lead'], raterIds: ['ou_carol'] },
      });
      repo.findSheetsByTask.mockResolvedValue([
        { raterRole: 'self', status: 'submitted', softTotal: '44.00' },
        { raterRole: 'manager', status: 'submitted', softTotal: '49.50', goalScore: '38.00', raterUserId: 'ou_boss' },
        { raterRole: 'peer', status: 'submitted', softTotal: '38.50', raterUserId: 'ou_bob' },
        { raterRole: 'management', status: 'submitted', softTotal: '44.00', raterUserId: 'ou_carol', raterName: 'Carol' },
      ]);
      resultRepo.upsertResult.mockImplementation(async (v: any) => ({ ...v }));

      await service.computeResult('qt_alice', ADMIN, {});
      const args = resultRepo.upsertResult.mock.calls[0][0];
      // 0.55*49.5 + 0.35*44 + 0.10*38.5 = 46.475；total = 38 + 46.475 = 84.475 → 84.5
      expect(args.goalScore).toBe('38.00');
      expect(args.mgmtAvg).toBe('44.00');
      expect(args.total).toBe('84.50');
      expect(args.grade).toBe('A');
      expect(args.weightsUsed).toMatchObject({ manager: 0.55, mgmt: 0.35, peer: 0.1 });
      expect(args.mgmtRaters.raterIds).toEqual(['ou_carol']);
      expect(args.status).toBe('draft');
    });

    it('无 mgmt 员工：90/10 回退，usedWeights 无 mgmt', async () => {
      repo.findTaskByUid.mockResolvedValue({
        taskUid: 'qt_bob',
        cycleUid: 'qc_q2',
        rateeUserId: 'ou_bob',
        rateeName: 'Bob',
        sheetType: 'employee',
        enrolled: true,
        stage: 'scored',
        mgmtRequired: false,
        mgmtTrace: null,
      });
      repo.findSheetsByTask.mockResolvedValue([
        { raterRole: 'manager', status: 'submitted', softTotal: '40.00', goalScore: '35.00', raterUserId: 'ou_boss' },
        { raterRole: 'peer', status: 'submitted', softTotal: '30.00', raterUserId: 'ou_carol' },
      ]);
      resultRepo.upsertResult.mockImplementation(async (v: any) => ({ ...v }));

      await service.computeResult('qt_bob', ADMIN, {});
      const args = resultRepo.upsertResult.mock.calls[0][0];
      // 0.9*40 + 0.1*30 = 39；total = 35 + 39 = 74 → B
      expect(args.mgmtAvg).toBeNull();
      expect(args.total).toBe('74.00');
      expect(args.grade).toBe('B');
      expect(args.weightsUsed).toMatchObject({ manager: 0.9, peer: 0.1 });
      expect(args.weightsUsed.mgmt).toBeUndefined();
    });

    it('硬化1：无 mgmt 且无同事（peer 缺席）→ 直属 1.00（李四场景 79.0 B）', async () => {
      repo.findTaskByUid.mockResolvedValue({
        taskUid: 'qt_bob2',
        cycleUid: 'qc_q2',
        rateeUserId: 'ou_bob',
        rateeName: '李四',
        sheetType: 'employee',
        enrolled: true,
        stage: 'scored',
        mgmtRequired: false,
        mgmtTrace: null,
      });
      // 只有直属 sheet，无 peer / 无 management
      repo.findSheetsByTask.mockResolvedValue([
        { raterRole: 'manager', status: 'submitted', softTotal: '44.00', goalScore: '35.00', raterUserId: 'ou_boss' },
      ]);
      resultRepo.upsertResult.mockImplementation(async (v: any) => ({ ...v }));

      await service.computeResult('qt_bob2', ADMIN, {});
      const args = resultRepo.upsertResult.mock.calls[0][0];
      // 直属 1.00 × 44 = 44；total = 35 + 44 = 79.0 → B
      expect(args.mgmtAvg).toBeNull();
      expect(args.peerSoft).toBeNull(); // 缺席，落库 null（区别于 0）
      expect(args.softMerged).toBe('44.00');
      expect(args.total).toBe('79.00');
      expect(args.grade).toBe('B');
      expect(args.weightsUsed).toEqual({ manager: 1 });
    });

    it('硬化1：mgmt 在 + 同事缺席 → 0.65/0.35（同事 0.10 归直属）', async () => {
      repo.findTaskByUid.mockResolvedValue({
        taskUid: 'qt_np',
        cycleUid: 'qc_q2',
        rateeUserId: 'ou_np',
        rateeName: 'NoPeer',
        sheetType: 'employee',
        enrolled: true,
        stage: 'scored',
        mgmtRequired: true,
        mgmtTrace: { rule: 'first_level_dept', excludedIds: [], raterIds: ['ou_carol'] },
      });
      repo.findSheetsByTask.mockResolvedValue([
        { raterRole: 'manager', status: 'submitted', softTotal: '50.00', goalScore: '38.00', raterUserId: 'ou_boss' },
        { raterRole: 'management', status: 'submitted', softTotal: '40.00', raterUserId: 'ou_carol', raterName: 'Carol' },
        // peer sheet 存在但未提交（超时跳过）→ 视为缺席
        { raterRole: 'peer', status: 'draft', softTotal: null, raterUserId: 'ou_bob' },
      ]);
      resultRepo.upsertResult.mockImplementation(async (v: any) => ({ ...v }));

      await service.computeResult('qt_np', ADMIN, {});
      const args = resultRepo.upsertResult.mock.calls[0][0];
      // 0.65*50 + 0.35*40 = 32.5 + 14 = 46.5；total = 38 + 46.5 = 84.5 → A
      expect(args.mgmtAvg).toBe('40.00');
      expect(args.peerSoft).toBeNull();
      expect(args.softMerged).toBe('46.50');
      expect(args.total).toBe('84.50');
      expect(args.weightsUsed).toEqual({ manager: 0.65, mgmt: 0.35 });
    });

    it('硬化2：mgmt_required 全排除回退（无 management sheet）→ mgmt 缺席合成 + 留痕 all_excluded_fallback', async () => {
      repo.findTaskByUid.mockResolvedValue({
        taskUid: 'qt_af',
        cycleUid: 'qc_q2',
        rateeUserId: 'ou_af',
        rateeName: 'AllExcluded',
        sheetType: 'leader',
        enrolled: true,
        stage: 'scored',
        mgmtRequired: true,
        mgmtTrace: { rule: 'all_excluded_fallback', excludedIds: ['ou_cto'], raterIds: [] },
      });
      // manager + peer 提交，无 management sheet（全排除未建）
      repo.findSheetsByTask.mockResolvedValue([
        { raterRole: 'manager', status: 'submitted', softTotal: '50.00', goalScore: '38.00', raterUserId: 'ou_boss' },
        { raterRole: 'peer', status: 'submitted', softTotal: '45.00', raterUserId: 'ou_bob' },
      ]);
      resultRepo.upsertResult.mockImplementation(async (v: any) => ({ ...v }));

      await service.computeResult('qt_af', ADMIN, {});
      const args = resultRepo.upsertResult.mock.calls[0][0];
      // mgmt 缺席 + 同事在 → 0.90/0.10：0.9*50 + 0.1*45 = 49.5；total = 38 + 49.5 = 87.5 → A
      expect(args.mgmtAvg).toBeNull();
      expect(args.weightsUsed).toEqual({ manager: 0.9, peer: 0.1 });
      expect(args.total).toBe('87.50');
      expect(args.mgmtRaters.rule).toBe('all_excluded_fallback');
      expect(args.mgmtRaters.raterIds).toEqual([]);
    });

    it('红线合成 → 强制 D', async () => {
      repo.findTaskByUid.mockResolvedValue({
        taskUid: 'qt_c', cycleUid: 'qc_q2', rateeUserId: 'ou_c', rateeName: 'C',
        sheetType: 'employee', enrolled: true, stage: 'scored', mgmtRequired: false, mgmtTrace: null,
      });
      repo.findSheetsByTask.mockResolvedValue([
        { raterRole: 'manager', status: 'submitted', softTotal: '50.00', goalScore: '45.00', raterUserId: 'ou_boss' },
        { raterRole: 'peer', status: 'submitted', softTotal: '50.00', raterUserId: 'ou_p' },
      ]);
      resultRepo.upsertResult.mockImplementation(async (v: any) => ({ ...v }));
      await service.computeResult('qt_c', ADMIN, { red_line: true, red_line_note: '重大事故' });
      const args = resultRepo.upsertResult.mock.calls[0][0];
      expect(args.redLine).toBe(true);
      expect(args.grade).toBe('D');
    });

    it('尚未 scored → 400', async () => {
      repo.findTaskByUid.mockResolvedValue({ taskUid: 'qt_x', enrolled: true, stage: 'pending_mgmt' });
      await expect(service.computeResult('qt_x', ADMIN, {})).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
      });
      expect(resultRepo.upsertResult).not.toHaveBeenCalled();
    });

    it('已公示结果不可重新合成 → 400', async () => {
      repo.findTaskByUid.mockResolvedValue({ taskUid: 'qt_x', cycleUid: 'qc', enrolled: true, stage: 'scored', mgmtRequired: false });
      resultRepo.findResultByTask.mockResolvedValue({ resultUid: 'qr_1', status: 'published' });
      await expect(service.computeResult('qt_x', ADMIN, {})).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
      });
    });

    it('非管理层/非管理角色不能合成 → 403', async () => {
      await expect(service.computeResult('qt_x', EMP, {})).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  // ── panel 权限 ────────────────────────────────────────────────────────────
  describe('getPanel', () => {
    it('普通员工看不了 panel → 403', async () => {
      await expect(service.getPanel('qc_q2', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('is_management 可看；返回分布/S-D 名单', async () => {
      repo.findPerfRoleFlags.mockResolvedValue({ isLeader: false, isManagement: true });
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_q2', quarter: '2026-Q2', status: 'scoring' });
      repo.listTasksByCycle.mockResolvedValue([
        { taskUid: 'qt_a', rateeUserId: 'ou_a', rateeName: 'A', sheetType: 'employee', stage: 'scored', enrolled: true, mgmtRequired: true },
        { taskUid: 'qt_b', rateeUserId: 'ou_b', rateeName: 'B', sheetType: 'employee', stage: 'scored', enrolled: true, mgmtRequired: false },
      ]);
      resultRepo.listResultsByCycle.mockResolvedValue([
        { taskUid: 'qt_a', grade: 'S', total: '92.00', status: 'draft', redLine: false },
        { taskUid: 'qt_b', grade: 'D', total: '55.00', status: 'draft', redLine: false },
      ]);
      const res = await service.getPanel('qc_q2', { userId: 'ou_m', role: UserRole.EMPLOYEE, openId: 'ou_m' });
      expect(res.summary.computedCount).toBe(2);
      expect(res.distribution.gradeCounts.S).toBe(1);
      expect(res.distribution.gradeCounts.D).toBe(1);
      expect(res.sList).toHaveLength(1);
      expect(res.dList).toHaveLength(1);
      expect(res.rows).toHaveLength(2);
    });
  });

  // ── 改分 ────────────────────────────────────────────────────────────────
  describe('reviseResult', () => {
    it('改 goal_score → 重算 total/grade + 写 revision（before/after/reason）', async () => {
      resultRepo.findResultByUid.mockResolvedValue({
        resultUid: 'qr_1', status: 'draft', goalScore: '38.00', softMerged: '46.48', total: '84.48', grade: 'A', redLine: false,
      });
      resultRepo.updateResultWithRevision.mockImplementation(async (_uid: string, updates: any) => ({
        resultUid: 'qr_1', status: 'draft', ...updates,
      }));
      await service.reviseResult('qr_1', ADMIN, { field: 'goal_score', after: '40', reason: '目标达成复核上调' });
      const [, updates, revision] = resultRepo.updateResultWithRevision.mock.calls[0];
      // total = 40 + 46.48 = 86.48 → 86.5
      expect(updates.goalScore).toBe('40.00');
      expect(updates.total).toBe('86.50');
      expect(updates.grade).toBe('A');
      expect(revision).toMatchObject({ field: 'goal_score', before: '38.00', after: '40', reason: '目标达成复核上调' });
    });

    it('直接改 grade → 仅记录，不动分数', async () => {
      resultRepo.findResultByUid.mockResolvedValue({
        resultUid: 'qr_1', status: 'draft', goalScore: '38.00', softMerged: '46.48', total: '84.48', grade: 'A', redLine: false,
      });
      resultRepo.updateResultWithRevision.mockImplementation(async (_uid: string, updates: any) => ({ resultUid: 'qr_1', ...updates }));
      await service.reviseResult('qr_1', ADMIN, { field: 'grade', after: 'B', reason: '评分会下调' });
      const [, updates] = resultRepo.updateResultWithRevision.mock.calls[0];
      expect(updates.grade).toBe('B');
      expect(updates.total).toBeUndefined();
    });

    it('已公示后改分 → 403', async () => {
      resultRepo.findResultByUid.mockResolvedValue({ resultUid: 'qr_1', status: 'published' });
      await expect(
        service.reviseResult('qr_1', ADMIN, { field: 'total', after: '90', reason: 'x' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
      expect(resultRepo.updateResultWithRevision).not.toHaveBeenCalled();
    });
  });

  // ── 公示 ────────────────────────────────────────────────────────────────
  describe('publishCycle', () => {
    it('公示 draft 结果并置 published + appeal_deadline=+3 工作日', async () => {
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_q2', quarter: '2026-Q2', status: 'scoring' });
      resultRepo.listResultsByCycle.mockResolvedValue([
        { resultUid: 'qr_1', rateeUserId: 'ou_a', rateeName: 'A', total: '84.50', grade: 'A', status: 'draft' },
      ]);
      resultRepo.publishDraftResults.mockResolvedValue(1);
      const res = await service.publishCycle('qc_q2', ADMIN);
      expect(res.published).toBe(1);
      expect(resultRepo.updateCycleStatus).toHaveBeenCalledWith('qc_q2', 'published', expect.any(Date));
      expect(notifier.notifyPublished).toHaveBeenCalled();
      // 截止 = 公示 + 3 工作日，晚于公示且非周末
      const deadline: Date = res.appealDeadlineAt;
      expect(deadline.getTime()).toBeGreaterThan(Date.now());
      expect([0, 6]).not.toContain(deadline.getUTCDay());
    });

    it('无 draft 结果 → 400（先合成）', async () => {
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_q2', quarter: '2026-Q2', status: 'scoring' });
      resultRepo.listResultsByCycle.mockResolvedValue([{ status: 'published' }]);
      await expect(service.publishCycle('qc_q2', ADMIN)).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('非 admin/boss/hr → 403', async () => {
      await expect(service.publishCycle('qc_q2', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  // ── 被评人视角 ────────────────────────────────────────────────────────────
  describe('myResult', () => {
    it('未公示（draft）→ 403', async () => {
      resultRepo.findResultByCycleAndRatee.mockResolvedValue({ resultUid: 'qr_1', status: 'draft', rateeUserId: 'ou_x' });
      await expect(service.myResult('qc_q2', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('无结果 → { result: null }', async () => {
      resultRepo.findResultByCycleAndRatee.mockResolvedValue(null);
      const res = await service.myResult('qc_q2', EMP);
      expect(res.result).toBeNull();
    });

    it('已公示 → 返回结果 + canAppeal（期限内无 open）', async () => {
      const future = new Date(Date.now() + 3 * 86_400_000);
      resultRepo.findResultByCycleAndRatee.mockResolvedValue({
        resultUid: 'qr_1', status: 'published', rateeUserId: 'ou_x', total: '84.50', grade: 'A', appealDeadlineAt: future,
      });
      resultRepo.listAppealsByResult.mockResolvedValue([]);
      const res = await service.myResult('qc_q2', EMP);
      expect(res.result?.grade).toBe('A');
      expect(res.canAppeal).toBe(true);
    });
  });

  // ── 申诉 ────────────────────────────────────────────────────────────────
  describe('createAppeal', () => {
    const future = new Date(Date.now() + 3 * 86_400_000);
    const past = new Date(Date.now() - 86_400_000);

    it('本人公示期内提交 → 建 open 申诉并通知 hr', async () => {
      resultRepo.findResultByUid.mockResolvedValue({
        resultUid: 'qr_1', cycleUid: 'qc_q2', rateeUserId: 'ou_x', rateeName: 'X', status: 'published', appealDeadlineAt: future,
      });
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_q2', quarter: '2026-Q2' });
      resultRepo.insertAppeal.mockImplementation(async (v: any) => ({ ...v }));
      await service.createAppeal('qr_1', EMP, { content: '目标分被低估' });
      expect(resultRepo.insertAppeal).toHaveBeenCalled();
      expect(notifier.notifyAppeal).toHaveBeenCalled();
    });

    it('非本人 → 403', async () => {
      resultRepo.findResultByUid.mockResolvedValue({ resultUid: 'qr_1', rateeUserId: 'ou_other', status: 'published', appealDeadlineAt: future });
      await expect(service.createAppeal('qr_1', EMP, { content: 'x' })).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN,
      });
    });

    it('过期 → 400', async () => {
      resultRepo.findResultByUid.mockResolvedValue({ resultUid: 'qr_1', rateeUserId: 'ou_x', status: 'published', appealDeadlineAt: past });
      await expect(service.createAppeal('qr_1', EMP, { content: 'x' })).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
      });
    });

    it('已有 open 申诉 → 400', async () => {
      resultRepo.findResultByUid.mockResolvedValue({ resultUid: 'qr_1', rateeUserId: 'ou_x', status: 'published', appealDeadlineAt: future });
      resultRepo.findOpenAppealByResult.mockResolvedValue({ appealUid: 'qap_1', status: 'open' });
      await expect(service.createAppeal('qr_1', EMP, { content: 'x' })).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
      });
    });

    it('未公示 → 400', async () => {
      resultRepo.findResultByUid.mockResolvedValue({ resultUid: 'qr_1', rateeUserId: 'ou_x', status: 'draft' });
      await expect(service.createAppeal('qr_1', EMP, { content: 'x' })).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
      });
    });
  });

  describe('handleAppeal', () => {
    it('hr resolve → 更新 status/handler/resolution/resolved_at', async () => {
      resultRepo.findAppealByUid.mockResolvedValue({ appealUid: 'qap_1', status: 'open' });
      resultRepo.updateAppeal.mockImplementation(async (_uid: string, v: any) => ({ appealUid: 'qap_1', ...v }));
      await service.handleAppeal('qap_1', { userId: 'ou_hr', role: UserRole.HR, openId: 'ou_hr' }, { status: 'resolved', resolution: '维持原判，已说明' });
      const [, values] = resultRepo.updateAppeal.mock.calls[0];
      expect(values).toMatchObject({ status: 'resolved', handler: 'ou_hr', resolution: '维持原判，已说明' });
      expect(values.resolvedAt).toBeInstanceOf(Date);
    });

    it('非 hr/admin → 403', async () => {
      await expect(
        service.handleAppeal('qap_1', EMP, { status: 'resolved', resolution: 'x' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
    });

    it('已处理的申诉再处理 → 400', async () => {
      resultRepo.findAppealByUid.mockResolvedValue({ appealUid: 'qap_1', status: 'resolved' });
      await expect(
        service.handleAppeal('qap_1', { userId: 'ou_hr', role: UserRole.HR, openId: 'ou_hr' }, { status: 'rejected', resolution: 'x' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });
  });

  // ── 半年合成（A）────────────────────────────────────────────────────────
  describe('computeHalfYear', () => {
    it('40/60 合成 + single_100 分支（只有后季有分的人）', async () => {
      resultRepo.listPublishedResultsForQuarters.mockResolvedValue([
        { quarter: '2026-Q1', rateeUserId: 'ou_a', rateeName: '张三', total: '85.00' },
        { quarter: '2026-Q2', rateeUserId: 'ou_a', rateeName: '张三', total: '90.00' },
        { quarter: '2026-Q2', rateeUserId: 'ou_b', rateeName: '李四', total: '74.60' },
      ]);
      const res = await service.computeHalfYear('2026-H1', ADMIN);
      expect(res.synthesized).toBe(2);
      expect(res.prevQuarter).toBe('2026-Q1');
      expect(res.currQuarter).toBe('2026-Q2');
      const calls = resultRepo.upsertHalfYearResult.mock.calls.map((c: any[]) => c[0]);
      const a = calls.find((c: any) => c.rateeUserId === 'ou_a');
      // 85*0.4 + 90*0.6 = 88 → A
      expect(a.formula).toBe('40/60');
      expect(a.total).toBe('88.00');
      expect(a.grade).toBe('A');
      const b = calls.find((c: any) => c.rateeUserId === 'ou_b');
      expect(b.formula).toBe('single_100');
      expect(b.total).toBe('74.60');
      expect(b.prevTotal).toBeNull();
      expect(b.currTotal).toBe('74.60');
    });

    it('非法 half → 400', async () => {
      await expect(service.computeHalfYear('2026-Q1', ADMIN)).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
      });
    });

    it('非 admin/boss/hr → 403', async () => {
      await expect(service.computeHalfYear('2026-H1', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  describe('getHalfYear', () => {
    it('本人可读自己的半年成绩', async () => {
      resultRepo.listHalfYearResults.mockResolvedValue([
        { resultUid: 'hyr_1', half: '2026-H1', rateeUserId: 'ou_x', total: '88.00', grade: 'A', formula: '40/60' },
      ]);
      const res = await service.getHalfYear('2026-H1', 'ou_x', EMP);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].grade).toBe('A');
    });

    it('不给 ratee 且非管理角色 → 403', async () => {
      await expect(service.getHalfYear('2026-H1', undefined, EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  // ── 定级定岗资格（B）──────────────────────────────────────────────────────
  describe('getPromotionEligibility', () => {
    it('连续两季 A → eligible=true', async () => {
      resultRepo.listPublishedGradesByRatee.mockResolvedValue([
        { quarter: '2026-Q1', grade: 'A' },
        { quarter: '2026-Q2', grade: 'A' },
      ]);
      const res = await service.getPromotionEligibility('ou_a', ADMIN);
      expect(res.eligible).toBe(true);
      expect(res.basis).toEqual(['2026-Q1', '2026-Q2']);
    });

    it('当季 S → eligible=true', async () => {
      resultRepo.listPublishedGradesByRatee.mockResolvedValue([{ quarter: '2026-Q2', grade: 'S' }]);
      const res = await service.getPromotionEligibility('ou_a', ADMIN);
      expect(res.eligible).toBe(true);
    });

    it('本人可查自己资格', async () => {
      resultRepo.listPublishedGradesByRatee.mockResolvedValue([{ quarter: '2026-Q2', grade: 'B' }]);
      const res = await service.getPromotionEligibility('ou_x', EMP);
      expect(res.eligible).toBe(false);
    });
  });

  // ── 回填职级快照（B）──────────────────────────────────────────────────────
  describe('backfillGradeSnapshot', () => {
    it('有 grade_history 的回填 score_snapshot；无记录的跳过 + warn', async () => {
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_q2', quarter: '2026-Q2' });
      resultRepo.listResultsByCycle.mockResolvedValue([
        { rateeUserId: 'ou_a', rateeName: '张三', status: 'published', total: '86.50', grade: 'A', softMerged: '46.50', goalScore: '40.00' },
        { rateeUserId: 'ou_b', rateeName: '李四', status: 'published', total: '79.00', grade: 'B', softMerged: '44.00', goalScore: '35.00' },
      ]);
      resultRepo.findLatestGradeHistory.mockImplementation(async (cands: string[]) =>
        cands.includes('ou_a') ? { recordUid: 'gh_a' } : null,
      );
      const res = await service.backfillGradeSnapshot('qc_q2', ADMIN);
      expect(res.backfilled).toBe(1);
      expect(res.skipped).toEqual(['李四']);
      const [, snap] = resultRepo.updateGradeSnapshot.mock.calls[0];
      expect(snap).toMatchObject({ quarter: '2026-Q2', total: 86.5, grade: 'A', soft_merged: 46.5, goal_score: 40 });
    });

    it('非 admin/boss/hr → 403', async () => {
      await expect(service.backfillGradeSnapshot('qc_q2', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  // ── CSV 导出（C）──────────────────────────────────────────────────────────
  describe('exportCycleCsv', () => {
    it('返回带 BOM + 中文列头 + 数据行的 CSV', async () => {
      repo.findCycleByUid.mockResolvedValue({ cycleUid: 'qc_q2', quarter: '2026-Q2' });
      resultRepo.listResultsByCycle.mockResolvedValue([
        {
          rateeUserId: 'ou_a', rateeName: '张三', sheetType: 'employee',
          goalScore: '40.00', managerSoft: '49.50', peerSoft: '38.50', mgmtAvg: '44.00',
          softMerged: '46.48', total: '86.50', grade: 'A',
          weightsUsed: { manager: 0.55, mgmt: 0.35, peer: 0.1 }, redLine: false,
        },
      ]);
      resultRepo.deptNamesByRatees.mockResolvedValue(new Map([['ou_a', '技术部']]));
      const { filename, csv } = await service.exportCycleCsv('qc_q2', ADMIN);
      expect(filename).toContain('2026-Q2');
      expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
      expect(csv).toContain('姓名,部门,类型,目标分,直属软项,同事软项,管理层均值,软项合成,总分,评级,权重组,是否红线');
      expect(csv).toContain('张三');
      expect(csv).toContain('技术部');
      expect(csv).toContain('员工');
      expect(csv).toContain('直属0.55/管理0.35/同事0.1');
      expect(csv).toContain('86.5');
    });

    it('非 admin/hr/pmo/boss → 403', async () => {
      await expect(service.exportCycleCsv('qc_q2', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  // ── 月度综合系数 CSV 导出（P4b 遗留）──────────────────────────────────────────
  describe('exportMonthlyCsv', () => {
    it('返回带 BOM + 中文列头（姓名/部门/月份/综合系数/评级/是否红线）+ 数据行', async () => {
      repo.listMonthlyScoresByMonth.mockResolvedValue([
        { scoreMonth: '2026-06', rateeUserId: 'ou_a', rateeName: '张三', composite: '0.92', totalScore: '92.0', score: null, grade: 'A', redLine: false },
        { scoreMonth: '2026-06', rateeUserId: 'ou_b', rateeName: '李四', composite: null, totalScore: '55.0', score: null, grade: 'D', redLine: true },
      ]);
      resultRepo.deptNamesByRatees.mockResolvedValue(new Map([['ou_a', '技术部'], ['ou_b', '产品部']]));
      const { filename, csv } = await service.exportMonthlyCsv('2026-06', ADMIN);
      expect(filename).toContain('2026-06');
      expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
      expect(csv).toContain('姓名,部门,月份,综合系数,评级,是否红线');
      expect(csv).toContain('张三');
      expect(csv).toContain('技术部');
      expect(csv).toContain('0.92');
      expect(csv).toContain('2026-06');
      // 红线行显示"是"
      expect(csv).toMatch(/李四.*是/);
    });

    it('缺 month 参数 → 400', async () => {
      await expect(service.exportMonthlyCsv('', ADMIN)).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS, status: HttpStatus.BAD_REQUEST,
      });
    });

    it('非 admin/hr/pmo/boss → 403', async () => {
      await expect(service.exportMonthlyCsv('2026-06', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN,
      });
    });
  });

  describe('listAppeals', () => {
    it('非 hr/admin → 403', async () => {
      await expect(service.listAppeals('qc_q2', EMP)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN,
      });
    });

    it('cycle 传 quarter 字符串（YYYY-QN）→ 解析成 cycle_uid 再查', async () => {
      repo.findCycleByQuarter.mockResolvedValue({ cycleUid: 'qc_q2', quarter: '2026-Q2' });
      await service.listAppeals('2026-Q2', ADMIN);
      expect(repo.findCycleByQuarter).toHaveBeenCalledWith('2026-Q2');
      expect(resultRepo.listAppealsByCycle).toHaveBeenCalledWith('qc_q2');
    });

    it('cycle 传 cycle_uid → 直查不解析', async () => {
      await service.listAppeals('qc_q2', ADMIN);
      expect(repo.findCycleByQuarter).not.toHaveBeenCalled();
      expect(resultRepo.listAppealsByCycle).toHaveBeenCalledWith('qc_q2');
    });

    it('quarter 不存在 → 404', async () => {
      repo.findCycleByQuarter.mockResolvedValue(null);
      await expect(service.listAppeals('2031-Q1', ADMIN)).rejects.toMatchObject({
        businessCode: ErrorCode.TASK_NOT_FOUND, status: HttpStatus.NOT_FOUND,
      });
    });

    it('缺 cycle 参数 → 400 业务错误而非 500', async () => {
      await expect(service.listAppeals(undefined as unknown as string, ADMIN)).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS, status: HttpStatus.BAD_REQUEST,
      });
    });
  });
});
