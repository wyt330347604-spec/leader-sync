import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { TaskService } from './task.service';
import {
  CreateTaskRequestDto,
  UpdateTaskRequestDto,
  AssignTaskRequestDto,
  CompleteTaskRequestDto,
  DelayTaskRequestDto,
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
  getOne(@Param('task_uid') taskUid: string) {
    return this.taskService.getTask(taskUid);
  }

  @Patch('tasks/:task_uid')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: UpdateTaskRequestDto,
  ) {
    return this.taskService.updateTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/assign')
  assign(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: AssignTaskRequestDto,
  ) {
    return this.taskService.assignTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/complete')
  complete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: CompleteTaskRequestDto,
  ) {
    return this.taskService.completeTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/delay')
  delay(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() dto: DelayTaskRequestDto,
  ) {
    return this.taskService.delayTask(user.user_id, taskUid, dto);
  }

  @Post('tasks/:task_uid/toggle-important')
  toggleImportant(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
  ) {
    return this.taskService.toggleImportant(user.user_id, taskUid);
  }

  @Post('tasks/:task_uid/notify-leader')
  notifyLeader(
    @CurrentUser() user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
  ) {
    return this.taskService.notifyLeader(user.user_id, taskUid);
  }

  @Patch('tasks/:task_uid/status')
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
    @Query('priority') priority?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.taskService.listMyTasks(user.user_id, {
      status: status as any,
      bucket,
      priority: priority as any,
      page: page ? parseInt(page, 10) : 1,
      page_size: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  @Post('tasks/:task_uid/leaders')
  addLeader(
    @CurrentUser() _user: CurrentUserPayload,
    @Param('task_uid') taskUid: string,
    @Body() body: { leader_user_id: string; leader_name?: string },
  ) {
    return this.taskService.addLeader(taskUid, body.leader_user_id, body.leader_name);
  }

  @Delete('tasks/:task_uid/leaders/:leader_user_id')
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
}
