import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('api/v1/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('boss')
  async bossDashboard(@Query('month') month?: string) {
    return this.dashboardService.getBossDashboard(month);
  }
}
