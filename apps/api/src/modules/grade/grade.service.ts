import { Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { GradeRepository } from './grade.repository';
import type { SetGradeDto } from './dto/set-grade.dto';
import {
  ErrorCode,
  GradeTriggerType,
  UserRole,
} from '@leader-sync/shared-types';
import { nanoid } from 'nanoid';

// Regex for valid grade format: T4.0 – T8.3 (20 levels)
const GRADE_REGEX = /^T[4-8]\.[0-3]$/;

// company_id: single-tenant hard-coded value (JWT has no company_id field)
const COMPANY_ID = process.env.COMPANY_ID ?? 'default';

// Roles that may read any employee's grade and write grade changes
const WRITE_ALLOWED_ROLES = new Set<string>([UserRole.BOSS, UserRole.PMO, UserRole.ADMIN]);

// Roles that may read any employee's grade (without being their direct manager)
const READ_ALL_ROLES = new Set<string>([UserRole.BOSS, UserRole.PMO, UserRole.ADMIN]);

function generateGradeHistoryUid(): string {
  return `gh_${nanoid(16)}`;
}

function validateGradeFormat(grade: string): void {
  if (!GRADE_REGEX.test(grade)) {
    throw new BusinessException(
      ErrorCode.GRADE_INVALID_FORMAT,
      `Invalid grade format: "${grade}". Must match T[4-8].[0-3] (e.g. T5.2)`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Check whether requesterId is allowed to READ the grade of targetUserId.
 *
 * Rules (§6 of grade-history-module.md):
 *   - Employee: only themselves
 *   - Leader: only direct subordinates (targetUser.managerUserId === requesterId)
 *   - Boss / PMO / Admin: everyone
 */
function assertReadPermission(
  requesterId: string,
  requesterRole: string,
  targetUserId: string,
  targetManagerUserId: string | null | undefined,
): void {
  // Self-access always allowed
  if (requesterId === targetUserId) return;

  // Privileged roles can see everyone
  if (READ_ALL_ROLES.has(requesterRole)) return;

  // Leaders can see direct subordinates
  if (requesterRole === UserRole.LEADER && targetManagerUserId === requesterId) {
    return;
  }

  throw new BusinessException(
    ErrorCode.GRADE_PERMISSION_DENIED,
    'You do not have permission to view this employee\'s grade',
    HttpStatus.FORBIDDEN,
  );
}

@Injectable()
export class GradeService {
  constructor(private readonly gradeRepository: GradeRepository) {}

  /**
   * Set or update a user's grade.
   * Writes a grade_history record and updates org_cache.current_grade atomically.
   *
   * Permission: boss / pmo / admin only.
   */
  async setGrade(
    changedByUserId: string,
    targetUserId: string,
    dto: SetGradeDto,
  ) {
    // 1. Validate grade format before any DB call
    validateGradeFormat(dto.grade);

    // 2. manual_adjustment requires a note
    if (dto.trigger_type === GradeTriggerType.MANUAL_ADJUSTMENT && !dto.note?.trim()) {
      throw new BusinessException(
        ErrorCode.INVALID_PARAMS,
        'note is required for manual_adjustment trigger type',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Load target user to get current grade (prev_grade)
    const orgUser = await this.gradeRepository.findOrgUser(targetUserId);
    if (!orgUser) {
      throw new BusinessException(
        ErrorCode.GRADE_NOT_FOUND,
        `User ${targetUserId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const prevGrade = (orgUser as Record<string, unknown>).currentGrade as string | null ?? null;

    // 4. Insert grade_history record
    const recordUid = generateGradeHistoryUid();
    const now = new Date();

    const created = await this.gradeRepository.insertGradeHistory({
      recordUid,
      userId: targetUserId,
      grade: dto.grade,
      prevGrade,
      changedAt: now,
      changedBy: changedByUserId,
      triggerType: dto.trigger_type,
      scoreSnapshot: dto.score_snapshot ?? null,
      note: dto.note ?? null,
      createdAt: now,
    });

    // 5. Update org_cache.current_grade
    await this.gradeRepository.updateOrgCacheGrade(targetUserId, dto.grade);

    return created;
  }

  /**
   * Get the current grade for a user.
   * Returns org_cache data including current_grade.
   *
   * Permission: self / direct leader / boss / pmo / admin
   */
  async getCurrentGrade(
    requesterId: string,
    requesterRole: string,
    targetUserId: string,
  ) {
    const orgUser = await this.gradeRepository.findOrgUser(targetUserId);
    if (!orgUser) {
      throw new BusinessException(
        ErrorCode.GRADE_NOT_FOUND,
        `User ${targetUserId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const managerUserId = (orgUser as Record<string, unknown>).managerUserId as string | null ?? null;

    assertReadPermission(requesterId, requesterRole, targetUserId, managerUserId);

    const currentGrade = (orgUser as Record<string, unknown>).currentGrade as string | null ?? null;

    return {
      user_id: (orgUser as Record<string, unknown>).userId as string,
      user_name: (orgUser as Record<string, unknown>).userName as string,
      dept_name: (orgUser as Record<string, unknown>).deptName as string | null,
      manager_user_id: managerUserId,
      manager_name: (orgUser as Record<string, unknown>).managerName as string | null,
      current_grade: currentGrade,
      company_id: COMPANY_ID,
    };
  }

  /**
   * Get the full grade change history for a user.
   * Same read permission rules as getCurrentGrade.
   */
  async getGradeHistory(
    requesterId: string,
    requesterRole: string,
    targetUserId: string,
  ) {
    const orgUser = await this.gradeRepository.findOrgUser(targetUserId);
    if (!orgUser) {
      throw new BusinessException(
        ErrorCode.GRADE_NOT_FOUND,
        `User ${targetUserId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const managerUserId = (orgUser as Record<string, unknown>).managerUserId as string | null ?? null;

    assertReadPermission(requesterId, requesterRole, targetUserId, managerUserId);

    const records = await this.gradeRepository.listGradeHistoryByUserId(targetUserId);

    return records.map((r) => ({
      record_uid: r.recordUid,
      user_id: r.userId,
      grade: r.grade,
      prev_grade: r.prevGrade ?? null,
      changed_at: r.changedAt,
      changed_by: r.changedBy,
      trigger_type: r.triggerType,
      score_snapshot: r.scoreSnapshot ?? null,
      note: r.note ?? null,
    }));
  }

  /**
   * Get grade overview for all employees.
   * Permission: boss / pmo / admin only.
   */
  async getGradeOverview(requesterId: string, requesterRole: string) {
    if (!READ_ALL_ROLES.has(requesterRole)) {
      throw new BusinessException(
        ErrorCode.GRADE_PERMISSION_DENIED,
        'Only boss, pmo, or admin can view the grade overview',
        HttpStatus.FORBIDDEN,
      );
    }

    const rows = await this.gradeRepository.listAllCurrentGrades();

    return rows.map((r) => ({
      user_id: r.userId,
      user_name: r.userName ?? null,
      dept_name: r.deptName ?? null,
      current_grade: r.currentGrade ?? null,
      manager_user_id: r.managerUserId ?? null,
      manager_name: r.managerName ?? null,
    }));
  }
}
