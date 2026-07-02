import { Controller, Get, Patch, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { OrgService } from './org.service';
import { SetManagerDto } from './dto/set-manager.dto';

@Controller('api/v1/org')
@UseGuards(AuthGuard)
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  /**
   * GET /api/v1/org/tree
   * 组织树数据（全员 + 上下级 + 来源 + can_edit）。任意登录用户可读。
   */
  @Get('tree')
  getTree(@CurrentUser() user: CurrentUserPayload) {
    return this.orgService.getTree({ userId: user.user_id, openId: user.open_id });
  }

  /**
   * PATCH /api/v1/org/users/:user_id/manager
   * 人工调整直属上级（拖拽落定）。仅白名单（Harvey/杨平）。
   */
  @Patch('users/:user_id/manager')
  setManager(
    @CurrentUser() user: CurrentUserPayload,
    @Param('user_id') targetUserId: string,
    @Body() dto: SetManagerDto,
  ) {
    return this.orgService.setManager(
      { userId: user.user_id, openId: user.open_id },
      targetUserId,
      dto.manager_user_id ?? null,
    );
  }

  /**
   * POST /api/v1/org/users/:user_id/manager/reset
   * 恢复飞书默认（source 翻回 feishu，下次通讯录同步刷新）。仅白名单（Harvey/杨平）。
   */
  @Post('users/:user_id/manager/reset')
  resetManager(@CurrentUser() user: CurrentUserPayload, @Param('user_id') targetUserId: string) {
    return this.orgService.resetManagerToFeishu({ userId: user.user_id, openId: user.open_id }, targetUserId);
  }
}
