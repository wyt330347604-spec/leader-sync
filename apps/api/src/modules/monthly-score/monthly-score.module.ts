import { Module } from '@nestjs/common';
import { MonthlyScoreController } from './monthly-score.controller';
import { MonthlyScoreService } from './monthly-score.service';
import { MonthlyScoreRepository } from './monthly-score.repository';
import { AuthModule } from '../auth/auth.module';
import { FeishuModule } from '../../common/feishu/feishu.module';

@Module({
  imports: [AuthModule, FeishuModule],
  controllers: [MonthlyScoreController],
  providers: [MonthlyScoreService, MonthlyScoreRepository],
  exports: [MonthlyScoreService],
})
export class MonthlyScoreModule {}
