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
});
