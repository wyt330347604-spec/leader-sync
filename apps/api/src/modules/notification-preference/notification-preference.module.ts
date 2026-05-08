import { Module } from '@nestjs/common';
import { NotificationPreferenceController } from './notification-preference.controller';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationPreferenceRepository } from './notification-preference.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationPreferenceController],
  providers: [NotificationPreferenceService, NotificationPreferenceRepository],
  exports: [NotificationPreferenceService],
})
export class NotificationPreferenceModule {}
