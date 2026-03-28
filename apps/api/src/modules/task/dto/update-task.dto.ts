import { IsString, IsOptional, IsDateString, IsIn, IsInt, IsNumber, Min, Max } from 'class-validator';
import { TaskStatus, type UpdateTaskDto } from '@leader-sync/shared-types';

export class UpdateTaskRequestDto implements UpdateTaskDto {
  @IsInt()
  version!: number;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  detail?: string;

  @IsIn(Object.values(TaskStatus))
  @IsOptional()
  status?: TaskStatus;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  progress_percent?: number;

  @IsString()
  @IsOptional()
  latest_progress?: string;

  @IsDateString()
  @IsOptional()
  due_at?: string;

  @IsDateString()
  @IsOptional()
  completed_at?: string;

  @IsString()
  @IsOptional()
  stall_reason?: string;

  @IsString()
  @IsOptional()
  delay_reason?: string;
}
