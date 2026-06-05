import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeishuBotController } from './feishu-bot.controller';
import { FeishuBotService } from './feishu-bot.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule, ConfigModule],
  controllers: [FeishuBotController],
  providers: [FeishuBotService],
})
export class FeishuBotModule {}
