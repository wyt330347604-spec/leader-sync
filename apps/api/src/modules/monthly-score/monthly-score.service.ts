import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { MonthlyScoreRepository, ScoreListFilter, ScoreContext } from './monthly-score.repository';
import type { UpdateScoreDto } from './dto/update-score.dto';
import type { ChallengeScoreDto } from './dto/challenge-score.dto';
import { ErrorCode, UserRole, PaginatedData } from '@leader-sync/shared-types';

// ── State machine constants ────────────────────────────────────────────────────

export type ScoreStatus =
  | 'draft'
  | 'scored'
  | 'challenged'
  | 'pending_lock'
  | 'locked';

const LOCKED_STATUS: ScoreStatus = 'locked';

/** Roles that can lock a score (PMO/Boss skip challenge). */
const LOCK_ALLOWED_ROLES = new Set<string>([UserRole.PMO, UserRole.BOSS, UserRole.ADMIN]);

/** Roles that can read any score (PMO/Boss/Admin)。 */
const VIEW_ALL_ROLES = new Set<string>([UserRole.PMO, UserRole.BOSS, UserRole.ADMIN]);

/** Source statuses from which PMO/Boss can lock directly. */
const LOCKABLE_STATUSES = new Set<ScoreStatus>(['scored', 'pending_lock']);

/** 是否有权查看该分：被评人(ratee)、评分人(rater) 或 PMO/Boss/Admin。 */
function canViewScore(
  s: { rateeUserId: string; raterUserId: string },
  userId: string,
  role: string,
): boolean {
  if (VIEW_ALL_ROLES.has(role)) return true;
  return s.rateeUserId === userId || s.raterUserId === userId;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class MonthlyScoreService {
  private readonly logger = new Logger(MonthlyScoreService.name);

  constructor(private readonly repo: MonthlyScoreRepository) {}

  // ── LIST ──────────────────────────────────────────────────────────────────

  async listScores(
    viewerUserId: string,
    viewerRole: string,
    filter: { month?: string },
    page: number,
    pageSize: number,
  ): Promise<PaginatedData<unknown>> {
    const repoFilter: ScoreListFilter = {
      month: filter.month,
    };

    if (viewerRole === UserRole.LEADER) {
      repoFilter.raterUserId = viewerUserId;
    } else if (viewerRole === UserRole.EMPLOYEE) {
      repoFilter.rateeUserId = viewerUserId;
    }
    // PMO / Boss / Admin: no filter → see all

    const { items, total } = await this.repo.listByMonth(repoFilter, page, pageSize);
    return { items, total, page, page_size: pageSize };
  }

  // ── GET ONE ───────────────────────────────────────────────────────────────

  async getScore(scoreUid: string, viewerUserId: string, viewerRole: string) {
    const found = await this.repo.findByUid(scoreUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.TASK_NOT_FOUND,
        'Score not found',
        HttpStatus.NOT_FOUND,
      );
    }
    // 行级安全：仅 被评人/评分人/PMO·Boss·Admin 可读，与 list 口径一致。
    if (!canViewScore(found, viewerUserId, viewerRole)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'No permission to view this score',
        HttpStatus.FORBIDDEN,
      );
    }
    return found;
  }

  // ── SUBMIT SCORE (draft → scored) ─────────────────────────────────────────

  async submitScore(
    scoreUid: string,
    requestorUserId: string,
    dto: UpdateScoreDto,
  ) {
    const found = await this.requireScore(scoreUid);

    // Hard guard: locked records are immutable
    this.requireNotLocked(found);

    // Only draft status is valid for submitScore
    if (found.status !== 'draft') {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Score can only be submitted from draft status. Use resolveChallenge for challenged status.',
        HttpStatus.FORBIDDEN,
      );
    }

    // Permission: only the rater can score
    if (found.raterUserId !== requestorUserId) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Only the rater (direct leader) can submit this score',
        HttpStatus.FORBIDDEN,
      );
    }

    // Validate score range
    this.validateScoreRange(dto.score);

    const updated = await this.repo.updateWithVersion(scoreUid, dto.version, {
      score: dto.score.toFixed(1),
      status: 'scored',
      updatedBy: requestorUserId,
    });

    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict — please refresh and retry',
        HttpStatus.CONFLICT,
      );
    }

    return updated;
  }

  // ── CHALLENGE SCORE (scored → challenged) ─────────────────────────────────

  async challengeScore(
    scoreUid: string,
    requestorUserId: string,
    dto: ChallengeScoreDto,
  ) {
    const found = await this.requireScore(scoreUid);

    // Locked records cannot be challenged
    if (found.status === LOCKED_STATUS) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Cannot challenge a locked score',
        HttpStatus.FORBIDDEN,
      );
    }

    // Must be in scored status
    if (found.status !== 'scored') {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Only scored records can be challenged',
        HttpStatus.FORBIDDEN,
      );
    }

    // 权限：仅被评人(ratee)可申诉自己的分。
    if (found.rateeUserId !== requestorUserId) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Only the ratee can challenge this score',
        HttpStatus.FORBIDDEN,
      );
    }

    const now = new Date();
    // 乐观锁：版本不匹配（并发）→ 冲突。
    const updated = await this.repo.updateWithVersion(scoreUid, dto.version, {
      status: 'challenged',
      challengeNote: dto.challenge_note ?? null,
      challengedAt: now,
      updatedBy: requestorUserId,
    });

    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict — please refresh and retry',
        HttpStatus.CONFLICT,
      );
    }

    return updated;
  }

  // ── RESOLVE CHALLENGE (challenged → pending_lock) ──────────────────────────

  async resolveChallenge(
    scoreUid: string,
    requestorUserId: string,
    dto: UpdateScoreDto,
  ) {
    const found = await this.requireScore(scoreUid);

    // Hard guard: locked records are immutable
    this.requireNotLocked(found);

    if (found.status !== 'challenged') {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Can only resolve a challenged score',
        HttpStatus.FORBIDDEN,
      );
    }

    // Permission: only the rater can resolve
    if (found.raterUserId !== requestorUserId) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Only the rater (direct leader) can resolve this challenge',
        HttpStatus.FORBIDDEN,
      );
    }

    // Validate score range
    this.validateScoreRange(dto.score);

    const now = new Date();
    const updated = await this.repo.updateWithVersion(scoreUid, dto.version, {
      score: dto.score.toFixed(1),
      status: 'pending_lock',
      resolvedAt: now,
      updatedBy: requestorUserId,
    });

    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict — please refresh and retry',
        HttpStatus.CONFLICT,
      );
    }

    return updated;
  }

  // ── LOCK SCORE (scored|pending_lock → locked) ──────────────────────────────

  async lockScore(
    scoreUid: string,
    requestorUserId: string,
    requestorRole: string,
  ) {
    const found = await this.requireScore(scoreUid);

    // Hard guard: already locked
    this.requireNotLocked(found);

    // Permission: only PMO / Boss / Admin can lock
    if (!LOCK_ALLOWED_ROLES.has(requestorRole)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Only PMO or Boss can lock a score',
        HttpStatus.FORBIDDEN,
      );
    }

    // Must be in a lockable status
    if (!LOCKABLE_STATUSES.has(found.status as ScoreStatus)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        `Cannot lock a score in '${found.status}' status. Must be scored or pending_lock.`,
        HttpStatus.FORBIDDEN,
      );
    }

    const now = new Date();
    const updated = await this.repo.updateField(scoreUid, {
      status: 'locked',
      lockedAt: now,
      lockedBy: requestorUserId,
      updatedBy: requestorUserId,
    });

    return updated;
  }

  // ── GET CONTEXT ───────────────────────────────────────────────────────────

  async getContext(
    scoreUid: string,
    requestorUserId: string,
    requestorRole: string,
  ): Promise<ScoreContext> {
    const ctx = await this.repo.getContext(scoreUid);
    if (!ctx) {
      throw new BusinessException(
        ErrorCode.TASK_NOT_FOUND,
        'Score not found',
        HttpStatus.NOT_FOUND,
      );
    }
    // 行级安全：仅 被评人/评分人/PMO·Boss·Admin 可读上下文。
    if (!canViewScore(ctx.score, requestorUserId, requestorRole)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'No permission to view this score context',
        HttpStatus.FORBIDDEN,
      );
    }
    return ctx;
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────

  private async requireScore(scoreUid: string) {
    const found = await this.repo.findByUid(scoreUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.TASK_NOT_FOUND,
        'Score not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return found;
  }

  private requireNotLocked(score: { status: string }) {
    if (score.status === LOCKED_STATUS) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'This score is locked and cannot be modified',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private validateScoreRange(score: number) {
    if (score < 0 || score > 1) {
      throw new BusinessException(
        ErrorCode.INVALID_PARAMS,
        'Score must be between 0.0 and 1.0',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
