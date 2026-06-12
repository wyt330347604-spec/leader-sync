import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IncidentController } from './incident.controller';
import { IncidentService } from './incident.service';
import { IncidentRepository } from './incident.repository';
import { IncidentFeishuService } from './incident-feishu.service';
import { AuthModule } from '../auth/auth.module';
import { FeishuModule } from '../../common/feishu/feishu.module';

@Module({
  imports: [AuthModule, ConfigModule, FeishuModule],
  controllers: [IncidentController],
  providers: [IncidentService, IncidentRepository, IncidentFeishuService],
})
export class IncidentModule {}
