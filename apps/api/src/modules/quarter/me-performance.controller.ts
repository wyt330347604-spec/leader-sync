import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { MePerformanceService } from './me-performance.service';
import type { Requestor } from './quarter.service';

function requestor(user: CurrentUserPayload): Requestor {
  return { userId: user.user_id, role: user.role, openId: user.open_id };
}

@Controller('api/v1/me')
@UseGuards(AuthGuard)
export class MePerformanceController {
  constructor(private readonly service: MePerformanceService) {}

  /** 当前登录人绩效档案（月度走势 + 季度/半年成绩 + 职级 + 定级资格）。 */
  @Get('performance')
  myPerformance(@CurrentUser() user: CurrentUserPayload) {
    return this.service.getMyPerformance(requestor(user));
  }
}
