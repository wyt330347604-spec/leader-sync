import { Injectable, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { TaskRepository } from './task.repository';
import {
  validateTransition,
  InvalidTransitionError,
  MissingStallReasonError,
  generateTaskUid,
  generateLogUid,
} from '@leader-sync/domain-core';
import {
  ErrorCode,
  TaskStatus,
  SourceType,
  type PaginatedData,
  type CreateTaskDto,
  type UpdateTaskDto,
  type AssignTaskDto,
  type CompleteTaskDto,
  type DelayTaskDto,
  type TaskListQuery,
} from '@leader-sync/shared-types';

@Injectable()
export class TaskService {
  constructor(private readonly taskRepository: TaskRepository) {}

  async createTask(userId: string, dto: CreateTaskDto) {
    const taskUid = generateTaskUid();

    const assignee = await this.taskRepository.findOrgUser(dto.assignee_user_id);

    const monthBucket = dto.due_at.slice(0, 7);
    const status = dto.assignee_user_id ? TaskStatus.NOT_STARTED : TaskStatus.PENDING;

    // Resolve project
    let projectUid = dto.project_uid ?? null;
    if (!projectUid) {
      const defaultProject = await this.taskRepository.getDefaultProject();
      projectUid = defaultProject?.projectUid ?? null;
    }

    const created = await this.taskRepository.insert({
      taskUid,
      title: dto.title,
      detail: dto.detail ?? null,
      taskType: dto.task_type,
      priority: dto.priority,
      status,
      progressPercent: 0,
      assigneeUserId: dto.assignee_user_id,
      assigneeName: assignee?.userName ?? '',
      assigneeManagerUserId: assignee?.managerUserId ?? null,
      assigneeManagerName: assignee?.managerName ?? null,
      assigneeDeptId: assignee?.deptId ?? null,
      assigneeDeptName: assignee?.deptName ?? null,
      leaderUserId: assignee?.managerUserId ?? userId,
      leaderName: assignee?.managerName ?? null,
      issuerUserId: userId,
      assignerUserId: userId,
      assignmentType: dto.assignment_type ?? 'boss_assign',
      collaborators: dto.collaborators ?? null,
      startAt: dto.start_at ? new Date(dto.start_at) : null,
      dueAt: new Date(dto.due_at),
      monthBucket,
      bossAttentionFlag: dto.boss_attention_flag ?? false,
      projectUid,
      version: 1,
      createdBy: userId,
    });

    await this.taskRepository.insertProgressLog({
      logUid: generateLogUid(),
      taskUid,
      sourceType: SourceType.API,
      operatorUserId: userId,
      newStatus: status,
      logText: 'Task created',
    });

    return created;
  }

  async getTask(taskUid: string) {
    const found = await this.taskRepository.findByUid(taskUid);
    if (!found) {
      throw new BusinessException(ErrorCode.TASK_NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    }
    return found;
  }

  async updateTask(userId: string, taskUid: string, dto: UpdateTaskDto) {
    const current = await this.getTask(taskUid);

    if (dto.status) {
      try {
        validateTransition(current.status, dto.status, {
          stall_reason: dto.stall_reason,
        });
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          throw new BusinessException(
            ErrorCode.INVALID_STATUS_TRANSITION,
            error.message,
          );
        }
        if (error instanceof MissingStallReasonError) {
          throw new BusinessException(
            ErrorCode.INVALID_PARAMS,
            'stall_reason required',
          );
        }
        throw error;
      }
    }

    const updateValues: Record<string, unknown> = { updatedBy: userId };

    if (dto.title !== undefined) updateValues.title = dto.title;
    if (dto.detail !== undefined) updateValues.detail = dto.detail;
    if (dto.status !== undefined) updateValues.status = dto.status;
    if (dto.priority !== undefined) updateValues.priority = dto.priority;
    if (dto.progress_percent !== undefined) updateValues.progressPercent = dto.progress_percent;
    if (dto.latest_progress !== undefined) updateValues.latestProgress = dto.latest_progress;
    if (dto.due_at !== undefined) updateValues.dueAt = new Date(dto.due_at);
    if (dto.stall_reason !== undefined) updateValues.stallReason = dto.stall_reason;
    if (dto.delay_reason !== undefined) updateValues.delayReason = dto.delay_reason;
    if (dto.project_uid !== undefined) updateValues.projectUid = dto.project_uid;

    if (dto.status === TaskStatus.DONE) {
      updateValues.progressPercent = 100;
      updateValues.completedAt = dto.completed_at ? new Date(dto.completed_at) : new Date();
    }

    const updated = await this.taskRepository.updateWithVersion(
      taskUid,
      dto.version,
      updateValues,
    );

    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict',
        HttpStatus.CONFLICT,
      );
    }

    await this.taskRepository.insertProgressLog({
      logUid: generateLogUid(),
      taskUid,
      sourceType: SourceType.API,
      operatorUserId: userId,
      oldStatus: current.status,
      newStatus: dto.status ?? current.status,
      logText: 'Task updated',
    });

    return updated;
  }

  async completeTask(userId: string, taskUid: string, dto: CompleteTaskDto) {
    const current = await this.getTask(taskUid);

    try {
      validateTransition(current.status, TaskStatus.DONE);
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw new BusinessException(
          ErrorCode.INVALID_STATUS_TRANSITION,
          error.message,
        );
      }
      throw error;
    }

    const updated = await this.taskRepository.updateWithVersion(
      taskUid,
      current.version,
      {
        status: TaskStatus.DONE,
        progressPercent: 100,
        completedAt: dto.completed_at ? new Date(dto.completed_at) : new Date(),
        latestProgress: dto.latest_progress ?? current.latestProgress,
        updatedBy: userId,
      },
    );

    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict',
        HttpStatus.CONFLICT,
      );
    }

    await this.taskRepository.insertProgressLog({
      logUid: generateLogUid(),
      taskUid,
      sourceType: SourceType.API,
      operatorUserId: userId,
      oldStatus: current.status,
      newStatus: TaskStatus.DONE,
      logText: 'Task completed',
    });

    return updated;
  }

  async assignTask(userId: string, taskUid: string, dto: AssignTaskDto) {
    const current = await this.getTask(taskUid);

    const assignee = await this.taskRepository.findOrgUser(dto.assignee_user_id);

    const updated = await this.taskRepository.updateWithVersion(
      taskUid,
      current.version,
      {
        assigneeUserId: dto.assignee_user_id,
        assigneeName: assignee?.userName ?? '',
        assigneeManagerUserId: assignee?.managerUserId ?? null,
        assigneeManagerName: assignee?.managerName ?? null,
        assigneeDeptId: assignee?.deptId ?? null,
        assigneeDeptName: assignee?.deptName ?? null,
        assignerUserId: userId,
        assignmentType: dto.assignment_type,
        updatedBy: userId,
      },
    );

    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict',
        HttpStatus.CONFLICT,
      );
    }

    await this.taskRepository.insertProgressLog({
      logUid: generateLogUid(),
      taskUid,
      sourceType: SourceType.API,
      operatorUserId: userId,
      logText: `Task reassigned to ${dto.assignee_user_id}`,
    });

    return updated;
  }

  async delayTask(userId: string, taskUid: string, dto: DelayTaskDto) {
    const current = await this.getTask(taskUid);

    const updated = await this.taskRepository.updateWithVersion(
      taskUid,
      current.version,
      {
        dueAt: new Date(dto.new_due_at),
        delayReason: dto.delay_reason,
        monthBucket: dto.new_due_at.slice(0, 7),
        updatedBy: userId,
      },
    );

    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        'Version conflict',
        HttpStatus.CONFLICT,
      );
    }

    await this.taskRepository.insertProgressLog({
      logUid: generateLogUid(),
      taskUid,
      sourceType: SourceType.API,
      operatorUserId: userId,
      logText: `Task delayed to ${dto.new_due_at}`,
    });

    return updated;
  }

  async toggleImportant(userId: string, taskUid: string) {
    const existing = await this.taskRepository.findByUid(taskUid);
    if (!existing) {
      throw new BusinessException(ErrorCode.TASK_NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    }
    const newValue = !existing.bossAttentionFlag;
    const result = await this.taskRepository.updateWithVersion(taskUid, existing.version, {
      bossAttentionFlag: newValue,
      updatedBy: userId,
    });
    if (!result) {
      throw new BusinessException(ErrorCode.VERSION_CONFLICT, 'Version conflict', HttpStatus.CONFLICT);
    }
    return result;
  }

  async notifyLeader(_userId: string, taskUid: string) {
    const existing = await this.taskRepository.findByUid(taskUid);
    if (!existing) {
      throw new BusinessException(ErrorCode.TASK_NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    }
    // MVP: return success flag. Actual Feishu messaging will be wired in batch 2.
    return { notified: true, taskUid };
  }

  async listMyTasks(userId: string, openId: string | undefined, query: TaskListQuery): Promise<PaginatedData<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;

    const { items, total } = await this.taskRepository.listByUser(
      userId,
      openId,
      {
        status: query.status,
        bucket: query.bucket,
        priority: query.priority,
        role: query.role,
      },
      page,
      pageSize,
    );

    return { items, total, page, page_size: pageSize };
  }

  async addLeader(taskUid: string, leaderUserId: string, leaderName?: string) {
    const existing = await this.taskRepository.findByUid(taskUid);
    if (!existing) {
      throw new BusinessException(ErrorCode.TASK_NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    }

    const result = await this.taskRepository.addTaskLeader({
      taskUid,
      leaderUserId,
      leaderName: leaderName ?? null,
    });

    return result;
  }

  async removeLeader(taskUid: string, leaderUserId: string) {
    await this.taskRepository.removeTaskLeader(taskUid, leaderUserId);
    return { removed: true };
  }

  async getLeaders(taskUid: string) {
    return this.taskRepository.getTaskLeaders(taskUid);
  }

  async addCollaborator(
    currentUser: { user_id: string },
    taskUid: string,
    userId: string,
    userName: string,
  ) {
    const existing = await this.taskRepository.findByUid(taskUid);
    if (!existing) {
      throw new BusinessException(ErrorCode.TASK_NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    }

    const collaborators: { user_id: string; user_name: string }[] =
      (existing.collaborators as { user_id: string; user_name: string }[]) || [];

    // Don't add if already a collaborator
    if (collaborators.some((c) => c.user_id === userId)) {
      return { collaborators };
    }

    const updated = [...collaborators, { user_id: userId, user_name: userName }];
    await this.taskRepository.updateWithVersion(taskUid, existing.version, {
      collaborators: updated,
      updatedBy: currentUser.user_id,
    });

    return { collaborators: updated };
  }

  async removeCollaborator(taskUid: string, userId: string) {
    const existing = await this.taskRepository.findByUid(taskUid);
    if (!existing) {
      throw new BusinessException(ErrorCode.TASK_NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    }

    const collaborators: { user_id: string; user_name: string }[] =
      (existing.collaborators as { user_id: string; user_name: string }[]) || [];
    const updated = collaborators.filter((c) => c.user_id !== userId);

    await this.taskRepository.updateWithVersion(taskUid, existing.version, {
      collaborators: updated,
      updatedBy: 'system',
    });

    return { collaborators: updated };
  }

  async getCollaborators(taskUid: string) {
    const existing = await this.taskRepository.findByUid(taskUid);
    if (!existing) {
      throw new BusinessException(ErrorCode.TASK_NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    }
    return existing.collaborators || [];
  }
}
