import { Module } from '@nestjs/common';
import { RequirementController } from './requirement.controller';
import { RequirementService } from './requirement.service';
import { RequirementRepository } from './requirement.repository';
import { RequirementFeishuService } from './requirement-feishu.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RequirementController],
  providers: [RequirementService, RequirementRepository, RequirementFeishuService],
})
export class RequirementModule {}
