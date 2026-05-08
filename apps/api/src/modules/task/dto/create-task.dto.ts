import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsDateString, IsIn } from 'class-validator';
import { TaskType, Priority, AssignmentType, type CreateTaskDto } from '@leader-sync/shared-types';

export class CreateTaskRequestDto implements CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  detail?: string;

  @IsIn(Object.values(TaskType))
  @IsOptional()
  task_type?: TaskType;

  @IsIn(Object.values(Priority))
  priority!: Priority;

  @IsString()
  @IsNotEmpty()
  assignee_user_id!: string;

  @IsDateString()
  due_at!: string;

  @IsDateString()
  @IsOptional()
  start_at?: string;

  @IsIn(Object.values(AssignmentType))
  @IsOptional()
  assignment_type?: AssignmentType;

  @IsBoolean()
  @IsOptional()
  boss_attention_flag?: boolean;

  @IsString()
  @IsOptional()
  project_uid?: string;
}
