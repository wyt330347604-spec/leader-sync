import { Module } from '@nestjs/common';
import { RequirementController } from './requirement.controller';
import { RequirementService } from './requirement.service';
import { RequirementRepository } from './requirement.repository';
import { RequirementFeishuService } from './requirement-feishu.service';
import { AuthModule } from '../auth/auth.module';
import { FeishuModule } from '../../common/feishu/feishu.module';

@Module({
  imports: [AuthModule, FeishuModule],
  controllers: [RequirementController],
  providers: [RequirementService, RequirementRepository, RequirementFeishuService],
})
export class RequirementModule {}
