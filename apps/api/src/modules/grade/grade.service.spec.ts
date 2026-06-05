/**
 * grade.service.spec.ts
 *
 * TDD spec for GradeService.
 * All external dependencies (repository) are mocked — no DB required.
 *
 * Coverage scenarios:
 *  1. setGrade — valid grade T5.2 with initial_entry → creates grade_history + updates org_cache
 *  2. setGrade — invalid format T9.0 → throws GRADE_INVALID_FORMAT
 *  3. setGrade — invalid format S5.2 → throws GRADE_INVALID_FORMAT
 *  4. setGrade — invalid format T4.4 → throws GRADE_INVALID_FORMAT (minor > 3)
 *  5. setGrade — prev_grade is NULL for first grade entry (no existing grade)
 *  6. setGrade — prev_grade set to current grade when employee already has a grade
 *  7. setGrade — manual_adjustment without note → throws INVALID_PARAMS
 *  8. getCurrentGrade — user has grade → returns current grade data
 *  9. getCurrentGrade — user not found → throws GRADE_NOT_FOUND
 * 10. getCurrentGrade — employee accessing own grade → 200
 * 11. getCurrentGrade — employee accessing other's grade → throws GRADE_PERMISSION_DENIED
 * 12. getCurrentGrade — leader accessing direct subordinate → 200
 * 13. getCurrentGrade — leader accessing non-subordinate → throws GRADE_PERMISSION_DENIED
 * 14. getCurrentGrade — boss accessing any user → 200
 * 15. getGradeHistory — returns ordered history records
 * 16. getGradeOverview — boss can access all-employee overview
 * 17. getGradeOverview — employee role → throws GRADE_PERMISSION_DENIED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { GradeService } from './grade.service';
import { GradeRepository } from './grade.repository';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode, GradeTriggerType, UserRole } from '@leader-sync/shared-types';

// ─── Mock factory ────────────────────────────────────────────────────────────

function createMockRepo(): Record<keyof GradeRepository, ReturnType<typeof vi.fn>> {
  return {
    findOrgUser: vi.fn(),
    findOrgUserByManagerId: vi.fn(),
    insertGradeHistory: vi.fn(),
    updateOrgCacheGrade: vi.fn(),
    findLatestGradeByUserId: vi.fn(),
    listGradeHistoryByUserId: vi.fn(),
    listAllCurrentGrades: vi.fn(),
  };
}

function makeFakeOrgUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 'ou_dev_alice',
    openId: 'ou_dev_alice',
    userName: '张三',
    deptId: 'dept_001',
    deptName: '研发部',
    managerUserId: 'ou_dev_harvey',
    managerName: 'Harvey',
    currentGrade: null,
    syncedAt: new Date(),
    ...overrides,
  };
}

function makeFakeGradeHistory(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    recordUid: 'gh_test001',
    userId: 'ou_dev_alice',
    grade: 'T5.2',
    prevGrade: null,
    changedAt: new Date('2026-05-24T10:00:00Z'),
    changedBy: 'ou_dev_boss',
    triggerType: GradeTriggerType.INITIAL_ENTRY,
    scoreSnapshot: null,
    note: null,
    createdAt: new Date('2026-05-24T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GradeService', () => {
  let service: GradeService;
  let repo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new GradeService(repo as unknown as GradeRepository);
    vi.clearAllMocks();
  });

  // ── setGrade ─────────────────────────────────────────────────────────────

  describe('setGrade', () => {
    it('valid grade T5.2 with initial_entry creates grade_history record and updates org_cache', async () => {
      const orgUser = makeFakeOrgUser({ currentGrade: null });
      repo.findOrgUser.mockResolvedValue(orgUser);
      repo.insertGradeHistory.mockResolvedValue(
        makeFakeGradeHistory({ grade: 'T5.2', prevGrade: null }),
      );
      repo.updateOrgCacheGrade.mockResolvedValue(undefined);

      const result = await service.setGrade('ou_dev_boss', 'ou_dev_alice', {
        grade: 'T5.2',
        trigger_type: GradeTriggerType.INITIAL_ENTRY,
      });

      expect(repo.insertGradeHistory).toHaveBeenCalledOnce();
      const insertCall = repo.insertGradeHistory.mock.calls[0][0];
      expect(insertCall.grade).toBe('T5.2');
      expect(insertCall.prevGrade).toBeNull();
      expect(insertCall.triggerType).toBe(GradeTriggerType.INITIAL_ENTRY);
      expect(insertCall.changedBy).toBe('ou_dev_boss');

      expect(repo.updateOrgCacheGrade).toHaveBeenCalledWith('ou_dev_alice', 'T5.2');
      expect(result.grade).toBe('T5.2');
    });

    it('invalid grade format T9.0 throws GRADE_INVALID_FORMAT', async () => {
      await expect(
        service.setGrade('ou_dev_boss', 'ou_dev_alice', {
          grade: 'T9.0',
          trigger_type: GradeTriggerType.INITIAL_ENTRY,
        }),
      ).rejects.toThrow(BusinessException);

      await expect(
        service.setGrade('ou_dev_boss', 'ou_dev_alice', {
          grade: 'T9.0',
          trigger_type: GradeTriggerType.INITIAL_ENTRY,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.GRADE_INVALID_FORMAT });
    });

    it('invalid grade format S5.2 throws GRADE_INVALID_FORMAT', async () => {
      await expect(
        service.setGrade('ou_dev_boss', 'ou_dev_alice', {
          grade: 'S5.2',
          trigger_type: GradeTriggerType.INITIAL_ENTRY,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.GRADE_INVALID_FORMAT });
    });

    it('invalid grade T4.4 (minor > 3) throws GRADE_INVALID_FORMAT', async () => {
      await expect(
        service.setGrade('ou_dev_boss', 'ou_dev_alice', {
          grade: 'T4.4',
          trigger_type: GradeTriggerType.INITIAL_ENTRY,
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.GRADE_INVALID_FORMAT });
    });

    it('sets prev_grade to null when employee has no existing grade', async () => {
      const orgUser = makeFakeOrgUser({ currentGrade: null });
      repo.findOrgUser.mockResolvedValue(orgUser);
      repo.insertGradeHistory.mockResolvedValue(makeFakeGradeHistory());
      repo.updateOrgCacheGrade.mockResolvedValue(undefined);

      await service.setGrade('ou_dev_boss', 'ou_dev_alice', {
        grade: 'T4.0',
        trigger_type: GradeTriggerType.INITIAL_ENTRY,
      });

      const insertCall = repo.insertGradeHistory.mock.calls[0][0];
      expect(insertCall.prevGrade).toBeNull();
    });

    it('sets prev_grade to current grade when employee already has a grade', async () => {
      const orgUser = makeFakeOrgUser({ currentGrade: 'T5.0' });
      repo.findOrgUser.mockResolvedValue(orgUser);
      repo.insertGradeHistory.mockResolvedValue(
        makeFakeGradeHistory({ grade: 'T5.2', prevGrade: 'T5.0' }),
      );
      repo.updateOrgCacheGrade.mockResolvedValue(undefined);

      await service.setGrade('ou_dev_boss', 'ou_dev_alice', {
        grade: 'T5.2',
        trigger_type: GradeTriggerType.BIANNUAL_PROMOTION,
      });

      const insertCall = repo.insertGradeHistory.mock.calls[0][0];
      expect(insertCall.prevGrade).toBe('T5.0');
    });

    it('manual_adjustment without note throws INVALID_PARAMS', async () => {
      await expect(
        service.setGrade('ou_dev_boss', 'ou_dev_alice', {
          grade: 'T5.0',
          trigger_type: GradeTriggerType.MANUAL_ADJUSTMENT,
          // note is intentionally missing
        }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });
    });
  });

  // ── getCurrentGrade ───────────────────────────────────────────────────────

  describe('getCurrentGrade', () => {
    it('employee accessing own grade returns grade data', async () => {
      const orgUser = makeFakeOrgUser({ currentGrade: 'T5.2' });
      repo.findOrgUser.mockResolvedValue(orgUser);

      const result = await service.getCurrentGrade(
        'ou_dev_alice',       // requesterId
        UserRole.EMPLOYEE,    // requesterRole
        'ou_dev_alice',       // targetUserId (self)
      );

      expect(result.current_grade).toBe('T5.2');
      expect(result.user_id).toBe('ou_dev_alice');
    });

    it('user not found throws GRADE_NOT_FOUND', async () => {
      repo.findOrgUser.mockResolvedValue(null);

      await expect(
        service.getCurrentGrade('ou_dev_alice', UserRole.EMPLOYEE, 'ou_nonexistent'),
      ).rejects.toMatchObject({ businessCode: ErrorCode.GRADE_NOT_FOUND });
    });

    it('employee accessing other employee grade throws GRADE_PERMISSION_DENIED', async () => {
      const targetUser = makeFakeOrgUser({
        userId: 'ou_dev_bob',
        managerUserId: 'ou_dev_harvey',
      });
      repo.findOrgUser.mockResolvedValue(targetUser);

      await expect(
        service.getCurrentGrade(
          'ou_dev_alice',       // requester (different user)
          UserRole.EMPLOYEE,
          'ou_dev_bob',         // target (not self)
        ),
      ).rejects.toMatchObject({ businessCode: ErrorCode.GRADE_PERMISSION_DENIED });
    });

    it('leader accessing direct subordinate returns grade data', async () => {
      // target user's managerUserId matches the leader's userId
      const targetUser = makeFakeOrgUser({
        userId: 'ou_dev_alice',
        managerUserId: 'ou_dev_harvey',
        currentGrade: 'T4.2',
      });
      repo.findOrgUser.mockResolvedValue(targetUser);

      const result = await service.getCurrentGrade(
        'ou_dev_harvey',      // requester (leader)
        UserRole.LEADER,
        'ou_dev_alice',       // target (direct subordinate)
      );

      expect(result.current_grade).toBe('T4.2');
    });

    it('leader accessing non-subordinate throws GRADE_PERMISSION_DENIED', async () => {
      // target user's managerUserId is someone else
      const targetUser = makeFakeOrgUser({
        userId: 'ou_dev_carol',
        managerUserId: 'ou_dev_boss', // not ou_dev_harvey
      });
      repo.findOrgUser.mockResolvedValue(targetUser);

      await expect(
        service.getCurrentGrade(
          'ou_dev_harvey',      // requester (leader, but not carol's manager)
          UserRole.LEADER,
          'ou_dev_carol',
        ),
      ).rejects.toMatchObject({ businessCode: ErrorCode.GRADE_PERMISSION_DENIED });
    });

    it('boss can access any employee grade', async () => {
      const targetUser = makeFakeOrgUser({
        userId: 'ou_dev_alice',
        currentGrade: 'T4.1',
      });
      repo.findOrgUser.mockResolvedValue(targetUser);

      const result = await service.getCurrentGrade(
        'ou_dev_boss',
        UserRole.BOSS,
        'ou_dev_alice',
      );

      expect(result.current_grade).toBe('T4.1');
    });
  });

  // ── getGradeHistory ───────────────────────────────────────────────────────

  describe('getGradeHistory', () => {
    it('returns ordered grade history records for a user', async () => {
      const targetUser = makeFakeOrgUser({ userId: 'ou_dev_alice' });
      repo.findOrgUser.mockResolvedValue(targetUser);

      const records = [
        makeFakeGradeHistory({ grade: 'T5.2', prevGrade: 'T5.0', recordUid: 'gh_002' }),
        makeFakeGradeHistory({ grade: 'T5.0', prevGrade: null, recordUid: 'gh_001' }),
      ];
      repo.listGradeHistoryByUserId.mockResolvedValue(records);

      const result = await service.getGradeHistory(
        'ou_dev_boss',
        UserRole.BOSS,
        'ou_dev_alice',
      );

      expect(result).toHaveLength(2);
      expect(result[0].record_uid).toBe('gh_002');
    });
  });

  // ── getGradeOverview ─────────────────────────────────────────────────────

  describe('getGradeOverview', () => {
    it('boss/admin can access grade overview for all employees', async () => {
      const rows = [
        { userId: 'ou_dev_alice', userName: '张三', currentGrade: 'T4.2', deptName: '研发部' },
        { userId: 'ou_dev_bob', userName: '李四', currentGrade: 'T5.0', deptName: '研发部' },
      ];
      repo.listAllCurrentGrades.mockResolvedValue(rows);

      const result = await service.getGradeOverview('ou_dev_boss', UserRole.BOSS);

      expect(result).toHaveLength(2);
      expect(repo.listAllCurrentGrades).toHaveBeenCalledOnce();
    });

    it('employee role accessing grade overview throws GRADE_PERMISSION_DENIED', async () => {
      await expect(
        service.getGradeOverview('ou_dev_alice', UserRole.EMPLOYEE),
      ).rejects.toMatchObject({ businessCode: ErrorCode.GRADE_PERMISSION_DENIED });
    });
  });
});
