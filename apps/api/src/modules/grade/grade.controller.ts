import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { GradeService } from './grade.service';
import type { SetGradeDto } from './dto/set-grade.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';

// Roles allowed to write grade changes
const WRITE_ALLOWED_ROLES = new Set<string>([UserRole.BOSS, UserRole.PMO, UserRole.ADMIN]);

// Roles allowed to view all-employee grade overview
const READ_ALL_ROLES = new Set<string>([UserRole.BOSS, UserRole.PMO, UserRole.ADMIN]);

@Controller('api/v1')
@UseGuards(AuthGuard)
export class GradeController {
  constructor(private readonly gradeService: GradeService) {}

  /**
   * GET /api/v1/users/:user_id/grade
   * View the current grade of a specific user.
   * Permission: self / direct leader / boss / pmo / admin
   */
  @Get('users/:user_id/grade')
  getCurrentGrade(
    @CurrentUser() user: CurrentUserPayload,
    @Param('user_id') targetUserId: string,
  ) {
    return this.gradeService.getCurrentGrade(user.user_id, user.role, targetUserId);
  }

  /**
   * GET /api/v1/users/:user_id/grade/history
   * View grade change history for a specific user.
   * Permission: self / direct leader / boss / pmo / admin
   */
  @Get('users/:user_id/grade/history')
  getGradeHistory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('user_id') targetUserId: string,
  ) {
    return this.gradeService.getGradeHistory(user.user_id, user.role, targetUserId);
  }

  /**
   * POST /api/v1/users/:user_id/grade
   * Set or modify the grade for a specific user.
   * Permission: boss / pmo / admin only
   */
  @Post('users/:user_id/grade')
  setGrade(
    @CurrentUser() user: CurrentUserPayload,
    @Param('user_id') targetUserId: string,
    @Body() dto: SetGradeDto,
  ) {
    if (!WRITE_ALLOWED_ROLES.has(user.role)) {
      throw new BusinessException(
        ErrorCode.GRADE_PERMISSION_DENIED,
        'Only boss, pmo, or admin can set employee grades',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.gradeService.setGrade(user.user_id, targetUserId, dto);
  }

  /**
   * GET /api/v1/grade/overview
   * Get grade overview for all employees.
   * Permission: boss / pmo / admin only
   */
  @Get('grade/overview')
  getGradeOverview(@CurrentUser() user: CurrentUserPayload) {
    return this.gradeService.getGradeOverview(user.user_id, user.role);
  }
}
