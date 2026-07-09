/**
 * monthly-score.service.spec.ts
 *
 * TDD spec for MonthlyScoreService.
 * All external dependencies (repository) are mocked — no DB required.
 *
 * Coverage scenarios:
 *  1.  draft → scored: rater fills score → status becomes 'scored', version increments
 *  2.  draft → scored: non-rater fills score → throws BusinessException(1002)
 *  3.  scored → challenged: any auth'd user challenges → challengedAt written
 *  4.  scored → challenged: cannot challenge a locked record → throws BusinessException(1002)
 *  5.  challenged → pending_lock: rater resolves → resolvedAt written, status → pending_lock
 *  6.  challenged → pending_lock: non-rater resolves → throws BusinessException(1002)
 *  7.  pending_lock → locked: PMO/Boss locks → lockedAt + lockedBy written
 *  8.  pending_lock → locked: non-PMO/Boss → throws BusinessException(1002)
 *  9.  locked: any write attempt (PATCH score) → throws BusinessException(1002)
 * 10.  OCC: version mismatch → throws BusinessException(1009)
 * 11.  score out of range (< 0 or > 1) → throws BusinessException(1001)
 * 12.  scored → pending_lock (skip challenge): PMO/Boss can lock directly from scored
 * 13.  getContext: returns aggregated context (snapshot + prev score + incidents + projects)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { MonthlyScoreService } from './monthly-score.service';
import { MonthlyScoreRepository } from './monthly-score.repository';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function createMockRepo(): Record<keyof MonthlyScoreRepository, ReturnType<typeof vi.fn>> {
  return {
    findByUid: vi.fn(),
    updateWithVersion: vi.fn(),
    updateField: vi.fn(),
    listByMonth: vi.fn(),
    getContext: vi.fn(),
    findPrevScore: vi.fn(),
    findRolesByUserId: vi.fn(),
    // V1.4 additions
    findTemplateWithDimensions: vi.fn(),
    findPerfRole: vi.fn(),
    submitDetailedScore: vi.fn(),
    findDetailsByScoreUid: vi.fn(),
    findRedLineRecipients: vi.fn(),
  };
}

/** FeishuMessengerService mock（红线通知底座；失败只 warn 不阻塞）。 */
function createMockMessenger() {
  return { sendTextToUser: vi.fn().mockResolvedValue(true) };
}

/** monthly_employee 模板（2 维：工作量15 / 交付85）。 */
function makeEmployeeTemplate() {
  return {
    template: {
      templateUid: 'spt_monthly_employee',
      code: 'monthly_employee',
      goalWeight: null,
      gradeBands: [],
    },
    dimensions: [
      { code: 'workload', name: '工作量', description: '', weight: '15', sort: 0, scale: 'coefficient', anchors: [] },
      { code: 'delivery', name: '交付质量（含结果）', description: '', weight: '85', sort: 1, scale: 'coefficient', anchors: [] },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScore(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    scoreUid: 'sc_abc12345',
    scoreMonth: '2026-04',
    rateeUserId: 'ou_employee',
    rateeName: '张三',
    raterUserId: 'ou_leader',
    raterName: '李四',
    score: null,
    status: 'draft',
    challengeNote: null,
    challengedAt: null,
    resolvedAt: null,
    lockedAt: null,
    lockedBy: null,
    escalatedAt: null,
    snapshotRef: 'snap_001',
    version: 1,
    createdAt: new Date('2026-05-01T08:00:00Z'),
    updatedAt: new Date('2026-05-01T08:00:00Z'),
    createdBy: 'system',
    updatedBy: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MonthlyScoreService', () => {
  let service: MonthlyScoreService;
  let repo: ReturnType<typeof createMockRepo>;
  let messenger: ReturnType<typeof createMockMessenger>;

  beforeEach(() => {
    repo = createMockRepo();
    messenger = createMockMessenger();
    service = new MonthlyScoreService(
      repo as unknown as MonthlyScoreRepository,
      messenger as unknown as never,
    );
    vi.clearAllMocks();
  });

  // ── 1. draft → scored: rater fills score ─────────────────────────────────

  it('rater can score a draft record, status transitions to scored', async () => {
    const draft = makeScore({ status: 'draft', version: 1 });
    repo.findByUid.mockResolvedValue(draft);
    repo.updateWithVersion.mockResolvedValue({
      ...draft,
      score: '0.8',
      status: 'scored',
      version: 2,
    });

    const result = await service.submitScore('sc_abc12345', 'ou_leader', {
      score: 0.8,
      version: 1,
    });

    expect(repo.updateWithVersion).toHaveBeenCalledOnce();
    const updateArg = repo.updateWithVersion.mock.calls[0];
    expect(updateArg[1]).toBe(1); // version
    expect(updateArg[2]).toMatchObject({ score: '0.8', status: 'scored' });
    expect(result.status).toBe('scored');
  });

  // ── 2. draft → scored: non-rater → NO_PERMISSION ──────────────────────────

  it('non-rater cannot score a draft record → BusinessException(1002)', async () => {
    const draft = makeScore({ status: 'draft' });
    repo.findByUid.mockResolvedValue(draft);

    await expect(
      service.submitScore('sc_abc12345', 'ou_intruder', { score: 0.5, version: 1 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });

    expect(repo.updateWithVersion).not.toHaveBeenCalled();
  });

  // ── 3. scored → challenged: 仅被评人(ratee)可申诉 ────────────────

  it('被评人(ratee)可申诉 scored 记录 → challengedAt written（乐观锁）', async () => {
    const scored = makeScore({ status: 'scored', score: '0.7', version: 2 });
    repo.findByUid.mockResolvedValue(scored);
    repo.updateWithVersion.mockResolvedValue({
      ...scored,
      status: 'challenged',
      challengedAt: new Date(),
      challengeNote: 'I disagree',
    });

    // makeScore.rateeUserId = 'ou_employee'
    const result = await service.challengeScore('sc_abc12345', 'ou_employee', {
      challenge_note: 'I disagree',
      version: 2,
    });

    expect(repo.updateWithVersion).toHaveBeenCalledWith('sc_abc12345', 2, expect.objectContaining({ status: 'challenged' }));
    expect(result.status).toBe('challenged');
  });

  it('版本冲突（并发）→ BusinessException(1009)', async () => {
    const scored = makeScore({ status: 'scored', score: '0.7', version: 2 });
    repo.findByUid.mockResolvedValue(scored);
    repo.updateWithVersion.mockResolvedValue(null); // 版本不匹配
    await expect(
      service.challengeScore('sc_abc12345', 'ou_employee', { challenge_note: 'x', version: 1 }),
    ).rejects.toMatchObject({ businessCode: ErrorCode.VERSION_CONFLICT });
  });

  it('非被评人申诉他人的分 → BusinessException(1002) 且不写库', async () => {
    const scored = makeScore({ status: 'scored', score: '0.7', version: 2 });
    repo.findByUid.mockResolvedValue(scored);
    await expect(
      service.challengeScore('sc_abc12345', 'ou_stranger', { challenge_note: 'x', version: 2 }),
    ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED });
    expect(repo.updateWithVersion).not.toHaveBeenCalled();
  });

  // ── 4. scored → challenged: locked record cannot be challenged ────────────

  it('challenge on a locked record → BusinessException(1002)', async () => {
    const locked = makeScore({ status: 'locked', lockedAt: new Date() });
    repo.findByUid.mockResolvedValue(locked);

    await expect(
      service.challengeScore('sc_abc12345', 'ou_any_user', { challenge_note: 'Late challenge', version: 1 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });

    expect(repo.updateField).not.toHaveBeenCalled();
  });

  // ── 5. challenged → pending_lock: rater resolves ─────────────────────────

  it('rater can resolve a challenged record → resolvedAt written, status → pending_lock', async () => {
    const challenged = makeScore({
      status: 'challenged',
      challengedAt: new Date(),
      score: '0.7',
      version: 2,
    });
    repo.findByUid.mockResolvedValue(challenged);
    repo.updateWithVersion.mockResolvedValue({
      ...challenged,
      status: 'pending_lock',
      resolvedAt: new Date(),
      version: 3,
    });

    const result = await service.resolveChallenge('sc_abc12345', 'ou_leader', {
      score: 0.7,
      version: 2,
    });

    expect(repo.updateWithVersion).toHaveBeenCalledOnce();
    const updateArg = repo.updateWithVersion.mock.calls[0][2];
    expect(updateArg.status).toBe('pending_lock');
    expect(updateArg.resolvedAt).toBeInstanceOf(Date);
    expect(result.status).toBe('pending_lock');
  });

  // ── 6. challenged → pending_lock: non-rater → NO_PERMISSION ──────────────

  it('non-rater cannot resolve a challenge → BusinessException(1002)', async () => {
    const challenged = makeScore({ status: 'challenged', version: 2 });
    repo.findByUid.mockResolvedValue(challenged);

    await expect(
      service.resolveChallenge('sc_abc12345', 'ou_intruder', { score: 0.7, version: 2 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });

    expect(repo.updateWithVersion).not.toHaveBeenCalled();
  });

  // ── 7. pending_lock → locked: PMO/Boss locks ──────────────────────────────

  it('PMO can lock a pending_lock record → lockedAt + lockedBy written', async () => {
    const pendingLock = makeScore({ status: 'pending_lock', score: '0.9', version: 3 });
    repo.findByUid.mockResolvedValue(pendingLock);
    repo.findRolesByUserId.mockResolvedValue([{ role: UserRole.PMO }]);
    repo.updateField.mockResolvedValue({
      ...pendingLock,
      status: 'locked',
      lockedAt: new Date(),
      lockedBy: 'ou_pmo',
    });

    const result = await service.lockScore('sc_abc12345', 'ou_pmo', UserRole.PMO);

    expect(repo.updateField).toHaveBeenCalledOnce();
    const updateArg = repo.updateField.mock.calls[0][1];
    expect(updateArg.status).toBe('locked');
    expect(updateArg.lockedAt).toBeInstanceOf(Date);
    expect(updateArg.lockedBy).toBe('ou_pmo');
    expect(result.status).toBe('locked');
  });

  it('Boss can lock a scored record directly (skip challenge) → status locked', async () => {
    const scored = makeScore({ status: 'scored', score: '1.0', version: 2 });
    repo.findByUid.mockResolvedValue(scored);
    repo.findRolesByUserId.mockResolvedValue([{ role: UserRole.BOSS }]);
    repo.updateField.mockResolvedValue({
      ...scored,
      status: 'locked',
      lockedAt: new Date(),
      lockedBy: 'ou_boss',
    });

    const result = await service.lockScore('sc_abc12345', 'ou_boss', UserRole.BOSS);

    expect(result.status).toBe('locked');
  });

  // ── 8. pending_lock → locked: non-PMO/Boss → NO_PERMISSION ───────────────

  it('employee role cannot lock a record → BusinessException(1002)', async () => {
    const pendingLock = makeScore({ status: 'pending_lock' });
    repo.findByUid.mockResolvedValue(pendingLock);
    repo.findRolesByUserId.mockResolvedValue([{ role: UserRole.EMPLOYEE }]);

    await expect(
      service.lockScore('sc_abc12345', 'ou_emp', UserRole.EMPLOYEE),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });

    expect(repo.updateField).not.toHaveBeenCalled();
  });

  it('leader role cannot lock a record → BusinessException(1002)', async () => {
    const pendingLock = makeScore({ status: 'pending_lock' });
    repo.findByUid.mockResolvedValue(pendingLock);
    repo.findRolesByUserId.mockResolvedValue([{ role: UserRole.LEADER }]);

    await expect(
      service.lockScore('sc_abc12345', 'ou_leader', UserRole.LEADER),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });
  });

  // ── 9. locked record: any write → BusinessException(1002) ─────────────────

  it('cannot submit score on a locked record → BusinessException(1002)', async () => {
    const locked = makeScore({ status: 'locked', score: '1.0', lockedAt: new Date() });
    repo.findByUid.mockResolvedValue(locked);

    await expect(
      service.submitScore('sc_abc12345', 'ou_leader', { score: 0.8, version: 3 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });

    expect(repo.updateWithVersion).not.toHaveBeenCalled();
  });

  it('cannot resolve challenge on a locked record → BusinessException(1002)', async () => {
    const locked = makeScore({ status: 'locked', lockedAt: new Date() });
    repo.findByUid.mockResolvedValue(locked);

    await expect(
      service.resolveChallenge('sc_abc12345', 'ou_leader', { score: 0.8, version: 3 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });
  });

  // ── 10. OCC: version mismatch → BusinessException(1009) ───────────────────

  it('version mismatch on submitScore → BusinessException(1009)', async () => {
    const draft = makeScore({ status: 'draft', version: 5 });
    repo.findByUid.mockResolvedValue(draft);
    repo.updateWithVersion.mockResolvedValue(null); // null = no row updated

    await expect(
      service.submitScore('sc_abc12345', 'ou_leader', { score: 0.9, version: 3 }), // wrong version
    ).rejects.toMatchObject({
      businessCode: ErrorCode.VERSION_CONFLICT,
    });
  });

  // ── 11. score validation: out of range ─────────────────────────────────────

  it('score < 0 → BusinessException(1001)', async () => {
    const draft = makeScore({ status: 'draft' });
    repo.findByUid.mockResolvedValue(draft);

    await expect(
      service.submitScore('sc_abc12345', 'ou_leader', { score: -0.1, version: 1 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.INVALID_PARAMS,
    });
  });

  it('score > 1 → BusinessException(1001)', async () => {
    const draft = makeScore({ status: 'draft' });
    repo.findByUid.mockResolvedValue(draft);

    await expect(
      service.submitScore('sc_abc12345', 'ou_leader', { score: 1.1, version: 1 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.INVALID_PARAMS,
    });
  });

  // ── 12. scored → pending_lock (PMO/Boss skips challenge) ──────────────────

  it('PMO can lock directly from scored state → status locked', async () => {
    const scored = makeScore({ status: 'scored', score: '0.8', version: 2 });
    repo.findByUid.mockResolvedValue(scored);
    repo.findRolesByUserId.mockResolvedValue([{ role: UserRole.PMO }]);
    repo.updateField.mockResolvedValue({
      ...scored,
      status: 'locked',
      lockedAt: new Date(),
      lockedBy: 'ou_pmo',
    });

    const result = await service.lockScore('sc_abc12345', 'ou_pmo', UserRole.PMO);

    expect(result.status).toBe('locked');
    const updateArg = repo.updateField.mock.calls[0][1];
    expect(updateArg.status).toBe('locked');
  });

  // ── 13. getContext aggregates snapshot + prev score + incidents + projects ─

  it('getContext returns aggregated context for a score record', async () => {
    const scored = makeScore({ status: 'scored', score: '0.8', snapshotRef: 'snap_001' });
    repo.findByUid.mockResolvedValue(scored);
    repo.getContext.mockResolvedValue({
      score: scored,
      snapshot: {
        doneRate: '75%',
        monthDoneCount: 9,
        monthDueCount: 12,
        monthOverdueCount: 2,
        monthCarryOverCount: 1,
      },
      prevScore: {
        score: 1.0,
        status: 'locked',
        scoreMonth: '2026-03',
      },
      incidents: [],
      picProjects: [
        { projectUid: 'proj_001', name: 'XT India', category: 'zy', region: '印度' },
      ],
    });

    const ctx = await service.getContext('sc_abc12345', 'ou_leader', UserRole.LEADER);

    expect(ctx.score.scoreUid).toBe('sc_abc12345');
    expect(ctx.snapshot?.doneRate).toBe('75%');
    expect(ctx.prevScore?.score).toBe(1.0);
    expect(ctx.picProjects).toHaveLength(1);
    expect(ctx.picProjects[0].name).toBe('XT India');
  });

  // ── 14. challenged record cannot be scored (wrong source status) ──────────

  it('submitScore on challenged status is rejected → BusinessException(1002)', async () => {
    const challenged = makeScore({ status: 'challenged' });
    repo.findByUid.mockResolvedValue(challenged);

    await expect(
      service.submitScore('sc_abc12345', 'ou_leader', { score: 0.8, version: 2 }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.UNAUTHORIZED,
      status: HttpStatus.FORBIDDEN,
    });
  });

  // Note: spec says rater can modify score when status = challenged (via resolveChallenge).
  // submitScore only handles draft state. challenged state uses resolveChallenge.

  // ── 15. listScores: leader sees only their ratee rows ─────────────────────

  it('listScores passes rater 双候选 filter for leader role（JWT user_id + open_id）', async () => {
    repo.listByMonth.mockResolvedValue({ items: [], total: 0 });

    await service.listScores('emp_10001', UserRole.LEADER, { month: '2026-04' }, 1, 20, 'ou_leader');

    const listArg = repo.listByMonth.mock.calls[0][0];
    expect(listArg.raterUserIds).toEqual(['emp_10001', 'ou_leader']);
    expect(listArg.rateeUserIds).toBeUndefined();
  });

  it('listScores passes ratee 双候选 filter for employee role；无 open_id 时单候选', async () => {
    repo.listByMonth.mockResolvedValue({ items: [], total: 0 });

    await service.listScores('ou_emp', UserRole.EMPLOYEE, { month: '2026-04' }, 1, 20);

    const listArg = repo.listByMonth.mock.calls[0][0];
    expect(listArg.rateeUserIds).toEqual(['ou_emp']);
    expect(listArg.raterUserIds).toBeUndefined();
  });

  it('listScores passes no user filter for boss/pmo (sees all)', async () => {
    repo.listByMonth.mockResolvedValue({ items: [], total: 0 });

    await service.listScores('ou_boss', UserRole.BOSS, { month: '2026-04' }, 1, 20);

    const listArg = repo.listByMonth.mock.calls[0][0];
    expect(listArg.raterUserId).toBeUndefined();
    expect(listArg.rateeUserId).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // V1.4 多维系数制（spec §3.2 §4）
  // ═══════════════════════════════════════════════════════════════════════════

  describe('V1.4 多维系数打分', () => {
    // ── 计算正确性：total = Σ(系数×权重)，composite = total/100，自动评级 ──────
    it('rater 提交多维系数 → 用 domain-core 算 total/composite/grade 并写明细', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee', score: null });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());
      repo.submitDetailedScore.mockResolvedValue({ ...draft, status: 'scored', totalScore: '91.5', grade: 'A', version: 2 });

      const result = await service.submitScore('sc_abc12345', 'ou_leader', {
        // 1.0×15 + 0.9×85 = 15 + 76.5 = 91.5 → composite 0.92 → A（90–100）
        details: [
          { dimension_code: 'workload', coefficient: 1.0 },
          { dimension_code: 'delivery', coefficient: 0.9 },
        ],
        version: 1,
      });

      expect(repo.submitDetailedScore).toHaveBeenCalledOnce();
      const [uid, ver, mainValues, detailRows] = repo.submitDetailedScore.mock.calls[0];
      expect(uid).toBe('sc_abc12345');
      expect(ver).toBe(1);
      expect(mainValues).toMatchObject({ totalScore: '91.5', composite: '0.92', grade: 'A', redLine: false, status: 'scored' });
      expect(detailRows).toHaveLength(2);
      const workload = detailRows.find((d: any) => d.dimensionCode === 'workload');
      expect(workload).toMatchObject({ weight: '15.00', coefficient: '1.00', weighted: '15.00' });
      const delivery = detailRows.find((d: any) => d.dimensionCode === 'delivery');
      expect(delivery).toMatchObject({ weight: '85.00', coefficient: '0.90', weighted: '76.50' });
      expect(result.status).toBe('scored');
      // 无红线 → 不发通知
      expect(messenger.sendTextToUser).not.toHaveBeenCalled();
    });

    it('total>100 → 评级 S；updateWithVersion(旧单值路径) 不被调用', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee', score: null });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());
      repo.submitDetailedScore.mockResolvedValue({ ...draft, status: 'scored', version: 2 });

      await service.submitScore('sc_abc12345', 'ou_leader', {
        // 1.5×15 + 1.2×85 = 22.5 + 102 = 124.5 → S
        details: [
          { dimension_code: 'workload', coefficient: 1.5 },
          { dimension_code: 'delivery', coefficient: 1.2 },
        ],
        version: 1,
      });

      const mainValues = repo.submitDetailedScore.mock.calls[0][2];
      expect(mainValues.grade).toBe('S');
      expect(mainValues.totalScore).toBe('124.5');
      expect(repo.updateWithVersion).not.toHaveBeenCalled();
    });

    // ── 维度必须与模板完全一致（多/少/重复都拒）────────────────────────────
    it('缺维度 → INVALID_PARAMS 且不写库', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [{ dimension_code: 'workload', coefficient: 1.0 }],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
      expect(repo.submitDetailedScore).not.toHaveBeenCalled();
    });

    it('多出模板外维度 → INVALID_PARAMS', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [
            { dimension_code: 'workload', coefficient: 1.0 },
            { dimension_code: 'delivery', coefficient: 0.9 },
            { dimension_code: 'ghost', coefficient: 1.0 },
          ],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
      expect(repo.submitDetailedScore).not.toHaveBeenCalled();
    });

    it('重复维度 → INVALID_PARAMS', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [
            { dimension_code: 'workload', coefficient: 1.0 },
            { dimension_code: 'workload', coefficient: 0.9 },
          ],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
      expect(repo.submitDetailedScore).not.toHaveBeenCalled();
    });

    // ── 系数上下限（>0 且 ≤5）────────────────────────────────────────────────
    it('系数 ≤0 → INVALID_PARAMS', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [
            { dimension_code: 'workload', coefficient: 0 },
            { dimension_code: 'delivery', coefficient: 0.9 },
          ],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    it('系数 >5（手滑上限）→ INVALID_PARAMS', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [
            { dimension_code: 'workload', coefficient: 5.1 },
            { dimension_code: 'delivery', coefficient: 0.9 },
          ],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });

    // ── 红线 ─────────────────────────────────────────────────────────────────
    it('红线勾选但无说明 → INVALID_PARAMS', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [
            { dimension_code: 'workload', coefficient: 1.0 },
            { dimension_code: 'delivery', coefficient: 0.9 },
          ],
          red_line: true,
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
      expect(repo.submitDetailedScore).not.toHaveBeenCalled();
    });

    it('红线勾选 + 说明 → 强制 D 且通知 boss/hr', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee', rateeName: '张三' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());
      repo.submitDetailedScore.mockResolvedValue({ ...draft, status: 'scored', grade: 'D', redLine: true, version: 2 });
      repo.findRedLineRecipients.mockResolvedValue(['ou_boss', 'ou_hr']);

      const result = await service.submitScore('sc_abc12345', 'ou_leader', {
        // 即便算出高分，红线也强制 D
        details: [
          { dimension_code: 'workload', coefficient: 1.0 },
          { dimension_code: 'delivery', coefficient: 1.0 },
        ],
        red_line: true,
        red_line_note: '重大合规事故',
        version: 1,
      });

      const mainValues = repo.submitDetailedScore.mock.calls[0][2];
      expect(mainValues.grade).toBe('D');
      expect(mainValues.redLine).toBe(true);
      expect(mainValues.redLineNote).toBe('重大合规事故');
      expect(result.status).toBe('scored');
      // 通知两名收件人
      expect(messenger.sendTextToUser).toHaveBeenCalledTimes(2);
      expect(messenger.sendTextToUser.mock.calls.map((c) => c[0]).sort()).toEqual(['ou_boss', 'ou_hr']);
    });

    it('红线通知发送失败只 warn，不影响打分结果', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());
      repo.submitDetailedScore.mockResolvedValue({ ...draft, status: 'scored', grade: 'D', redLine: true, version: 2 });
      repo.findRedLineRecipients.mockResolvedValue(['ou_boss']);
      messenger.sendTextToUser.mockRejectedValue(new Error('feishu down'));

      const result = await service.submitScore('sc_abc12345', 'ou_leader', {
        details: [
          { dimension_code: 'workload', coefficient: 1.0 },
          { dimension_code: 'delivery', coefficient: 0.9 },
        ],
        red_line: true,
        red_line_note: 'x',
        version: 1,
      });

      expect(result.status).toBe('scored'); // 打分成功
    });

    // ── 兼容/边界 ──────────────────────────────────────────────────────────
    it('对无 template_uid 的旧行提交 details → INVALID_PARAMS（旧行不支持多维）', async () => {
      const oldRow = makeScore({ status: 'draft', version: 1, templateUid: null });
      repo.findByUid.mockResolvedValue(oldRow);

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [{ dimension_code: 'workload', coefficient: 1.0 }],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
      expect(repo.submitDetailedScore).not.toHaveBeenCalled();
    });

    it('非 rater 提交多维 → UNAUTHORIZED 且不写库', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);

      await expect(
        service.submitScore('sc_abc12345', 'ou_intruder', {
          details: [
            { dimension_code: 'workload', coefficient: 1.0 },
            { dimension_code: 'delivery', coefficient: 0.9 },
          ],
          version: 1,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED });
      expect(repo.submitDetailedScore).not.toHaveBeenCalled();
    });

    it('V1.4 OCC 版本冲突 → VERSION_CONFLICT', async () => {
      const draft = makeScore({ status: 'draft', version: 5, templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(draft);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());
      repo.submitDetailedScore.mockResolvedValue(null); // 无行更新 = 版本不匹配

      await expect(
        service.submitScore('sc_abc12345', 'ou_leader', {
          details: [
            { dimension_code: 'workload', coefficient: 1.0 },
            { dimension_code: 'delivery', coefficient: 0.9 },
          ],
          version: 3,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.VERSION_CONFLICT });
    });

    it('legacy 单值路径（无 details）仍走 updateWithVersion 写 score 列', async () => {
      const draft = makeScore({ status: 'draft', version: 1, templateUid: null });
      repo.findByUid.mockResolvedValue(draft);
      repo.updateWithVersion.mockResolvedValue({ ...draft, score: '0.8', status: 'scored', version: 2 });

      await service.submitScore('sc_abc12345', 'ou_leader', { score: 0.8, version: 1 });

      expect(repo.updateWithVersion).toHaveBeenCalledOnce();
      expect(repo.submitDetailedScore).not.toHaveBeenCalled();
      expect(repo.updateWithVersion.mock.calls[0][2]).toMatchObject({ score: '0.8', status: 'scored' });
    });
  });

  // ── getTemplate ─────────────────────────────────────────────────────────
  describe('getTemplate', () => {
    it('有 template_uid 的行 → 返回模板+维度', async () => {
      const row = makeScore({ templateUid: 'spt_monthly_employee' });
      repo.findByUid.mockResolvedValue(row);
      repo.findTemplateWithDimensions.mockResolvedValue(makeEmployeeTemplate());

      const tpl = await service.getTemplate('sc_abc12345', 'ou_leader', UserRole.LEADER, 'ou_leader');

      expect(tpl).not.toBeNull();
      expect(tpl!.dimensions).toHaveLength(2);
      expect(repo.findTemplateWithDimensions).toHaveBeenCalledWith('spt_monthly_employee');
    });

    it('无 template_uid 的旧行 → 返回 null', async () => {
      const row = makeScore({ templateUid: null });
      repo.findByUid.mockResolvedValue(row);

      const tpl = await service.getTemplate('sc_abc12345', 'ou_leader', UserRole.LEADER, 'ou_leader');

      expect(tpl).toBeNull();
      expect(repo.findTemplateWithDimensions).not.toHaveBeenCalled();
    });

    it('无权限查看该行 → FORBIDDEN', async () => {
      const row = makeScore({ templateUid: 'spt_monthly_employee', rateeUserId: 'ou_x', raterUserId: 'ou_y' });
      repo.findByUid.mockResolvedValue(row);
      repo.findPerfRole.mockResolvedValue(null);

      await expect(
        service.getTemplate('sc_abc12345', 'ou_stranger', UserRole.EMPLOYEE, 'ou_stranger'),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
    });
  });

  // ── 可见性放宽：perf_role.is_leader / is_management 可读任意行 ──────────────
  describe('可见性放宽（V1.4 其他 leader 可看）', () => {
    it('perf_role.is_leader 的旁观者可 getScore 任意行', async () => {
      const row = makeScore({ rateeUserId: 'ou_x', raterUserId: 'ou_y' });
      repo.findByUid.mockResolvedValue(row);
      repo.findPerfRole.mockResolvedValue({ isLeader: true, isManagement: false });

      const result = await service.getScore('sc_abc12345', 'ou_other_leader', UserRole.EMPLOYEE, 'ou_other_leader');
      expect(result.scoreUid).toBe('sc_abc12345');
    });

    it('perf_role.is_management 的旁观者可 getScore 任意行', async () => {
      const row = makeScore({ rateeUserId: 'ou_x', raterUserId: 'ou_y' });
      repo.findByUid.mockResolvedValue(row);
      repo.findPerfRole.mockResolvedValue({ isLeader: false, isManagement: true });

      const result = await service.getScore('sc_abc12345', 'ou_mgmt', UserRole.EMPLOYEE, 'ou_mgmt');
      expect(result.scoreUid).toBe('sc_abc12345');
    });

    it('既非 rater/ratee 也无 perf_role 身份 → FORBIDDEN', async () => {
      const row = makeScore({ rateeUserId: 'ou_x', raterUserId: 'ou_y' });
      repo.findByUid.mockResolvedValue(row);
      repo.findPerfRole.mockResolvedValue(null);

      await expect(
        service.getScore('sc_abc12345', 'ou_stranger', UserRole.EMPLOYEE, 'ou_stranger'),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED, status: HttpStatus.FORBIDDEN });
    });

    it('listScores：perf_role.is_leader 旁观者不加 user 过滤（看全员）', async () => {
      repo.findPerfRole.mockResolvedValue({ isLeader: true, isManagement: false });
      repo.listByMonth.mockResolvedValue({ items: [], total: 0 });

      await service.listScores('ou_leaderX', UserRole.EMPLOYEE, { month: '2026-04' }, 1, 20, 'ou_leaderX');

      const listArg = repo.listByMonth.mock.calls[0][0];
      expect(listArg.raterUserIds).toBeUndefined();
      expect(listArg.rateeUserIds).toBeUndefined();
    });
  });
});
