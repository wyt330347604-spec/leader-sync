import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRepository } from './ai.repository';
import { DeepSeekClient } from './deepseek-client';
import { IntentClassifier } from './intent-classifier';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [AiController],
  providers: [AiService, AiRepository, DeepSeekClient, IntentClassifier],
  exports: [AiService, AiRepository],
})
export class AiModule {}
