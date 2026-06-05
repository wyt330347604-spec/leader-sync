import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { IncidentService } from './incident.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';
import { ConfirmIncidentDto } from './dto/confirm-incident.dto';
import { RejectIncidentDto } from './dto/reject-incident.dto';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  // ── POST /incidents ──────────────────────────────────────────────────────
  @Post('incidents')
  createIncident(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateIncidentDto,
  ) {
    return this.incidentService.createIncident(user.user_id, user.user_name, dto);
  }

  // ── GET /incidents ───────────────────────────────────────────────────────
  @Get('incidents')
  listIncidents(
    @CurrentUser() user: CurrentUserPayload,
    @Query('severity') severity?: string,
    @Query('confirm_status') confirmStatus?: string,
    @Query('month') month?: string,
    @Query('user_id') userId?: string,
    @Query('project_uid') projectUid?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.incidentService.listIncidents(
      user.user_id,
      user.role,
      { severity, confirmStatus, month, userId, projectUid },
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  // ── GET /incidents/:uid ──────────────────────────────────────────────────
  @Get('incidents/:incident_uid')
  getIncident(
    @CurrentUser() user: CurrentUserPayload,
    @Param('incident_uid') incidentUid: string,
  ) {
    return this.incidentService.getIncident(incidentUid, user.user_id, user.role);
  }

  // ── PATCH /incidents/:uid ────────────────────────────────────────────────
  @Patch('incidents/:incident_uid')
  updateIncident(
    @CurrentUser() user: CurrentUserPayload,
    @Param('incident_uid') incidentUid: string,
    @Body() dto: UpdateIncidentDto,
  ) {
    return this.incidentService.updateIncident(incidentUid, user.user_id, user.role, dto);
  }

  // ── POST /incidents/:uid/confirm ─────────────────────────────────────────
  @Post('incidents/:incident_uid/confirm')
  confirmIncident(
    @CurrentUser() user: CurrentUserPayload,
    @Param('incident_uid') incidentUid: string,
    @Body() _dto: ConfirmIncidentDto,
  ) {
    return this.incidentService.confirmIncident(incidentUid, user.user_id, user.role);
  }

  // ── POST /incidents/:uid/reject ──────────────────────────────────────────
  @Post('incidents/:incident_uid/reject')
  rejectIncident(
    @CurrentUser() user: CurrentUserPayload,
    @Param('incident_uid') incidentUid: string,
    @Body() dto: RejectIncidentDto,
  ) {
    return this.incidentService.rejectIncident(incidentUid, user.user_id, user.role, dto);
  }

  // ── DELETE /incidents/:uid ───────────────────────────────────────────────
  @Delete('incidents/:incident_uid')
  deleteIncident(
    @CurrentUser() user: CurrentUserPayload,
    @Param('incident_uid') incidentUid: string,
  ) {
    return this.incidentService.deleteIncident(incidentUid, user.user_id, user.role);
  }

  // ── GET /me/incidents ────────────────────────────────────────────────────
  @Get('me/incidents')
  listMyIncidents(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('severity') severity?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.incidentService.listMyIncidents(
      user.user_id,
      month,
      severity,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  // ── GET /users/:user_id/incidents/monthly-summary ────────────────────────
  @Get('users/:user_id/incidents/monthly-summary')
  getMonthlySummary(
    @CurrentUser() user: CurrentUserPayload,
    @Param('user_id') userId: string,
    @Query('month') month: string,
  ) {
    return this.incidentService.getMonthlySummary(userId, month, user.role);
  }
}
