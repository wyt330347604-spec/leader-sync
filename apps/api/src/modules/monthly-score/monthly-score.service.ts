import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { monthlyTotal, monthlyGrade } from '@leader-sync/domain-core';
import { BusinessException } from '../../common/exceptions/business.exception';
import { FeishuMessengerService } from '../../common/feishu/feishu-messenger.service';
import {
  MonthlyScoreRepository,
  ScoreListFilter,
  ScoreContext,
  TemplateWithDimensions,
} from './monthly-score.repository';
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

// ── V1.4 多维系数制常量 ─────────────────────────────────────────────────────
/** 系数须严格 > 0（0 或负值无意义）。 */
const MIN_COEFFICIENT_EXCLUSIVE = 0;
/** 系数上限（防手滑；1.0 以上不封顶但设一个合理护栏，可配置）。 */
const MAX_COEFFICIENT = 5;

/**
 * 身份候选：JWT 的 user_id（OAuth 员工 ID）与 open_id（ou_）是两套命名空间，
 * 而打分记录的 rater/ratee 统一存 ou_ —— 所有身份比对必须双候选任一命中。
 */
function idCandidates(userId: string, openId?: string | null): string[] {
  return [...new Set([userId, openId].filter((x): x is string => Boolean(x)))];
}

function isSameUser(recordId: string, userId: string, openId?: string | null): boolean {
  return recordId === userId || (Boolean(openId) && recordId === openId);
}

/**
 * 直接可见性（同步，无 DB）：被评人(ratee)、评分人(rater) 或 PMO/Boss/Admin。
 * V1.4 放宽的 perf_role.is_leader/is_management 需查库，见 service.canView。
 */
function canViewScoreDirect(
  s: { rateeUserId: string; raterUserId: string },
  userId: string,
  role: string,
  openId?: string | null,
): boolean {
  if (VIEW_ALL_ROLES.has(role)) return true;
  return isSameUser(s.rateeUserId, userId, openId) || isSameUser(s.raterUserId, userId, openId);
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class MonthlyScoreService {
  private readonly logger = new Logger(MonthlyScoreService.name);

  constructor(
    private readonly repo: MonthlyScoreRepository,
    private readonly messenger: FeishuMessengerService,
  ) {}

  /**
   * 完整可见性（含 V1.4 放宽）：直接可见 → 直接放行；否则查 perf_role，
   * is_leader / is_management 可读任意月度分（spec §5）。
   */
  private async canView(
    s: { rateeUserId: string; raterUserId: string },
    userId: string,
    role: string,
    openId?: string | null,
  ): Promise<boolean> {
    if (canViewScoreDirect(s, userId, role, openId)) return true;
    const pr = await this.repo.findPerfRole(idCandidates(userId, openId));
    return Boolean(pr?.isLeader || pr?.isManagement);
  }

  // ── LIST ──────────────────────────────────────────────────────────────────

  async listScores(
    viewerUserId: string,
    viewerRole: string,
    filter: { month?: string },
    page: number,
    pageSize: number,
    viewerOpenId?: string | null,
  ): Promise<PaginatedData<unknown>> {
    const repoFilter: ScoreListFilter = {
      month: filter.month,
    };

    // 可见全员：PMO/Boss/Admin（RBAC）或 perf_role.is_leader/is_management（V1.4 放宽）。
    const pr = await this.repo.findPerfRole(idCandidates(viewerUserId, viewerOpenId));
    const canSeeAll = VIEW_ALL_ROLES.has(viewerRole) || Boolean(pr?.isLeader || pr?.isManagement);

    if (!canSeeAll) {
      if (viewerRole === UserRole.LEADER) {
        repoFilter.raterUserIds = idCandidates(viewerUserId, viewerOpenId);
      } else if (viewerRole === UserRole.EMPLOYEE) {
        repoFilter.rateeUserIds = idCandidates(viewerUserId, viewerOpenId);
      }
    }

    const { items, total } = await this.repo.listByMonth(repoFilter, page, pageSize);
    return { items, total, page, page_size: pageSize };
  }

  // ── GET ONE ───────────────────────────────────────────────────────────────

  async getScore(scoreUid: string, viewerUserId: string, viewerRole: string, viewerOpenId?: string | null) {
    const found = await this.repo.findByUid(scoreUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.TASK_NOT_FOUND,
        'Score not found',
        HttpStatus.NOT_FOUND,
      );
    }
    // 行级安全：被评人/评分人/PMO·Boss·Admin，或 V1.4 放宽的 leader/管理层。
    if (!(await this.canView(found, viewerUserId, viewerRole, viewerOpenId))) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'No permission to view this score',
        HttpStatus.FORBIDDEN,
      );
    }
    return found;
  }

  // ── GET TEMPLATE (V1.4 打分表单模板) ────────────────────────────────────────

  /**
   * 返回该打分行适用的模板 + 维度 + anchors（按行上 template_uid）。
   * 无 template_uid 的旧行返回 null（前端据此渲染单值只读）。
   */
  async getTemplate(
    scoreUid: string,
    viewerUserId: string,
    viewerRole: string,
    viewerOpenId?: string | null,
  ): Promise<TemplateWithDimensions | null> {
    const found = await this.requireScore(scoreUid);
    if (!(await this.canView(found, viewerUserId, viewerRole, viewerOpenId))) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'No permission to view this score template',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!found.templateUid) return null;
    return this.repo.findTemplateWithDimensions(found.templateUid);
  }

  // ── SUBMIT SCORE (draft → scored) ─────────────────────────────────────────

  async submitScore(
    scoreUid: string,
    requestorUserId: string,
    dto: UpdateScoreDto,
    requestorOpenId?: string | null,
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
    if (!isSameUser(found.raterUserId, requestorUserId, requestorOpenId)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Only the rater (direct leader) can submit this score',
        HttpStatus.FORBIDDEN,
      );
    }

    // V1.4 多维系数路径（有 details）；否则走旧单值路径（兼容历史）。
    if (dto.details) {
      return this.applyDetailedScore(found, dto, requestorUserId, 'scored', {});
    }

    // Validate score range（旧单值路径）
    this.requireLegacyScore(dto);
    this.validateScoreRange(dto.score!);

    const updated = await this.repo.updateWithVersion(scoreUid, dto.version, {
      score: dto.score!.toFixed(1),
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
    requestorOpenId?: string | null,
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
    if (!isSameUser(found.rateeUserId, requestorUserId, requestorOpenId)) {
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
    requestorOpenId?: string | null,
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
    if (!isSameUser(found.raterUserId, requestorUserId, requestorOpenId)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Only the rater (direct leader) can resolve this challenge',
        HttpStatus.FORBIDDEN,
      );
    }

    const now = new Date();

    // V1.4 多维系数路径（有 details）；否则走旧单值路径（兼容历史）。
    if (dto.details) {
      return this.applyDetailedScore(found, dto, requestorUserId, 'pending_lock', { resolvedAt: now });
    }

    // Validate score range（旧单值路径）
    this.requireLegacyScore(dto);
    this.validateScoreRange(dto.score!);

    const updated = await this.repo.updateWithVersion(scoreUid, dto.version, {
      score: dto.score!.toFixed(1),
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
    requestorOpenId?: string | null,
  ): Promise<ScoreContext> {
    const ctx = await this.repo.getContext(scoreUid);
    if (!ctx) {
      throw new BusinessException(
        ErrorCode.TASK_NOT_FOUND,
        'Score not found',
        HttpStatus.NOT_FOUND,
      );
    }
    // 行级安全：与 getScore 同口径（含 V1.4 leader/管理层放宽）。
    if (!(await this.canView(ctx.score, requestorUserId, requestorRole, requestorOpenId))) {
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

  /** 旧单值路径必须带 score（无 details 时）。 */
  private requireLegacyScore(dto: UpdateScoreDto) {
    if (dto.score === undefined || dto.score === null) {
      throw new BusinessException(
        ErrorCode.INVALID_PARAMS,
        '请求体缺少 score（单值）或 details（多维系数）',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ── V1.4 多维系数计分 ───────────────────────────────────────────────────────

  /**
   * V1.4 打分：校验维度与模板一致、系数上下限、红线说明 → 用 domain-core 算
   * total/composite/grade → 事务写主行汇总 + 明细。红线触发时通知 boss/hr（失败只 warn）。
   * targetStatus：submitScore=scored / resolveChallenge=pending_lock。
   * 计分数学一律复用 domain-core（monthlyTotal/monthlyGrade），本层不重复实现。
   */
  private async applyDetailedScore(
    found: { scoreUid: string; templateUid: string | null; rateeUserId: string; rateeName: string | null; scoreMonth: string },
    dto: UpdateScoreDto,
    requestorUserId: string,
    targetStatus: ScoreStatus,
    extra: Record<string, unknown>,
  ) {
    if (!found.templateUid) {
      throw new BusinessException(
        ErrorCode.INVALID_PARAMS,
        '此打分行为旧单系数历史行，不支持多维系数提交',
        HttpStatus.BAD_REQUEST,
      );
    }
    const tpl = await this.repo.findTemplateWithDimensions(found.templateUid);
    if (!tpl) {
      throw new BusinessException(
        ErrorCode.INVALID_PARAMS,
        '打分模板不存在或已下线',
        HttpStatus.BAD_REQUEST,
      );
    }

    const details = dto.details!;
    const templateCodes = new Set(tpl.dimensions.map((d) => d.code));

    // 1. 维度必须与模板完全一致（多 / 少 / 重复都拒）
    const seen = new Set<string>();
    for (const d of details) {
      if (!templateCodes.has(d.dimension_code)) {
        throw new BusinessException(
          ErrorCode.INVALID_PARAMS,
          `维度 ${d.dimension_code} 不属于该打分模板`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (seen.has(d.dimension_code)) {
        throw new BusinessException(
          ErrorCode.INVALID_PARAMS,
          `维度 ${d.dimension_code} 重复提交`,
          HttpStatus.BAD_REQUEST,
        );
      }
      seen.add(d.dimension_code);
    }
    if (seen.size !== templateCodes.size) {
      throw new BusinessException(
        ErrorCode.INVALID_PARAMS,
        '维度不完整：必须为模板全部维度各打一个系数',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2. 系数上下限：> 0 且 ≤ MAX_COEFFICIENT
    for (const d of details) {
      if (
        !Number.isFinite(d.coefficient) ||
        d.coefficient <= MIN_COEFFICIENT_EXCLUSIVE ||
        d.coefficient > MAX_COEFFICIENT
      ) {
        throw new BusinessException(
          ErrorCode.INVALID_PARAMS,
          `系数须大于 0 且不超过 ${MAX_COEFFICIENT}（维度 ${d.dimension_code}）`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 3. 红线：勾选必填说明
    const redLine = dto.red_line === true;
    const redLineNote = dto.red_line_note?.trim() || null;
    if (redLine && !redLineNote) {
      throw new BusinessException(
        ErrorCode.INVALID_PARAMS,
        '触发红线必须填写说明',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. 计分（domain-core 纯函数，权重取模板快照）
    const weightByCode = new Map(tpl.dimensions.map((d) => [d.code, Number(d.weight)]));
    const nameByCode = new Map(tpl.dimensions.map((d) => [d.code, d.name]));
    const { total, composite } = monthlyTotal(
      details.map((d) => ({ coefficient: d.coefficient, weight: weightByCode.get(d.dimension_code)! })),
    );
    const grade = monthlyGrade(total, redLine);

    // 5. 明细行（权重打分时快照；weighted = 系数 × 权重）
    const detailRows = details.map((d) => {
      const weight = weightByCode.get(d.dimension_code)!;
      return {
        detailUid: `msd_${nanoid(16)}`,
        scoreUid: found.scoreUid,
        dimensionCode: d.dimension_code,
        dimensionName: nameByCode.get(d.dimension_code) ?? null,
        weight: weight.toFixed(2),
        coefficient: d.coefficient.toFixed(2),
        weighted: (d.coefficient * weight).toFixed(2),
      };
    });

    const mainValues = {
      totalScore: total.toFixed(1),
      composite: composite.toFixed(2),
      grade,
      redLine,
      redLineNote,
      status: targetStatus,
      updatedBy: requestorUserId,
      ...extra,
    };

    const updated = await this.repo.submitDetailedScore(found.scoreUid, dto.version, mainValues, detailRows);
    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict — please refresh and retry',
        HttpStatus.CONFLICT,
      );
    }

    // 6. 红线通知 boss/hr（失败只 warn，不阻塞打分结果）
    if (redLine) {
      await this.notifyRedLine(found, redLineNote!);
    }

    return updated;
  }

  /** 红线预警通知：发文本给 boss + hr 绑定用户；整个过程失败只 warn。 */
  private async notifyRedLine(
    found: { rateeUserId: string; rateeName: string | null; scoreMonth: string },
    note: string,
  ): Promise<void> {
    try {
      const recipients = await this.repo.findRedLineRecipients();
      if (recipients.length === 0) {
        this.logger.warn('红线触发但无 boss/hr 收件人，通知跳过');
        return;
      }
      const ratee = found.rateeName ?? found.rateeUserId;
      const text =
        `【绩效红线预警】${ratee}（${found.scoreMonth}）月度打分触发红线，` +
        `已强制评级 D（建议开除）。说明：${note}`;
      for (const openId of recipients) {
        await this.messenger.sendTextToUser(openId, text);
      }
    } catch (err) {
      this.logger.warn('红线通知发送失败: ' + (err as Error).message);
    }
  }
}
