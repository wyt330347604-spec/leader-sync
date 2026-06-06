import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirementService, type Requester } from './requirement.service';
import { CreateRequirementDto, UpdateRequirementDto, LinkTasksDto, AddArtifactDto, ImpactPreviewDto } from './dto/requirement.dto';

function requesterFrom(user: CurrentUserPayload): Requester {
  return {
    userIds: [user.user_id, user.open_id].filter(Boolean) as string[],
    userName: user.user_name,
    role: user.role,
  };
}

@Controller('api/v1')
@UseGuards(AuthGuard)
export class RequirementController {
  constructor(private readonly svc: RequirementService) {}

  @Post('requirements')
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateRequirementDto) {
    return this.svc.create({ userId: user.user_id, userName: user.user_name }, dto);
  }

  @Post('requirements/impact-preview')
  impactPreview(@Body() dto: ImpactPreviewDto) {
    return this.svc.impactPreview(dto);
  }

  @Get('requirements')
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('business_line_uid') businessLineUid?: string,
    @Query('app_project_uid') appProjectUid?: string,
    @Query('status') status?: string,
    @Query('pm_user_id') pmUserId?: string,
    @Query('priority') priority?: string,
    @Query('target_version') targetVersion?: string,
  ) {
    return this.svc.list(requesterFrom(user), { businessLineUid, appProjectUid, status, pmUserId, priority, targetVersion });
  }

  @Get('requirements/gantt')
  gantt(
    @CurrentUser() user: CurrentUserPayload,
    @Query('business_line_uid') businessLineUid?: string,
    @Query('app_project_uid') appProjectUid?: string,
  ) {
    return this.svc.ganttRequirements(requesterFrom(user), { businessLineUid, appProjectUid });
  }

  @Get('requirements/capacity')
  capacity() {
    return this.svc.capacity();
  }

  @Get('requirements/:uid')
  getOne(@Param('uid') uid: string) {
    return this.svc.getOne(uid);
  }

  @Get('requirements/:uid/candidate-tasks')
  candidateTasks(@Param('uid') uid: string) {
    return this.svc.candidateTasks(uid);
  }

  @Patch('requirements/:uid')
  update(@CurrentUser() user: CurrentUserPayload, @Param('uid') uid: string, @Body() dto: UpdateRequirementDto) {
    return this.svc.update(uid, requesterFrom(user), dto);
  }

  @Post('requirements/:uid/claim')
  claim(@CurrentUser() user: CurrentUserPayload, @Param('uid') uid: string) {
    return this.svc.claim(uid, requesterFrom(user));
  }

  @Post('requirements/:uid/tasks')
  linkTasks(@CurrentUser() user: CurrentUserPayload, @Param('uid') uid: string, @Body() dto: LinkTasksDto) {
    return this.svc.linkTasks(uid, requesterFrom(user), dto);
  }

  @Post('requirements/:uid/artifacts')
  addArtifact(@CurrentUser() user: CurrentUserPayload, @Param('uid') uid: string, @Body() dto: AddArtifactDto) {
    return this.svc.addArtifact(uid, requesterFrom(user), dto);
  }
}
