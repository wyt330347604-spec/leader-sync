import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('api/v1/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('boss')
  async bossDashboard(
    @Query('month') month?: string,
    @Query('quarter') quarter?: string,
    @Query('year') year?: string,
  ) {
    if (year) return this.dashboardService.getBossDashboard({ type: 'year', value: year });
    if (quarter) return this.dashboardService.getBossDashboard({ type: 'quarter', value: quarter });
    return this.dashboardService.getBossDashboard({ type: 'month', value: month });
  }
}
