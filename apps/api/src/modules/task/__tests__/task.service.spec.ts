import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskService } from '../task.service';
import { TaskRepository } from '../task.repository';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode, TaskStatus } from '@leader-sync/shared-types';
import { HttpStatus } from '@nestjs/common';

function createMockRepository(): Record<keyof TaskRepository, ReturnType<typeof vi.fn>> {
  return {
    insert: vi.fn(),
    findByUid: vi.fn(),
    updateWithVersion: vi.fn(),
    listByUser: vi.fn(),
    insertProgressLog: vi.fn(),
    findOrgUser: vi.fn(),
    addTaskLeader: vi.fn(),
    removeTaskLeader: vi.fn(),
    getTaskLeaders: vi.fn(),
    getTaskLeadersByTaskUids: vi.fn(),
    getDefaultProject: vi.fn(),
    softDelete: vi.fn(),
    restore: vi.fn(),
    updateField: vi.fn(),
    setUserOrder: vi.fn(),
    findByUids: vi.fn(),
    bulkSetProject: vi.fn(),
  };
}

function makeFakeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    taskUid: 'task_abc123',
    title: 'Test Task',
    detail: null,
    taskType: 'new',
    priority: 'urgent_important',
    status: TaskStatus.IN_PROGRESS,
    progressPercent: 50,
    latestProgress: null,
    assigneeUserId: 'user_assignee',
    assigneeName: 'Assignee',
    assigneeManagerUserId: null,
    assigneeManagerName: null,
    assigneeDeptId: null,
    assigneeDeptName: null,
    leaderUserId: 'user_leader',
    leaderName: null,
    issuerUserId: 'user_issuer',
    issuerName: null,
    assignerUserId: 'user_assigner',
    assignerName: null,
    assignmentType: 'boss_assign',
    collaborators: null,
    startAt: null,
    dueAt: new Date('2026-04-15'),
    completedAt: null,
    stallReason: null,
    delayReason: null,
    daysToDue: null,
    isOverdue: false,
    monthBucket: '2026-04',
    sourceMonth: null,
    isCarriedOver: false,
    carriedFromTaskUid: null,
    carryOverCount: 0,
    monthlyCommitmentFlag: false,
    overdueNotifiedLeaderAt: null,
    bossAttentionFlag: false,
    monthlyCloseLocked: false,
    projectUid: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user_issuer',
    updatedBy: null,
    deletedAt: null,
    titleCopy: null,
    ...overrides,
  };
}

describe('TaskService', () => {
  let service: TaskService;
  let repo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    repo = createMockRepository();
    service = new TaskService(repo as unknown as TaskRepository);
  });

  describe('createTask', () => {
    it('sets leader = issuer.manager (NOT assignee.manager)', async () => {
      // Distinct issuer and assignee with different managers — verifies the new semantic
      repo.findOrgUser.mockImplementation(async (uid: string) => {
        if (uid === 'user_issuer') {
          return {
            userId: 'user_issuer',
            userName: 'Issuer Name',
            deptId: 'dept_a',
            deptName: 'Dept A',
            managerUserId: 'user_issuer_manager',
            managerName: 'Issuer Manager',
          };
        }
        if (uid === 'user_assignee') {
          return {
            userId: 'user_assignee',
            userName: 'Assignee Name',
            deptId: 'dept_b',
            deptName: 'Dept B',
            managerUserId: 'user_assignee_manager',
            managerName: 'Assignee Manager',
          };
        }
        return null;
      });
      repo.getDefaultProject.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask({ status: TaskStatus.NOT_STARTED }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.createTask('user_issuer', {
        title: 'X',
        priority: 'urgent_important',
        assignee_user_id: 'user_assignee',
        due_at: '2026-04-15',
      });

      const insertArg = repo.insert.mock.calls[0][0];
      expect(insertArg.leaderUserId).toBe('user_issuer_manager');
      expect(insertArg.leaderName).toBe('Issuer Manager');
    });

    it('start_at 不填 → 默认创建当天（非 null）', async () => {
      repo.findOrgUser.mockResolvedValue(null);
      repo.getDefaultProject.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask());
      repo.insertProgressLog.mockResolvedValue(undefined);

      const before = Date.now();
      await service.createTask('u', {
        title: 'X', priority: 'urgent_important', assignee_user_id: 'a', due_at: '2026-08-15',
      });
      const insertArg = repo.insert.mock.calls[0][0];
      expect(insertArg.startAt).toBeInstanceOf(Date);
      expect(insertArg.startAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('start_at 填了 → 用传入值', async () => {
      repo.findOrgUser.mockResolvedValue(null);
      repo.getDefaultProject.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask());
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.createTask('u', {
        title: 'X', priority: 'urgent_important', assignee_user_id: 'a', due_at: '2026-08-15',
        start_at: '2026-07-01',
      });
      const insertArg = repo.insert.mock.calls[0][0];
      expect(insertArg.startAt).toEqual(new Date('2026-07-01'));
    });

    it('不填 project_uid → 未归属（project_uid=null），不再自动落默认项目', async () => {
      repo.findOrgUser.mockResolvedValue(null);
      repo.getDefaultProject.mockResolvedValue({ projectUid: 'proj_default' });
      repo.insert.mockResolvedValue(makeFakeTask());
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.createTask('u', {
        title: 'X', priority: 'urgent_important', assignee_user_id: 'a', due_at: '2026-08-15',
      });
      const insertArg = repo.insert.mock.calls[0][0];
      expect(insertArg.projectUid).toBeNull();
      // 不应再调用默认项目兜底
      expect(repo.getDefaultProject).not.toHaveBeenCalled();
    });

    it('填了 project_uid → 用该项目', async () => {
      repo.findOrgUser.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask());
      repo.insertProgressLog.mockResolvedValue(undefined);
      await service.createTask('u', {
        title: 'X', priority: 'urgent_important', assignee_user_id: 'a', due_at: '2026-08-15',
        project_uid: 'proj_indo',
      });
      expect(repo.insert.mock.calls[0][0].projectUid).toBe('proj_indo');
    });

    it('month_bucket = 截止日期所在月（未来截止 → 归未来月，不归当前月）', async () => {
      repo.findOrgUser.mockResolvedValue(null);
      repo.getDefaultProject.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask());
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.createTask('u', {
        title: 'X', priority: 'urgent_important', assignee_user_id: 'a', due_at: '2026-08-15',
      });
      expect(repo.insert.mock.calls[0][0].monthBucket).toBe('2026-08');
    });

    it('falls back leader to issuer themself when issuer has no manager', async () => {
      repo.findOrgUser.mockImplementation(async (uid: string) => {
        if (uid === 'user_top_boss') {
          return {
            userId: 'user_top_boss',
            userName: 'Top Boss',
            deptId: null,
            deptName: null,
            managerUserId: null, // 顶层，无 manager
            managerName: null,
          };
        }
        return {
          userId: 'user_assignee',
          userName: 'Assignee Name',
          deptId: 'dept_b',
          deptName: 'Dept B',
          managerUserId: 'someone_else',
          managerName: 'Someone Else',
        };
      });
      repo.getDefaultProject.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask({ status: TaskStatus.NOT_STARTED }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.createTask('user_top_boss', {
        title: 'X',
        priority: 'urgent_important',
        assignee_user_id: 'user_assignee',
        due_at: '2026-04-15',
      });

      const insertArg = repo.insert.mock.calls[0][0];
      expect(insertArg.leaderUserId).toBe('user_top_boss');
      expect(insertArg.leaderName).toBe('Top Boss');
    });

    it('generates UID, auto-fills system fields, calls insert and insertProgressLog', async () => {
      const orgUser = {
        userId: 'user_assignee',
        userName: 'Assignee Name',
        deptId: 'dept_1',
        deptName: 'Engineering',
        managerUserId: 'user_manager',
        managerName: 'Manager Name',
      };
      repo.findOrgUser.mockResolvedValue(orgUser);
      repo.getDefaultProject.mockResolvedValue(null);

      const insertedTask = makeFakeTask({ status: TaskStatus.NOT_STARTED });
      repo.insert.mockResolvedValue(insertedTask);
      repo.insertProgressLog.mockResolvedValue(undefined);

      const result = await service.createTask('user_issuer', {
        title: 'New Task',
        task_type: 'new',
        priority: 'urgent_important',
        assignee_user_id: 'user_assignee',
        due_at: '2026-04-15',
      });

      expect(result).toBe(insertedTask);
      expect(repo.insert).toHaveBeenCalledOnce();

      const insertArg = repo.insert.mock.calls[0][0];
      expect(insertArg.taskUid).toMatch(/^task_/);
      expect(insertArg.issuerUserId).toBe('user_issuer');
      expect(insertArg.assignerUserId).toBe('user_issuer');
      expect(insertArg.assigneeName).toBe('Assignee Name');
      expect(insertArg.leaderUserId).toBe('user_manager');
      expect(insertArg.monthBucket).toBe('2026-04');
      expect(insertArg.status).toBe(TaskStatus.NOT_STARTED);
      expect(insertArg.version).toBe(1);
      expect(insertArg.createdBy).toBe('user_issuer');

      expect(repo.insertProgressLog).toHaveBeenCalledOnce();
      const logArg = repo.insertProgressLog.mock.calls[0][0];
      expect(logArg.logUid).toMatch(/^log_/);
      expect(logArg.sourceType).toBe('api');
      expect(logArg.newStatus).toBe(TaskStatus.NOT_STARTED);
    });
  });

  describe('getTask', () => {
    it('returns the task when found', async () => {
      const fakeTask = makeFakeTask();
      repo.findByUid.mockResolvedValue(fakeTask);

      const result = await service.getTask('task_abc123');
      expect(result).toBe(fakeTask);
    });

    it('throws TASK_NOT_FOUND when task does not exist', async () => {
      repo.findByUid.mockResolvedValue(null);

      await expect(service.getTask('task_missing')).rejects.toThrow(BusinessException);

      try {
        await service.getTask('task_missing');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).businessCode).toBe(ErrorCode.TASK_NOT_FOUND);
      }
    });
  });

  describe('updateTask', () => {
    it('validates transition, checks version, and writes progress log', async () => {
      const current = makeFakeTask({ status: TaskStatus.IN_PROGRESS, version: 1 });
      repo.findByUid.mockResolvedValue(current);

      const updated = makeFakeTask({ status: TaskStatus.DONE, version: 2, progressPercent: 100 });
      repo.updateWithVersion.mockResolvedValue(updated);
      repo.insertProgressLog.mockResolvedValue(undefined);

      const result = await service.updateTask('user_1', 'task_abc123', {
        version: 1,
        status: 'done',
      });

      expect(result).toBe(updated);
      expect(repo.updateWithVersion).toHaveBeenCalledOnce();

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[0]).toBe('task_abc123');
      expect(updateArgs[1]).toBe(1);
      expect(updateArgs[2].status).toBe('done');
      expect(updateArgs[2].progressPercent).toBe(100);
      expect(updateArgs[2].completedAt).toBeInstanceOf(Date);

      expect(repo.insertProgressLog).toHaveBeenCalledOnce();
    });

    it('throws VERSION_CONFLICT when updateWithVersion returns null', async () => {
      const current = makeFakeTask({ status: TaskStatus.IN_PROGRESS, version: 1 });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(null);

      try {
        await service.updateTask('user_1', 'task_abc123', {
          version: 1,
          title: 'Updated',
        });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).businessCode).toBe(ErrorCode.VERSION_CONFLICT);
        expect((error as BusinessException).getStatus()).toBe(HttpStatus.CONFLICT);
      }
    });

    it('throws INVALID_STATUS_TRANSITION for invalid transition', async () => {
      const current = makeFakeTask({ status: TaskStatus.CLOSED, version: 1 });
      repo.findByUid.mockResolvedValue(current);

      try {
        await service.updateTask('user_1', 'task_abc123', {
          version: 1,
          status: 'done',
        });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).businessCode).toBe(ErrorCode.INVALID_STATUS_TRANSITION);
      }
    });
  });

  describe('completeTask', () => {
    it('sets status to done and progress_percent to 100', async () => {
      const current = makeFakeTask({ status: TaskStatus.IN_PROGRESS, version: 1 });
      repo.findByUid.mockResolvedValue(current);

      const completed = makeFakeTask({
        status: TaskStatus.DONE,
        version: 2,
        progressPercent: 100,
      });
      repo.updateWithVersion.mockResolvedValue(completed);
      repo.insertProgressLog.mockResolvedValue(undefined);

      const result = await service.completeTask('user_1', 'task_abc123', {});

      expect(result).toBe(completed);
      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].status).toBe(TaskStatus.DONE);
      expect(updateArgs[2].progressPercent).toBe(100);
      expect(updateArgs[2].completedAt).toBeInstanceOf(Date);

      expect(repo.insertProgressLog).toHaveBeenCalledOnce();
      const logArg = repo.insertProgressLog.mock.calls[0][0];
      expect(logArg.newStatus).toBe(TaskStatus.DONE);
    });

    it('resets isOverdue=false and daysToDue=null when completing an overdue task', async () => {
      const current = makeFakeTask({
        status: TaskStatus.IN_PROGRESS,
        version: 1,
        isOverdue: true,
        daysToDue: -5,
      });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(makeFakeTask({ status: TaskStatus.DONE, version: 2 }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.completeTask('user_1', 'task_abc123', {});

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].isOverdue).toBe(false);
      expect(updateArgs[2].daysToDue).toBeNull();
    });

    it('clears overdueNotifiedLeaderAt so leader gets notified again on next overdue cycle', async () => {
      const current = makeFakeTask({
        status: TaskStatus.IN_PROGRESS,
        version: 1,
        overdueNotifiedLeaderAt: new Date('2026-04-20'),
      });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(makeFakeTask({ status: TaskStatus.DONE, version: 2 }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.completeTask('user_1', 'task_abc123', {});

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].overdueNotifiedLeaderAt).toBeNull();
    });
  });

  describe('updateTask isOverdue/daysToDue side-effects', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-01T00:00:00+08:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resets isOverdue=false when transitioning status to done', async () => {
      const current = makeFakeTask({
        status: TaskStatus.IN_PROGRESS,
        version: 1,
        isOverdue: true,
        daysToDue: -3,
      });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(makeFakeTask({ status: TaskStatus.DONE, version: 2 }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.updateTask('user_1', 'task_abc123', {
        status: TaskStatus.DONE,
        version: 1,
      });

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].isOverdue).toBe(false);
      expect(updateArgs[2].daysToDue).toBeNull();
    });

    it('recomputes isOverdue=false when due_at is moved to a future date', async () => {
      const current = makeFakeTask({
        status: TaskStatus.IN_PROGRESS,
        version: 1,
        dueAt: new Date('2026-03-15'),
        isOverdue: true,
        daysToDue: -17,
      });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(makeFakeTask({ version: 2 }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.updateTask('user_1', 'task_abc123', {
        due_at: '2026-05-15',
        version: 1,
      });

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].isOverdue).toBe(false);
      expect(updateArgs[2].daysToDue).toBeGreaterThan(0);
    });

    it('clears overdueNotifiedLeaderAt when due_at is moved to a future date', async () => {
      const current = makeFakeTask({
        status: TaskStatus.IN_PROGRESS,
        version: 1,
        dueAt: new Date('2026-03-15'),
        isOverdue: true,
        overdueNotifiedLeaderAt: new Date('2026-03-20'),
      });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(makeFakeTask({ version: 2 }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.updateTask('user_1', 'task_abc123', {
        due_at: '2026-05-15',
        version: 1,
      });

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].overdueNotifiedLeaderAt).toBeNull();
    });
  });

  describe('delayTask', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-01T00:00:00+08:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('updates due_at and delay_reason without changing month_bucket', async () => {
      const current = makeFakeTask({ version: 1, dueAt: new Date('2026-04-15'), delayCount: 0 });
      repo.findByUid.mockResolvedValue(current);

      const delayed = makeFakeTask({
        version: 2,
        dueAt: new Date('2026-05-01'),
        delayReason: 'Waiting for vendor',
        delayCount: 1,
      });
      repo.updateWithVersion.mockResolvedValue(delayed);
      repo.insertProgressLog.mockResolvedValue(undefined);

      const result = await service.delayTask('user_1', 'task_abc123', {
        new_due_at: '2026-05-01',
        delay_reason: 'Waiting for vendor',
      });

      expect(result).toBe(delayed);
      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].dueAt).toEqual(new Date('2026-05-01'));
      expect(updateArgs[2].delayReason).toBe('Waiting for vendor');
      expect(updateArgs[2].monthBucket).toBeUndefined();

      expect(repo.insertProgressLog).toHaveBeenCalledOnce();
    });

    it('rejects new_due_at earlier than today', async () => {
      const current = makeFakeTask({ version: 1, dueAt: new Date('2026-03-10') });
      repo.findByUid.mockResolvedValue(current);

      await expect(
        service.delayTask('user_1', 'task_abc123', { new_due_at: '2026-03-15' }),
      ).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
        status: HttpStatus.BAD_REQUEST,
      });

      expect(repo.updateWithVersion).not.toHaveBeenCalled();
    });

    it('rejects new_due_at earlier than current due_at', async () => {
      const current = makeFakeTask({ version: 1, dueAt: new Date('2026-04-20') });
      repo.findByUid.mockResolvedValue(current);

      await expect(
        service.delayTask('user_1', 'task_abc123', { new_due_at: '2026-04-15' }),
      ).rejects.toMatchObject({
        businessCode: ErrorCode.INVALID_PARAMS,
        status: HttpStatus.BAD_REQUEST,
      });

      expect(repo.updateWithVersion).not.toHaveBeenCalled();
    });

    it('increments delay_count by 1 on success', async () => {
      const current = makeFakeTask({ version: 1, dueAt: new Date('2026-04-15'), delayCount: 2 });
      repo.findByUid.mockResolvedValue(current);

      const delayed = makeFakeTask({ version: 2, dueAt: new Date('2026-05-01'), delayCount: 3 });
      repo.updateWithVersion.mockResolvedValue(delayed);
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.delayTask('user_1', 'task_abc123', { new_due_at: '2026-05-01' });

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].delayCount).toBe(3);
    });

    it('starts delay_count from 0 when null', async () => {
      const current = makeFakeTask({ version: 1, dueAt: new Date('2026-04-15'), delayCount: null });
      repo.findByUid.mockResolvedValue(current);

      const delayed = makeFakeTask({ version: 2, dueAt: new Date('2026-05-01'), delayCount: 1 });
      repo.updateWithVersion.mockResolvedValue(delayed);
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.delayTask('user_1', 'task_abc123', { new_due_at: '2026-05-01' });

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].delayCount).toBe(1);
    });

    it('recomputes isOverdue=false and daysToDue>0 after delay to future date', async () => {
      const current = makeFakeTask({
        version: 1,
        dueAt: new Date('2026-03-20'),
        isOverdue: true,
        daysToDue: -12,
      });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(makeFakeTask({ version: 2, dueAt: new Date('2026-05-01') }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.delayTask('user_1', 'task_abc123', { new_due_at: '2026-05-01' });

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].isOverdue).toBe(false);
      expect(updateArgs[2].daysToDue).toBeGreaterThan(0);
    });

    it('clears overdueNotifiedLeaderAt after delay so leader can be notified again', async () => {
      const current = makeFakeTask({
        version: 1,
        dueAt: new Date('2026-03-20'),
        isOverdue: true,
        overdueNotifiedLeaderAt: new Date('2026-03-25'),
      });
      repo.findByUid.mockResolvedValue(current);
      repo.updateWithVersion.mockResolvedValue(makeFakeTask({ version: 2, dueAt: new Date('2026-05-01') }));
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.delayTask('user_1', 'task_abc123', { new_due_at: '2026-05-01' });

      const updateArgs = repo.updateWithVersion.mock.calls[0];
      expect(updateArgs[2].overdueNotifiedLeaderAt).toBeNull();
    });
  });

  const OWNER = { userIds: ['user_assignee'], role: 'employee' };
  const ADMIN = { userIds: ['someone_else'], role: 'boss' };
  const STRANGER = { userIds: ['stranger'], role: 'employee' };

  describe('restoreTask', () => {
    it('归属人恢复：读取已删除记录 + 调用 repository.restore 并返回 success', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask({ deletedAt: new Date() }));
      repo.restore.mockResolvedValue(makeFakeTask({ deletedAt: null }));
      const result = await service.restoreTask('task_abc123', OWNER);
      expect(repo.findByUid).toHaveBeenCalledWith('task_abc123', { includeDeleted: true });
      expect(repo.restore).toHaveBeenCalledWith('task_abc123');
      expect(result).toEqual({ success: true });
    });

    it('任务不存在或未删除时抛 TASK_NOT_FOUND', async () => {
      repo.findByUid.mockResolvedValue(null);
      await expect(service.restoreTask('task_missing', ADMIN)).rejects.toMatchObject({
        businessCode: ErrorCode.TASK_NOT_FOUND,
      });
    });

    it('无归属的普通用户恢复抛 1002 且不调用 restore', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask({ deletedAt: new Date() }));
      await expect(service.restoreTask('task_abc123', STRANGER)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
      });
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('admin 角色可恢复任意任务', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask({ deletedAt: new Date() }));
      repo.restore.mockResolvedValue(makeFakeTask({ deletedAt: null }));
      const r = await service.restoreTask('task_abc123', ADMIN);
      expect(r).toEqual({ success: true });
    });
  });

  describe('deleteTask', () => {
    it('归属人删除成功', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask());
      repo.softDelete.mockResolvedValue(makeFakeTask({ deletedAt: new Date() }));
      const r = await service.deleteTask('task_abc123', OWNER);
      expect(repo.softDelete).toHaveBeenCalledWith('task_abc123');
      expect(r).toEqual({ success: true });
    });

    it('无归属的普通用户删除抛 1002 且不软删除', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask());
      await expect(service.deleteTask('task_abc123', STRANGER)).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
      });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('任务不存在抛 TASK_NOT_FOUND', async () => {
      repo.findByUid.mockResolvedValue(null);
      await expect(service.deleteTask('missing', ADMIN)).rejects.toMatchObject({
        businessCode: ErrorCode.TASK_NOT_FOUND,
      });
    });
  });

  describe('任务可见性（私有）', () => {
    it('createTask private：强制 assignee=创建者、忽略协作人、visibility=private', async () => {
      repo.findOrgUser.mockResolvedValue(null);
      repo.getDefaultProject.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask());
      repo.insertProgressLog.mockResolvedValue(undefined);

      await service.createTask('ou_creator', {
        title: '个人 todo',
        priority: 'urgent_important',
        assignee_user_id: 'ou_someone_else',
        due_at: '2026-06-15',
        visibility: 'private',
        collaborators: [{ user_id: 'ou_x', user_name: 'X' }],
      });

      const insertArg = repo.insert.mock.calls[0][0];
      expect(insertArg.assigneeUserId).toBe('ou_creator'); // 强制本人
      expect(insertArg.visibility).toBe('private');
      expect(insertArg.collaborators).toBeNull();
    });

    it('createTask 默认 public', async () => {
      repo.findOrgUser.mockResolvedValue(null);
      repo.getDefaultProject.mockResolvedValue(null);
      repo.insert.mockResolvedValue(makeFakeTask());
      repo.insertProgressLog.mockResolvedValue(undefined);
      await service.createTask('ou_creator', {
        title: 'T', priority: 'urgent_important', assignee_user_id: 'ou_a', due_at: '2026-06-15',
      });
      expect(repo.insert.mock.calls[0][0].visibility).toBe('public');
    });

    it('getTask：他人读私有任务 → TASK_NOT_FOUND', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask({ visibility: 'private', createdBy: 'ou_owner', assigneeUserId: 'ou_owner', issuerUserId: 'ou_owner', leaderUserId: 'ou_owner' }));
      await expect(
        service.getTask('t', { userIds: ['ou_stranger'], role: 'employee' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.TASK_NOT_FOUND });
    });

    it('getTask：创建者读自己的私有任务 → 正常返回', async () => {
      const priv = makeFakeTask({ visibility: 'private', createdBy: 'ou_owner', assigneeUserId: 'ou_owner', issuerUserId: 'ou_owner', leaderUserId: 'ou_owner' });
      repo.findByUid.mockResolvedValue(priv);
      const r = await service.getTask('t', { userIds: ['ou_owner'], role: 'employee' });
      expect(r).toBe(priv);
    });

    it('publishTask：相关人可转公开', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask({ visibility: 'private', assigneeUserId: 'ou_owner' }));
      repo.updateField.mockResolvedValue(makeFakeTask({ visibility: 'public' }));
      const r = await service.publishTask('t', { userIds: ['ou_owner'], role: 'employee' });
      expect(repo.updateField).toHaveBeenCalledWith('t', expect.objectContaining({ visibility: 'public' }));
      expect(r).toEqual({ success: true });
    });

    it('publishTask：无关用户 → 1002', async () => {
      repo.findByUid.mockResolvedValue(makeFakeTask({ visibility: 'private', assigneeUserId: 'ou_owner' }));
      await expect(
        service.publishTask('t', { userIds: ['ou_stranger'], role: 'employee' }),
      ).rejects.toMatchObject({ businessCode: ErrorCode.UNAUTHORIZED });
      expect(repo.updateField).not.toHaveBeenCalled();
    });
  });

  describe('bulkAssignProject（批量归类）', () => {
    it('admin：全部可改 → 全更新', async () => {
      repo.findByUids.mockResolvedValue([
        makeFakeTask({ taskUid: 'a' }), makeFakeTask({ taskUid: 'b' }),
      ]);
      repo.bulkSetProject.mockImplementation(async (uids: string[]) => uids.length);
      const r = await service.bulkAssignProject({ userIds: ['ou_x'], role: 'admin' }, ['a', 'b'], 'proj_1');
      expect(repo.bulkSetProject).toHaveBeenCalledWith(['a', 'b'], 'proj_1');
      expect(r).toEqual({ updated: 2, skipped: 0 });
    });

    it('普通员工：只改有权的，其余 skipped', async () => {
      repo.findByUids.mockResolvedValue([
        makeFakeTask({ taskUid: 'a', assigneeUserId: 'ou_me' }),       // 有权
        makeFakeTask({ taskUid: 'b', assigneeUserId: 'ou_other', issuerUserId: 'ou_other', leaderUserId: 'ou_other', collaborators: null }), // 无权
      ]);
      repo.bulkSetProject.mockImplementation(async (uids: string[]) => uids.length);
      const r = await service.bulkAssignProject({ userIds: ['ou_me'], role: 'employee' }, ['a', 'b'], null);
      expect(repo.bulkSetProject).toHaveBeenCalledWith(['a'], null);
      expect(r).toEqual({ updated: 1, skipped: 1 });
    });

    it('空列表：updated/skipped 都 0，不查库', async () => {
      const r = await service.bulkAssignProject({ userIds: ['ou_me'], role: 'employee' }, [], 'p');
      expect(r).toEqual({ updated: 0, skipped: 0 });
      expect(repo.findByUids).not.toHaveBeenCalled();
    });
  });

  describe('reorderMyTasks（个人手动排序）', () => {
    it('按下标透传 task_uids 给 setUserOrder，返回 updated 数量', async () => {
      repo.setUserOrder.mockResolvedValue(undefined);
      const r = await service.reorderMyTasks('ou_me', ['t3', 't1', 't2']);
      expect(repo.setUserOrder).toHaveBeenCalledWith('ou_me', ['t3', 't1', 't2']);
      expect(r).toEqual({ updated: 3 });
    });

    it('去重保序：重复 uid 只保留首次出现', async () => {
      repo.setUserOrder.mockResolvedValue(undefined);
      const r = await service.reorderMyTasks('ou_me', ['t1', 't2', 't1', 't3', 't2']);
      expect(repo.setUserOrder).toHaveBeenCalledWith('ou_me', ['t1', 't2', 't3']);
      expect(r).toEqual({ updated: 3 });
    });

    it('空列表：不报错，updated=0', async () => {
      repo.setUserOrder.mockResolvedValue(undefined);
      const r = await service.reorderMyTasks('ou_me', []);
      expect(r).toEqual({ updated: 0 });
    });
  });
});
