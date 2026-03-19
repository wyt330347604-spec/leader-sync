import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskRepository } from './task.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TaskController],
  providers: [TaskService, TaskRepository],
})
export class TaskModule {}
