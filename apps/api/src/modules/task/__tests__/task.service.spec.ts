import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  });

  describe('delayTask', () => {
    it('updates due_at and delay_reason', async () => {
      const current = makeFakeTask({ version: 1 });
      repo.findByUid.mockResolvedValue(current);

      const delayed = makeFakeTask({
        version: 2,
        dueAt: new Date('2026-05-01'),
        delayReason: 'Waiting for vendor',
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
      expect(updateArgs[2].monthBucket).toBe('2026-05');

      expect(repo.insertProgressLog).toHaveBeenCalledOnce();
    });
  });
});
