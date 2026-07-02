import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { OrgRepository } from './org.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OrgController],
  providers: [OrgService, OrgRepository],
})
export class OrgModule {}
