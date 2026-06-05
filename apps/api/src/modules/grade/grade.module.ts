import { Module } from '@nestjs/common';
import { GradeController } from './grade.controller';
import { GradeService } from './grade.service';
import { GradeRepository } from './grade.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [GradeController],
  providers: [GradeService, GradeRepository],
})
export class GradeModule {}
