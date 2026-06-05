import { Controller, Get, Param, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';
import { BusinessException } from '../../common/exceptions/business.exception';
import { DashboardService } from './dashboard.service';

/** 可查看「全员概览」（全公司数据）的角色：仅 Boss / PMO / Admin。 */
const COMPANY_VIEW_ROLES = new Set<string>([UserRole.BOSS, UserRole.PMO, UserRole.ADMIN]);

@Controller('api/v1/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  private requireCompanyView(role: string) {
    if (!COMPANY_VIEW_ROLES.has(role)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'NO_PERMISSION: company-wide dashboard requires Boss/PMO/Admin',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @Get('boss')
  async bossDashboard(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('quarter') quarter?: string,
    @Query('year') year?: string,
  ) {
    this.requireCompanyView(user.role);
    if (year) return this.dashboardService.getBossDashboard({ type: 'year', value: year });
    if (quarter) return this.dashboardService.getBossDashboard({ type: 'quarter', value: quarter });
    return this.dashboardService.getBossDashboard({ type: 'month', value: month });
  }

  @Get('projects')
  async projectPortfolio(@CurrentUser() user: CurrentUserPayload) {
    this.requireCompanyView(user.role);
    return this.dashboardService.getProjectPortfolio();
  }

  @Get('gantt')
  async ganttData(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('quarter') quarter?: string,
    @Query('year') year?: string,
  ) {
    this.requireCompanyView(user.role);
    if (year) return this.dashboardService.getGanttData({ type: 'year', value: year });
    if (quarter) return this.dashboardService.getGanttData({ type: 'quarter', value: quarter });
    return this.dashboardService.getGanttData({ type: 'month', value: month });
  }

  /**
   * GET /api/v1/dashboard/leader/monthly
   * Leader: monthly team summary — aggregated stats per member.
   */
  @Get('leader/monthly')
  async leaderMonthly(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
  ) {
    return this.dashboardService.getLeaderMonthly(user.user_id, user.user_name, month);
  }

  /**
   * GET /api/v1/dashboard/leader/monthly/:member_user_id/tasks
   * Leader: drill-down into a specific member's task list for the month.
   * Returns 1002 NO_PERMISSION if the requesting leader has no task association.
   */
  @Get('leader/monthly/:member_user_id/tasks')
  async leaderMemberTasks(
    @CurrentUser() user: CurrentUserPayload,
    @Param('member_user_id') memberUserId: string,
    @Query('month') month?: string,
  ) {
    return this.dashboardService.getLeaderMemberTasks(user.user_id, memberUserId, month);
  }

  /**
   * GET /api/v1/dashboard/leader/weekly
   * Leader: current week progress (new / done / overdue) per member.
   */
  @Get('leader/weekly')
  async leaderWeekly(@CurrentUser() user: CurrentUserPayload) {
    return this.dashboardService.getLeaderWeekly(user.user_id, user.user_name);
  }

  /**
   * GET /api/v1/dashboard/me/monthly
   * Employee self-view: current user's monthly task summary.
   */
  @Get('me/monthly')
  async myMonthly(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
  ) {
    return this.dashboardService.getMyMonthly(user.user_id, user.user_name, month);
  }
}
