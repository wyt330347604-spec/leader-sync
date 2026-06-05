import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IncidentRepository } from './incident.repository';
import { IncidentFeishuService } from './incident-feishu.service';
import type { CreateIncidentDto } from './dto/create-incident.dto';
import type { UpdateIncidentDto } from './dto/update-incident.dto';
import type { RejectIncidentDto } from './dto/reject-incident.dto';
import {
  ErrorCode,
  IncidentSeverity,
  IncidentConfirmStatus,
  UserRole,
  PaginatedData,
} from '@leader-sync/shared-types';
import { nanoid } from 'nanoid';

// Severity values that require a second-confirmation step
const REQUIRES_CONFIRM = new Set<string>([IncidentSeverity.P0, IncidentSeverity.P1]);

// Roles that are allowed to confirm / reject incidents
const CONFIRM_ALLOWED_ROLES = new Set<string>([UserRole.PMO, UserRole.BOSS, UserRole.ADMIN]);

// Roles that see all incidents without row-level filtering
const SEE_ALL_ROLES = new Set<string>([UserRole.PMO, UserRole.BOSS, UserRole.ADMIN]);

// company_id: hardcoded single-tenant value (JWT has no company_id field)
const COMPANY_ID = process.env.COMPANY_ID ?? 'default';

function generateIncidentUid(): string {
  return `inc_${nanoid(16)}`;
}

@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly feishu: IncidentFeishuService,
  ) {}

  // ── CREATE ────────────────────────────────────────────────────────────────

  async createIncident(
    reporterUserId: string,
    reporterName: string,
    dto: CreateIncidentDto,
  ) {
    // 1. Validate involved users exist in org_cache
    const involvedUserIds = dto.involved_user_ids ?? [];
    const resolvedUsers: Array<{ userId: string; userName: string }> = [];

    for (const uid of involvedUserIds) {
      const orgUser = await this.incidentRepository.findOrgUser(uid);
      if (!orgUser) {
        throw new BusinessException(
          ErrorCode.INVALID_PARAMS,
          `User ${uid} not found in org_cache`,
          HttpStatus.BAD_REQUEST,
        );
      }
      resolvedUsers.push({ userId: orgUser.userId, userName: orgUser.userName ?? uid });
    }

    // 2. Validate related_task_uid if provided；并带出该任务的项目（V2 问责闭环）
    let relatedProjectUid: string | null = dto.related_project_uid ?? null;
    if (dto.related_task_uid) {
      const relatedTask = await this.incidentRepository.findTaskByUid(dto.related_task_uid);
      if (!relatedTask) {
        throw new BusinessException(
          ErrorCode.INVALID_PARAMS,
          `Task ${dto.related_task_uid} not found or deleted`,
          HttpStatus.BAD_REQUEST,
        );
      }
      // 未显式指定项目时，自动带出关联任务的项目
      if (!relatedProjectUid) relatedProjectUid = relatedTask.projectUid ?? null;
    }

    // 3. Determine confirm_status based on severity
    const confirmStatus: IncidentConfirmStatus = REQUIRES_CONFIRM.has(dto.severity)
      ? IncidentConfirmStatus.PENDING_CONFIRM
      : IncidentConfirmStatus.CONFIRMED;

    // 4. Generate UID and insert
    const incidentUid = generateIncidentUid();
    const now = new Date();

    const created = await this.incidentRepository.insert({
      incidentUid,
      title: dto.title,
      description: dto.description ?? null,
      severity: dto.severity,
      reporterUserId,
      reporterName,
      relatedTaskUid: dto.related_task_uid ?? null,
      relatedProjectUid,
      companyId: COMPANY_ID,
      confirmStatus,
      incidentDate: dto.incident_date ?? null,
      version: 1,
      createdBy: reporterUserId,
      createdAt: now,
      updatedAt: now,
    });

    // 5. Insert incident_user rows (immutable involvement = involved by default)
    if (resolvedUsers.length > 0) {
      await this.incidentRepository.insertIncidentUsers(
        resolvedUsers.map((u) => ({
          incidentUid,
          userId: u.userId,
          userName: u.userName,
          involvement: 'involved',
        })),
      );
    }

    // 6. Async Feishu notification for P0/P1
    if (REQUIRES_CONFIRM.has(dto.severity)) {
      this.notifyPmoAsync(incidentUid, dto.title, reporterName, dto.severity);
    }

    // 7. Return with involvedUsers attached
    const involvedUsers = await this.incidentRepository.findIncidentUsers(incidentUid);
    return this.formatIncident(created, involvedUsers);
  }

  // ── LIST ──────────────────────────────────────────────────────────────────

  async listIncidents(
    viewerUserId: string,
    viewerRole: string,
    filter: {
      severity?: string;
      confirmStatus?: string;
      month?: string;
      userId?: string;
      projectUid?: string;
    },
    page: number,
    pageSize: number,
  ): Promise<PaginatedData<unknown>> {
    const repoFilter: Parameters<IncidentRepository['list']>[0] = {
      severity: filter.severity,
      confirmStatus: filter.confirmStatus,
      month: filter.month,
      userId: filter.userId,
      projectUid: filter.projectUid,
    };

    // Row-level security: non-privileged users see only their own incidents
    if (!SEE_ALL_ROLES.has(viewerRole)) {
      repoFilter.viewerUserId = viewerUserId;
    }

    const { items, total } = await this.incidentRepository.list(repoFilter, page, pageSize);
    return { items, total, page, page_size: pageSize };
  }

  // ── GET ONE ───────────────────────────────────────────────────────────────

  async getIncident(
    incidentUid: string,
    viewerUserId: string,
    viewerRole: string,
  ) {
    const found = await this.incidentRepository.findByUid(incidentUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.INCIDENT_NOT_FOUND,
        'Incident not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const involvedUsers = await this.incidentRepository.findIncidentUsers(incidentUid);

    // 行级安全：非特权用户仅当为 上报人 或 涉及人 才可读（与 list 口径一致）。
    if (!SEE_ALL_ROLES.has(viewerRole)) {
      const isReporter = found.reporterUserId === viewerUserId;
      const isInvolved = involvedUsers.some((u) => u.userId === viewerUserId);
      if (!isReporter && !isInvolved) {
        throw new BusinessException(
          ErrorCode.INCIDENT_PERMISSION_DENIED,
          'No permission to view this incident',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    return this.formatIncident(found, involvedUsers);
  }

  // ── UPDATE ────────────────────────────────────────────────────────────────

  async updateIncident(
    incidentUid: string,
    viewerUserId: string,
    viewerRole: string,
    dto: UpdateIncidentDto,
  ) {
    const found = await this.incidentRepository.findByUid(incidentUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.INCIDENT_NOT_FOUND,
        'Incident not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Only reporter or pmo/boss can edit; confirmed/rejected incidents are locked
    const isReporter = found.reporterUserId === viewerUserId;
    const isPrivileged = CONFIRM_ALLOWED_ROLES.has(viewerRole);
    if (!isReporter && !isPrivileged) {
      throw new BusinessException(
        ErrorCode.INCIDENT_PERMISSION_DENIED,
        'Only the reporter or PMO/Boss can edit this incident',
        HttpStatus.FORBIDDEN,
      );
    }

    const isLocked =
      found.confirmStatus === IncidentConfirmStatus.CONFIRMED ||
      found.confirmStatus === IncidentConfirmStatus.REJECTED;
    if (isLocked) {
      throw new BusinessException(
        ErrorCode.INCIDENT_ALREADY_CONFIRMED,
        'Cannot edit a confirmed or rejected incident',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updateValues: Record<string, unknown> = {
      updatedBy: viewerUserId,
    };
    if (dto.title !== undefined) updateValues.title = dto.title;
    if (dto.description !== undefined) updateValues.description = dto.description;
    if ('related_task_uid' in dto) updateValues.relatedTaskUid = dto.related_task_uid ?? null;

    const updated = await this.incidentRepository.update(incidentUid, updateValues);

    // Replace incident_users if provided
    if (dto.involved_user_ids !== undefined) {
      // Validate new users
      const resolvedUsers: Array<{ userId: string; userName: string }> = [];
      for (const uid of dto.involved_user_ids) {
        const orgUser = await this.incidentRepository.findOrgUser(uid);
        if (!orgUser) {
          throw new BusinessException(
            ErrorCode.INVALID_PARAMS,
            `User ${uid} not found in org_cache`,
            HttpStatus.BAD_REQUEST,
          );
        }
        resolvedUsers.push({ userId: orgUser.userId, userName: orgUser.userName ?? uid });
      }

      await this.incidentRepository.deleteIncidentUsers(incidentUid);
      if (resolvedUsers.length > 0) {
        await this.incidentRepository.insertIncidentUsers(
          resolvedUsers.map((u) => ({
            incidentUid,
            userId: u.userId,
            userName: u.userName,
            involvement: 'involved',
          })),
        );
      }
    }

    const involvedUsers = await this.incidentRepository.findIncidentUsers(incidentUid);
    return this.formatIncident(updated!, involvedUsers);
  }

  // ── CONFIRM ───────────────────────────────────────────────────────────────

  async confirmIncident(
    incidentUid: string,
    confirmerUserId: string,
    confirmerRole: string,
  ) {
    // Permission check: only PMO/Boss/Admin
    if (!CONFIRM_ALLOWED_ROLES.has(confirmerRole)) {
      throw new BusinessException(
        ErrorCode.INCIDENT_PERMISSION_DENIED,
        'Only PMO or Boss can confirm incidents',
        HttpStatus.FORBIDDEN,
      );
    }

    const found = await this.incidentRepository.findByUid(incidentUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.INCIDENT_NOT_FOUND,
        'Incident not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (found.confirmStatus !== IncidentConfirmStatus.PENDING_CONFIRM) {
      throw new BusinessException(
        ErrorCode.INCIDENT_ALREADY_CONFIRMED,
        'Incident is already confirmed or rejected',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.incidentRepository.update(incidentUid, {
      confirmStatus: IncidentConfirmStatus.CONFIRMED,
      confirmedBy: confirmerUserId,
      confirmedAt: new Date(),
      updatedBy: confirmerUserId,
    });

    // Async notify involved employees
    this.notifyInvolvedAsync(incidentUid, found.title, found.severity);

    const involvedUsers = await this.incidentRepository.findIncidentUsers(incidentUid);
    return this.formatIncident(updated!, involvedUsers);
  }

  // ── REJECT ────────────────────────────────────────────────────────────────

  async rejectIncident(
    incidentUid: string,
    rejecterUserId: string,
    rejecterRole: string,
    dto: RejectIncidentDto,
  ) {
    // Permission check: only PMO/Boss/Admin
    if (!CONFIRM_ALLOWED_ROLES.has(rejecterRole)) {
      throw new BusinessException(
        ErrorCode.INCIDENT_PERMISSION_DENIED,
        'Only PMO or Boss can reject incidents',
        HttpStatus.FORBIDDEN,
      );
    }

    const found = await this.incidentRepository.findByUid(incidentUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.INCIDENT_NOT_FOUND,
        'Incident not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (found.confirmStatus !== IncidentConfirmStatus.PENDING_CONFIRM) {
      throw new BusinessException(
        ErrorCode.INCIDENT_ALREADY_CONFIRMED,
        'Incident is already confirmed or rejected',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.incidentRepository.update(incidentUid, {
      confirmStatus: IncidentConfirmStatus.REJECTED,
      rejectReason: dto.reject_reason,
      updatedBy: rejecterUserId,
    });

    const involvedUsers = await this.incidentRepository.findIncidentUsers(incidentUid);
    return this.formatIncident(updated!, involvedUsers);
  }

  // ── DELETE ────────────────────────────────────────────────────────────────

  async deleteIncident(
    incidentUid: string,
    viewerUserId: string,
    viewerRole: string,
  ) {
    const found = await this.incidentRepository.findByUid(incidentUid);
    if (!found) {
      throw new BusinessException(
        ErrorCode.INCIDENT_NOT_FOUND,
        'Incident not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const isReporter = found.reporterUserId === viewerUserId;
    const isPrivileged = CONFIRM_ALLOWED_ROLES.has(viewerRole);

    // Reporter can only delete when pending_confirm; PMO/Boss can delete regardless
    if (
      !isPrivileged &&
      !(isReporter && found.confirmStatus === IncidentConfirmStatus.PENDING_CONFIRM)
    ) {
      throw new BusinessException(
        ErrorCode.INCIDENT_PERMISSION_DENIED,
        'You do not have permission to delete this incident',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.incidentRepository.softDelete(incidentUid);
    return { success: true };
  }

  // ── MY INCIDENTS ─────────────────────────────────────────────────────────

  async listMyIncidents(
    userId: string,
    month: string | undefined,
    severity: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<PaginatedData<unknown>> {
    const { items, total } = await this.incidentRepository.listByUserId(
      userId,
      month,
      severity,
      page,
      pageSize,
    );
    return { items, total, page, page_size: pageSize };
  }

  // ── MONTHLY SUMMARY ───────────────────────────────────────────────────────

  async getMonthlySummary(
    userId: string,
    month: string,
    viewerRole: string,
  ) {
    // Only leader/pmo/boss can call this
    const allowedRoles = new Set<string>([UserRole.LEADER, UserRole.PMO, UserRole.BOSS, UserRole.ADMIN]);
    if (!allowedRoles.has(viewerRole)) {
      throw new BusinessException(
        ErrorCode.INCIDENT_PERMISSION_DENIED,
        'Insufficient role to view monthly summary',
        HttpStatus.FORBIDDEN,
      );
    }

    const orgUser = await this.incidentRepository.findOrgUser(userId);
    const { total, bySeverity, incidents } = await this.incidentRepository.monthlySummary(userId, month);

    return {
      user_id: userId,
      user_name: orgUser?.userName ?? userId,
      month,
      total,
      by_severity: bySeverity,
      incidents,
    };
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────

  private formatIncident<T extends Record<string, unknown>>(
    row: T,
    involvedUsers: Array<{ userId: string; userName: string; involvement: string }>,
  ) {
    return {
      ...row,
      involvedUsers: involvedUsers.map((u) => ({
        user_id: u.userId,
        user_name: u.userName,
        involvement: u.involvement,
      })),
    };
  }

  private notifyPmoAsync(
    incidentUid: string,
    title: string,
    reporterName: string,
    severity: string,
  ): void {
    this.incidentRepository
      .findPmoUsers()
      .then((pmoUsers) => {
        const openIds = pmoUsers
          .map((u: { userId?: string; user_id?: string }) => u.userId ?? u.user_id ?? '')
          .filter(Boolean);
        return this.feishu.notifyPmoOfPendingIncident(
          openIds,
          incidentUid,
          title,
          reporterName,
          severity,
        );
      })
      .catch((err: Error) => {
        this.logger.warn('notifyPmoAsync failed', err.message);
      });
  }

  private notifyInvolvedAsync(
    incidentUid: string,
    title: string,
    severity: string,
  ): void {
    this.incidentRepository
      .findIncidentUsers(incidentUid)
      .then((users) => {
        // involved users' userId fields are open_ids in the Feishu context
        const openIds = users
          .map((u) => u.userId)
          .filter(Boolean);
        return this.feishu.notifyUsersIncidentConfirmed(
          openIds,
          incidentUid,
          title,
          severity,
        );
      })
      .catch((err: Error) => {
        this.logger.warn('notifyInvolvedAsync failed', err.message);
      });
  }
}
