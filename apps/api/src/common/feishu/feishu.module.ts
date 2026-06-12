import { Module } from '@nestjs/common';
import { FeishuMessengerService } from './feishu-messenger.service';

/** 共享飞书下发底座，供各业务模块 import 复用（单实例 → 单 token 缓存）。 */
@Module({
  providers: [FeishuMessengerService],
  exports: [FeishuMessengerService],
})
export class FeishuModule {}
