/**
 * ai.controller.ts
 *
 * POST /api/v1/ai/chat — 接收自然语言问题，返回 AI 回答
 *
 * 权限：AuthGuard（JWT cookie，与现有全局 Guard 一致）
 * employee 角色：AiService 层抛出 1002 禁止
 */

import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';

@Controller('api/v1/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * POST /api/v1/ai/chat
   * Body: { question: string; session_id: string; source?: 'web' }
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AiChatDto,
  ) {
    return this.aiService.chat({
      question: dto.question,
      sessionId: dto.session_id,
      userId: user.user_id,
      userName: user.user_name,
      role: user.role,
      source: 'web',
    });
  }
}
