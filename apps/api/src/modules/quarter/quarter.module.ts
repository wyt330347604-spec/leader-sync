import { Module } from '@nestjs/common';
import { QuarterController } from './quarter.controller';
import { QuarterService } from './quarter.service';
import { QuarterRepository } from './quarter.repository';
import { QuarterResultService } from './quarter-result.service';
import { QuarterResultRepository } from './quarter-result.repository';
import { QuarterNotifierService } from './quarter-notifier.service';
import { MePerformanceController } from './me-performance.controller';
import { MePerformanceService } from './me-performance.service';
import { AuthModule } from '../auth/auth.module';
import { FeishuModule } from '../../common/feishu/feishu.module';

@Module({
  imports: [AuthModule, FeishuModule],
  controllers: [QuarterController, MePerformanceController],
  providers: [
    QuarterService,
    QuarterRepository,
    QuarterResultService,
    QuarterResultRepository,
    QuarterNotifierService,
    MePerformanceService,
  ],
  exports: [QuarterService, QuarterResultService],
})
export class QuarterModule {}
