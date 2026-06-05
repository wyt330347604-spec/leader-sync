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

  beforeEach(() => {
    repo = createMockRepo();
    service = new MonthlyScoreService(repo as unknown as MonthlyScoreRepository);
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

  it('listScores passes raterUserId filter for leader role', async () => {
    repo.listByMonth.mockResolvedValue({ items: [], total: 0 });

    await service.listScores('ou_leader', UserRole.LEADER, { month: '2026-04' }, 1, 20);

    const listArg = repo.listByMonth.mock.calls[0][0];
    expect(listArg.raterUserId).toBe('ou_leader');
    expect(listArg.rateeUserId).toBeUndefined();
  });

  it('listScores passes rateeUserId filter for employee role', async () => {
    repo.listByMonth.mockResolvedValue({ items: [], total: 0 });

    await service.listScores('ou_emp', UserRole.EMPLOYEE, { month: '2026-04' }, 1, 20);

    const listArg = repo.listByMonth.mock.calls[0][0];
    expect(listArg.rateeUserId).toBe('ou_emp');
    expect(listArg.raterUserId).toBeUndefined();
  });

  it('listScores passes no user filter for boss/pmo (sees all)', async () => {
    repo.listByMonth.mockResolvedValue({ items: [], total: 0 });

    await service.listScores('ou_boss', UserRole.BOSS, { month: '2026-04' }, 1, 20);

    const listArg = repo.listByMonth.mock.calls[0][0];
    expect(listArg.raterUserId).toBeUndefined();
    expect(listArg.rateeUserId).toBeUndefined();
  });
});
