import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IncidentController } from './incident.controller';
import { IncidentService } from './incident.service';
import { IncidentRepository } from './incident.repository';
import { IncidentFeishuService } from './incident-feishu.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [IncidentController],
  providers: [IncidentService, IncidentRepository, IncidentFeishuService],
})
export class IncidentModule {}
