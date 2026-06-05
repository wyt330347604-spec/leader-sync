/**
 * incident.service.spec.ts
 *
 * TDD spec for IncidentService.
 * All external dependencies (repository, feishu) are mocked — no DB required.
 *
 * Coverage scenarios:
 *  1. createIncident — P0/P1 forced to pending_confirm, P2/P3 confirmed directly
 *  2. createIncident — unknown user in involved_user_ids → throws INVALID_PARAMS
 *  3. listIncidents — employee sees only own incidents (row-level filter applied)
 *  4. listIncidents — pmo/boss sees all (no filter applied)
 *  5. getIncident   — found returns data; not found throws INCIDENT_NOT_FOUND
 *  6. confirmIncident — pending_confirm → confirmed; writes confirmed_by + confirmed_at
 *  7. confirmIncident — already confirmed → throws INCIDENT_ALREADY_CONFIRMED
 *  8. rejectIncident — pending_confirm → rejected; writes reject_reason
 *  9. rejectIncident — non-pmo/boss role → throws INCIDENT_PERMISSION_DENIED
 * 10. confirmIncident — only pmo/boss may confirm; employee → INCIDENT_PERMISSION_DENIED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { IncidentRepository } from './incident.repository';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  ErrorCode,
  IncidentSeverity,
  IncidentConfirmStatus,
  UserRole,
} from '@leader-sync/shared-types';

// ─── Mock factory ────────────────────────────────────────────────────────────

function createMockRepo(): Record<keyof IncidentRepository, ReturnType<typeof vi.fn>> {
  return {
    insert: vi.fn(),
    insertIncidentUsers: vi.fn(),
    findByUid: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    findOrgUser: vi.fn(),
    findTaskByUid: vi.fn(),
    listByUserId: vi.fn(),
    findPmoUsers: vi.fn(),
    findIncidentUsers: vi.fn(),
    deleteIncidentUsers: vi.fn(),
    monthlySummary: vi.fn(),
  };
}

// Minimal fake incident row
function makeFakeIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    incidentUid: 'inc_test001',
    title: 'Test incident',
    description: null,
    severity: IncidentSeverity.P1,
    reporterUserId: 'ou_reporter',
    reporterName: 'Reporter',
    relatedTaskUid: null,
    companyId: 'default',
    confirmStatus: IncidentConfirmStatus.PENDING_CONFIRM,
    confirmedBy: null,
    confirmedAt: null,
    rejectReason: null,
    incidentDate: null,
    version: 1,
    createdAt: new Date('2026-05-24T10:00:00Z'),
    updatedAt: new Date('2026-05-24T10:00:00Z'),
    createdBy: 'ou_reporter',
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

// Fake FeishuNotificationService (no-op)
const fakeFeishu = {
  sendTextToUser: vi.fn().mockResolvedValue(undefined),
  notifyPmoOfPendingIncident: vi.fn().mockResolvedValue(undefined),
  notifyUsersIncidentConfirmed: vi.fn().mockResolvedValue(undefined),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IncidentService', () => {
  let service: IncidentService;
  let repo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new IncidentService(
      repo as unknown as IncidentRepository,
      fakeFeishu as any,
    );
    vi.clearAllMocks();
  });

  // ── 1. createIncident: P0/P1 → pending_confirm ───────────────────────────

  it('P0 incident is created with confirm_status = pending_confirm', async () => {
    repo.findOrgUser.mockResolvedValue({ userId: 'ou_alice', userName: 'Alice' });
    repo.insert.mockResolvedValue(makeFakeIncident({
      severity: IncidentSeverity.P0,
      confirmStatus: IncidentConfirmStatus.PENDING_CONFIRM,
    }));
    repo.insertIncidentUsers.mockResolvedValue(undefined);
    repo.findIncidentUsers.mockResolvedValue([]);
    repo.findPmoUsers.mockResolvedValue([]);

    const result = await service.createIncident('ou_reporter', 'Reporter', {
      title: 'Production crash',
      severity: IncidentSeverity.P0,
      involved_user_ids: ['ou_alice'],
    });

    expect(repo.insert).toHaveBeenCalledOnce();
    const insertArg = repo.insert.mock.calls[0][0];
    expect(insertArg.confirmStatus).toBe(IncidentConfirmStatus.PENDING_CONFIRM);
    expect(result.confirmStatus).toBe(IncidentConfirmStatus.PENDING_CONFIRM);
  });

  it('V2：关联任务时自动带出该任务的项目 related_project_uid', async () => {
    repo.findOrgUser.mockResolvedValue({ userId: 'ou_alice', userName: 'Alice' });
    repo.findTaskByUid.mockResolvedValue({ taskUid: 'task_1', projectUid: 'proj_indo' });
    repo.insert.mockResolvedValue(makeFakeIncident({ severity: IncidentSeverity.P2 }));
    repo.insertIncidentUsers.mockResolvedValue(undefined);
    repo.findIncidentUsers.mockResolvedValue([]);
    repo.findPmoUsers.mockResolvedValue([]);

    await service.createIncident('ou_reporter', 'Reporter', {
      title: '任务相关事故',
      severity: IncidentSeverity.P2,
      related_task_uid: 'task_1',
    });
    expect(repo.insert.mock.calls[0][0].relatedProjectUid).toBe('proj_indo');
  });

  it('V2：显式 related_project_uid 优先于任务带出', async () => {
    repo.findOrgUser.mockResolvedValue({ userId: 'ou_alice', userName: 'Alice' });
    repo.findTaskByUid.mockResolvedValue({ taskUid: 'task_1', projectUid: 'proj_indo' });
    repo.insert.mockResolvedValue(makeFakeIncident({ severity: IncidentSeverity.P2 }));
    repo.insertIncidentUsers.mockResolvedValue(undefined);
    repo.findIncidentUsers.mockResolvedValue([]);
    repo.findPmoUsers.mockResolvedValue([]);

    await service.createIncident('ou_reporter', 'Reporter', {
      title: '事故',
      severity: IncidentSeverity.P2,
      related_task_uid: 'task_1',
      related_project_uid: 'proj_explicit',
    });
    expect(repo.insert.mock.calls[0][0].relatedProjectUid).toBe('proj_explicit');
  });

  it('P1 incident is created with confirm_status = pending_confirm', async () => {
    repo.findOrgUser.mockResolvedValue({ userId: 'ou_alice', userName: 'Alice' });
    repo.insert.mockResolvedValue(makeFakeIncident({
      severity: IncidentSeverity.P1,
      confirmStatus: IncidentConfirmStatus.PENDING_CONFIRM,
    }));
    repo.insertIncidentUsers.mockResolvedValue(undefined);
    repo.findIncidentUsers.mockResolvedValue([]);
    repo.findPmoUsers.mockResolvedValue([]);

    await service.createIncident('ou_reporter', 'Reporter', {
      title: 'Serious violation',
      severity: IncidentSeverity.P1,
      involved_user_ids: ['ou_alice'],
    });

    const insertArg = repo.insert.mock.calls[0][0];
    expect(insertArg.confirmStatus).toBe(IncidentConfirmStatus.PENDING_CONFIRM);
  });

  it('P2 incident is created with confirm_status = confirmed directly', async () => {
    repo.findOrgUser.mockResolvedValue({ userId: 'ou_alice', userName: 'Alice' });
    repo.insert.mockResolvedValue(makeFakeIncident({
      severity: IncidentSeverity.P2,
      confirmStatus: IncidentConfirmStatus.CONFIRMED,
    }));
    repo.insertIncidentUsers.mockResolvedValue(undefined);
    repo.findIncidentUsers.mockResolvedValue([]);

    await service.createIncident('ou_reporter', 'Reporter', {
      title: 'Minor violation',
      severity: IncidentSeverity.P2,
      involved_user_ids: ['ou_alice'],
    });

    const insertArg = repo.insert.mock.calls[0][0];
    expect(insertArg.confirmStatus).toBe(IncidentConfirmStatus.CONFIRMED);
  });

  it('P3 incident is created with confirm_status = confirmed directly', async () => {
    repo.findOrgUser.mockResolvedValue({ userId: 'ou_alice', userName: 'Alice' });
    repo.insert.mockResolvedValue(makeFakeIncident({
      severity: IncidentSeverity.P3,
      confirmStatus: IncidentConfirmStatus.CONFIRMED,
    }));
    repo.insertIncidentUsers.mockResolvedValue(undefined);
    repo.findIncidentUsers.mockResolvedValue([]);

    await service.createIncident('ou_reporter', 'Reporter', {
      title: 'Trivial issue',
      severity: IncidentSeverity.P3,
      involved_user_ids: ['ou_alice'],
    });

    const insertArg = repo.insert.mock.calls[0][0];
    expect(insertArg.confirmStatus).toBe(IncidentConfirmStatus.CONFIRMED);
  });

  // ── 2. createIncident: unknown user in involved_user_ids → INVALID_PARAMS ─

  it('throws INVALID_PARAMS when an involved user does not exist in org_cache', async () => {
    // findOrgUser returns null for the unknown user
    repo.findOrgUser.mockResolvedValue(null);

    await expect(
      service.createIncident('ou_reporter', 'Reporter', {
        title: 'Test',
        severity: IncidentSeverity.P2,
        involved_user_ids: ['ou_ghost'],
      }),
    ).rejects.toMatchObject({ businessCode: ErrorCode.INVALID_PARAMS });

    expect(repo.insert).not.toHaveBeenCalled();
  });

  // ── 3. listIncidents — employee sees only own incidents ──────────────────

  it('employee role passes user_id filter to repository', async () => {
    repo.list.mockResolvedValue({ items: [], total: 0 });

    await service.listIncidents('ou_emp', UserRole.EMPLOYEE, {}, 1, 20);

    expect(repo.list).toHaveBeenCalledOnce();
    const listArg = repo.list.mock.calls[0][0];
    // For employee, viewerUserId must be passed so repo applies row-level filter
    expect(listArg.viewerUserId).toBe('ou_emp');
  });

  // ── 4. listIncidents — pmo/boss sees all ─────────────────────────────────

  it('pmo role passes no viewerUserId filter (sees all)', async () => {
    repo.list.mockResolvedValue({ items: [], total: 0 });

    await service.listIncidents('ou_pmo', UserRole.PMO, {}, 1, 20);

    const listArg = repo.list.mock.calls[0][0];
    expect(listArg.viewerUserId).toBeUndefined();
  });

  it('boss role passes no viewerUserId filter (sees all)', async () => {
    repo.list.mockResolvedValue({ items: [], total: 0 });

    await service.listIncidents('ou_boss', UserRole.BOSS, {}, 1, 20);

    const listArg = repo.list.mock.calls[0][0];
    expect(listArg.viewerUserId).toBeUndefined();
  });

  // ── 5. getIncident — found / not found ───────────────────────────────────

  it('getIncident returns incident with involved_users when found', async () => {
    const fakeIncident = makeFakeIncident();
    repo.findByUid.mockResolvedValue(fakeIncident);
    repo.findIncidentUsers.mockResolvedValue([
      { userId: 'ou_alice', userName: 'Alice', involvement: 'involved' },
    ]);

    const result = await service.getIncident('inc_test001', 'ou_reporter', UserRole.LEADER);

    expect(result).toHaveProperty('incidentUid', 'inc_test001');
    expect(result).toHaveProperty('involvedUsers');
  });

  it('getIncident throws INCIDENT_NOT_FOUND when not found', async () => {
    repo.findByUid.mockResolvedValue(null);

    await expect(
      service.getIncident('inc_missing', 'ou_reporter', UserRole.PMO),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.INCIDENT_NOT_FOUND,
      status: HttpStatus.NOT_FOUND,
    });
  });

  // ── 6. confirmIncident — pending_confirm → confirmed ─────────────────────

  it('confirmIncident transitions pending_confirm → confirmed and sets confirmedBy/confirmedAt', async () => {
    const pending = makeFakeIncident({
      confirmStatus: IncidentConfirmStatus.PENDING_CONFIRM,
    });
    repo.findByUid.mockResolvedValue(pending);
    repo.update.mockResolvedValue({
      ...pending,
      confirmStatus: IncidentConfirmStatus.CONFIRMED,
      confirmedBy: 'ou_pmo',
      confirmedAt: new Date(),
    });
    repo.findIncidentUsers.mockResolvedValue([]);

    const result = await service.confirmIncident(
      'inc_test001',
      'ou_pmo',
      UserRole.PMO,
    );

    expect(repo.update).toHaveBeenCalledOnce();
    const updateArg = repo.update.mock.calls[0][1];
    expect(updateArg.confirmStatus).toBe(IncidentConfirmStatus.CONFIRMED);
    expect(updateArg.confirmedBy).toBe('ou_pmo');
    expect(updateArg.confirmedAt).toBeInstanceOf(Date);
    expect(result.confirmStatus).toBe(IncidentConfirmStatus.CONFIRMED);
  });

  // ── 7. confirmIncident — already confirmed → INCIDENT_ALREADY_CONFIRMED ──

  it('confirmIncident throws INCIDENT_ALREADY_CONFIRMED when not in pending_confirm', async () => {
    const alreadyConfirmed = makeFakeIncident({
      confirmStatus: IncidentConfirmStatus.CONFIRMED,
    });
    repo.findByUid.mockResolvedValue(alreadyConfirmed);

    await expect(
      service.confirmIncident('inc_test001', 'ou_pmo', UserRole.PMO),
    ).rejects.toMatchObject({ businessCode: ErrorCode.INCIDENT_ALREADY_CONFIRMED });

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('confirmIncident throws INCIDENT_ALREADY_CONFIRMED when already rejected', async () => {
    const rejected = makeFakeIncident({
      confirmStatus: IncidentConfirmStatus.REJECTED,
    });
    repo.findByUid.mockResolvedValue(rejected);

    await expect(
      service.confirmIncident('inc_test001', 'ou_pmo', UserRole.PMO),
    ).rejects.toMatchObject({ businessCode: ErrorCode.INCIDENT_ALREADY_CONFIRMED });
  });

  // ── 8. rejectIncident — pending_confirm → rejected ───────────────────────

  it('rejectIncident transitions pending_confirm → rejected and writes reject_reason', async () => {
    const pending = makeFakeIncident({
      confirmStatus: IncidentConfirmStatus.PENDING_CONFIRM,
    });
    repo.findByUid.mockResolvedValue(pending);
    repo.update.mockResolvedValue({
      ...pending,
      confirmStatus: IncidentConfirmStatus.REJECTED,
      rejectReason: 'Evidence insufficient',
    });
    repo.findIncidentUsers.mockResolvedValue([]);

    const result = await service.rejectIncident(
      'inc_test001',
      'ou_pmo',
      UserRole.PMO,
      { reject_reason: 'Evidence insufficient' },
    );

    const updateArg = repo.update.mock.calls[0][1];
    expect(updateArg.confirmStatus).toBe(IncidentConfirmStatus.REJECTED);
    expect(updateArg.rejectReason).toBe('Evidence insufficient');
    expect(result.confirmStatus).toBe(IncidentConfirmStatus.REJECTED);
  });

  // ── 9. rejectIncident — employee role → INCIDENT_PERMISSION_DENIED ───────

  it('rejectIncident throws INCIDENT_PERMISSION_DENIED for non-pmo/boss roles', async () => {
    const pending = makeFakeIncident({
      confirmStatus: IncidentConfirmStatus.PENDING_CONFIRM,
    });
    repo.findByUid.mockResolvedValue(pending);

    await expect(
      service.rejectIncident('inc_test001', 'ou_emp', UserRole.EMPLOYEE, {
        reject_reason: 'Trying to reject',
      }),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.INCIDENT_PERMISSION_DENIED,
      status: HttpStatus.FORBIDDEN,
    });

    expect(repo.update).not.toHaveBeenCalled();
  });

  // ── 10. confirmIncident — employee role → INCIDENT_PERMISSION_DENIED ─────

  it('confirmIncident throws INCIDENT_PERMISSION_DENIED for employee role', async () => {
    const pending = makeFakeIncident({
      confirmStatus: IncidentConfirmStatus.PENDING_CONFIRM,
    });
    repo.findByUid.mockResolvedValue(pending);

    await expect(
      service.confirmIncident('inc_test001', 'ou_emp', UserRole.EMPLOYEE),
    ).rejects.toMatchObject({
      businessCode: ErrorCode.INCIDENT_PERMISSION_DENIED,
      status: HttpStatus.FORBIDDEN,
    });

    expect(repo.update).not.toHaveBeenCalled();
  });
});
