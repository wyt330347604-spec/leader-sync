import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ProjectService } from './project.service';

@Controller('api/v1/projects')
@UseGuards(AuthGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  list() {
    return this.projectService.list();
  }

  @Post()
  create(@Body() body: { name: string }) {
    return this.projectService.create(body.name);
  }

  @Patch(':project_uid')
  update(
    @Param('project_uid') projectUid: string,
    @Body() body: { name: string },
  ) {
    return this.projectService.update(projectUid, body.name);
  }

  @Delete(':project_uid')
  remove(@Param('project_uid') projectUid: string) {
    return this.projectService.remove(projectUid);
  }
}
