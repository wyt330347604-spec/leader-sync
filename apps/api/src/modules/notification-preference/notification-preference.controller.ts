import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { NotificationPreferenceService } from './notification-preference.service';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

@Controller('api/v1/me/notification-preference')
@UseGuards(AuthGuard)
export class NotificationPreferenceController {
  constructor(private readonly service: NotificationPreferenceService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserPayload) {
    return this.service.getForUser(user.user_id);
  }

  @Patch()
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.service.updateForUser(user.user_id, dto);
  }
}
