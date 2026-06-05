import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { TaskService } from './task.service';
import { TaskWriteGuard } from './task-write.guard';
import { requesterFrom } from './task-permissions';
import {
  CreateTaskRequestDto,
  UpdateTaskRequestDto,
  AssignTaskRequestDto,
  CompleteTaskRequestDto,
  DelayTaskRequestDto,
  ReorderTasksRequestDto,
  BulkAssignProjectRequestDto,
} from './dto';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post('tasks')
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateTaskRequestDto) {
    return this.taskService.createTask(user.user_id, dto);
  }

  @Get('tasks/:task_uid')
  getOne(@CurrentUser() user: CurrentUserPayload, @Param('task_uid') taskUid: string) {
    return this.taskService.getTask(taskUid, {
      userIds: [user.user_id, user.open_id].filter(Boolean) as string[],
      role: user.role,
    });
  }

  @Delete('tasks/:task_uid')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('task_uid') taskUid: string) {
    return this.taskService.deleteTask(taskUid, {
      userIds: [user.user_id, user.open_id].filter(Boolean) as string[],
      role: user.role,
    });
  }

  @Post('tasks/:task_uid/restore')
  restore(@CurrentUser() user: CurrentUserPayload, @Param('task_uid') taskUid: string) {
    return this.taskService.restoreTask(taskUid, {
      userIds: [user.user_id, user.open_id].filter(Boolean) as string[],
      role: user.role,
    });
  }

  @Post('tasks/:task_uid/publish')
  @UseGuards(TaskWriteGuard)
  publish(@CurrentUser() user: CurrentUserPayload, @Param('task_uid') taskUid: string) {
    return this.taskService.publishTask(taskUid, {
      userIds: [user.user_id, user.open_id].filter(Boolean) as string[],
      role: user.role,
    });
  }

  @Patch('tasks/:task_uid')
  @UseGuards(TaskWriteGuard)
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: UpdateTaskRequestDto,
  ) {
    return this.taskService.updateTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/assign')
  @UseGuards(TaskWriteGuard)
  assign(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: AssignTaskRequestDto,
  ) {
    return this.taskService.assignTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/complete')
  @UseGuards(TaskWriteGuard)
  complete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: CompleteTaskRequestDto,
  ) {
    return this.taskService.completeTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/delay')
  @UseGuards(TaskWriteGuard)
  delay(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: DelayTaskRequestDto,
  ) {
    return this.taskService.delayTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/toggle-important')
  @UseGuards(TaskWriteGuard)
  toggleImportant(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
  ) {
    return this.taskService.toggleImportant(user.user_id, taskUid);
  }

  @Post('tasks/:task_uid/notify-leader')
  @UseGuards(TaskWriteGuard)
  notifyLeader(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
  ) {
    return this.taskService.notifyLeader(user.user_id, taskUid);
  }

  @Patch('tasks/:task_uid/status')
  @UseGuards(TaskWriteGuard)
  updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() body: { status: string; version: number },
  ) {
    return this.taskService.updateTask(user.user_id, taskUid, {
      version: body.version,
      status: body.status as any,
    });
  }

  @Patch('tasks/:task_uid/priority')
  @UseGuards(TaskWriteGuard)
  updatePriority(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() body: { priority: string; version: number },
  ) {
    return this.taskService.updateTask(user.user_id, taskUid, {
      version: body.version,
      priority: body.priority as any,
    });
  }

  @Patch('tasks/:task_uid/progress')
  @UseGuards(TaskWriteGuard)
  updateProgress(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() body: { progress_percent: number; latest_progress?: string; version: number },
  ) {
    return this.taskService.updateTask(user.user_id, taskUid, {
      version: body.version,
      progress_percent: body.progress_percent,
      latest_progress: body.latest_progress,
    });
  }

  @Get('me/tasks')
  listMyTasks(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: string,
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('priority') priority?: string,
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.taskService.listMyTasks(user.user_id, user.open_id, {
      status: status as any,
      bucket,
      from,
      priority: priority as any,
      role: role as any,
      page: page ? parseInt(page, 10) : 1,
      page_size: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  /**
   * PUT /api/v1/me/tasks/order
   * 保存当前用户对一组任务的手动排序（个人视图，按下标写 position）。
   * 仅写自己的排序偏好，无需任务写权限。
   */
  @Put('me/tasks/order')
  reorderMyTasks(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ReorderTasksRequestDto,
  ) {
    return this.taskService.reorderMyTasks(user.user_id, dto.task_uids);
  }

  /**
   * PUT /api/v1/tasks/bulk-project
   * 批量把任务归类到某项目（未归属 triage）。project_uid=null 移回未归属。
   * 逐条按 canMutateTask 过滤，仅改有权的任务。
   */
  @Put('tasks/bulk-project')
  bulkAssignProject(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: BulkAssignProjectRequestDto,
  ) {
    return this.taskService.bulkAssignProject(
      requesterFrom(user),
      dto.task_uids,
      dto.project_uid ?? null,
    );
  }

  @Post('tasks/:task_uid/leaders')
  @UseGuards(TaskWriteGuard)
  addLeader(
    @CurrentUser() _user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() body: { leader_user_id: string; leader_name?: string },
  ) {
    return this.taskService.addLeader(taskUid, body.leader_user_id, body.leader_name);
  }

  @Delete('tasks/:task_uid/leaders/:leader_user_id')
  @UseGuards(TaskWriteGuard)
  removeLeader(
    @CurrentUser() _user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Param('leader_user_id') leaderUserId: string,
  ) {
    return this.taskService.removeLeader(taskUid, leaderUserId);
  }

  @Get('tasks/:task_uid/leaders')
  getLeaders(@Param('task_uid') taskUid: string) {
    return this.taskService.getLeaders(taskUid);
  }

  @Post('tasks/:task_uid/collaborators')
  @UseGuards(TaskWriteGuard)
  addCollaborator(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() body: { user_id: string; user_name: string },
  ) {
    return this.taskService.addCollaborator(user, taskUid, body.user_id, body.user_name);
  }

  @Delete('tasks/:task_uid/collaborators/:collaborator_id')
  @UseGuards(TaskWriteGuard)
  removeCollaborator(
    @CurrentUser() _user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Param('collaborator_id') collaboratorId: string,
  ) {
    return this.taskService.removeCollaborator(taskUid, collaboratorId);
  }

  @Get('tasks/:task_uid/collaborators')
  getCollaborators(@Param('task_uid') taskUid: string) {
    return this.taskService.getCollaborators(taskUid);
  }
}
