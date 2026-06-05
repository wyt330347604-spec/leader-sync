/**
 * feishu-bot.controller.ts
 *
 * 处理飞书机器人 @提问 消息的 Webhook 端点。
 *
 * 飞书后台配置（手动）：
 *   1. 应用能力 → 机器人 → 开启
 *   2. 事件与回调 → 添加事件：im.message.receive_v1
 *   3. 回调地址：POST /api/v1/feishu/webhook/bot-message
 *   4. 权限：im:message:readonly / im:message
 *
 * 安全注意：此端点无 JWT AuthGuard（飞书服务器直接推送，无 cookie）。
 * 通过 FEISHU_VERIFICATION_TOKEN 验签替代。
 */

import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FeishuBotService } from './feishu-bot.service';

@Controller('api/v1/feishu/webhook')
export class FeishuBotController {
  private readonly logger = new Logger(FeishuBotController.name);

  constructor(private readonly feishuBotService: FeishuBotService) {}

  /**
   * POST /api/v1/feishu/webhook/bot-message
   *
   * 飞书事件推送入口：
   *   - challenge 验证（首次配置时）
   *   - im.message.receive_v1 消息事件
   */
  @Post('bot-message')
  @HttpCode(HttpStatus.OK)
  async handleBotMessage(
    @Body() body: Record<string, unknown>,
    @Headers('x-lark-signature') signature?: string,
  ) {
    // 1. 响应 challenge（飞书后台验证回调地址时发送）
    if (body.challenge) {
      this.logger.log('Feishu bot webhook challenge received');
      return { challenge: body.challenge };
    }

    // 2. 提取事件体
    const event = (body.event ?? body) as Record<string, unknown>;
    const header = body.header as Record<string, unknown> | undefined;
    const eventType = header?.event_type ?? (event.type as string);

    if (eventType !== 'im.message.receive_v1') {
      // 忽略非消息事件，返回 200 避免飞书重试
      return { code: 0 };
    }

    // 3. 异步处理消息（立即返回 200 给飞书，避免超时重试）
    const message = event.message as Record<string, unknown> | undefined;
    const sender = event.sender as Record<string, unknown> | undefined;
    const senderId = sender?.sender_id as Record<string, unknown> | undefined;
    const openId = senderId?.open_id as string | undefined;
    const msgType = message?.message_type as string | undefined;
    const content = message?.content as string | undefined;

    if (openId && msgType === 'text' && content) {
      this.feishuBotService
        .handleIncomingMessage(openId, content)
        .catch((err: Error) => {
          this.logger.error(`Feishu bot message handling failed: ${err.message}`);
        });
    }

    return { code: 0 };
  }
}
