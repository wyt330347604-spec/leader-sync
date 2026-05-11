import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectService, ProjectInput, ProjectPatch } from './project.service';

const PROJECT_ADMIN_IDS = new Set([
  'ou_243a9225acc248c148c25f8fe0699407', // Tobi
  'ou_1c419560953e219d5876918a2b934dfb', // Harvey/王永涛
  'ou_5a06e17c2ec88a72a2ef4ce040b3d77d', // 杨平
  // dev fixtures (only issuable via /api/v1/auth/dev-login when NODE_ENV=development)
  'ou_dev_harvey',
  'ou_dev_boss',
]);

function isProjectAdmin(user: CurrentUserPayload): boolean {
  return PROJECT_ADMIN_IDS.has(user.open_id ?? '') || PROJECT_ADMIN_IDS.has(user.user_id);
}

function requireProjectAdmin(user: CurrentUserPayload): void {
  if (!isProjectAdmin(user)) {
    throw new BusinessException(1002, 'No permission', HttpStatus.FORBIDDEN);
  }
}

@Controller('api/v1/projects')
@UseGuards(AuthGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  list() {
    return this.projectService.list();
  }

  @Get('permissions')
  getPermissions(@CurrentUser() user: CurrentUserPayload) {
    return { canManage: isProjectAdmin(user) };
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() body: ProjectInput) {
    requireProjectAdmin(user);
    if (!body?.name?.trim()) {
      throw new BusinessException(1001, 'name is required');
    }
    return this.projectService.create(body);
  }

  @Patch(':project_uid')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('project_uid') projectUid: string,
    @Body() body: ProjectPatch,
  ) {
    requireProjectAdmin(user);
    return this.projectService.update(projectUid, body);
  }

  @Delete(':project_uid')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('project_uid') projectUid: string) {
    requireProjectAdmin(user);
    return this.projectService.remove(projectUid);
  }

  @Post(':project_uid/set-default')
  setDefault(@CurrentUser() user: CurrentUserPayload, @Param('project_uid') uid: string) {
    requireProjectAdmin(user);
    return this.projectService.setDefault(uid);
  }
}
