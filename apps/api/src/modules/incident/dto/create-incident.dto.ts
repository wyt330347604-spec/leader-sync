import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsDateString,
  IsIn,
} from 'class-validator';
import { IncidentSeverity } from '@leader-sync/shared-types';

export class CreateIncidentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(Object.values(IncidentSeverity))
  severity!: IncidentSeverity;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  involved_user_ids?: string[];

  @IsString()
  @IsOptional()
  related_task_uid?: string;

  // 关联项目（可选）。不填且关联了任务时，自动带出该任务的项目。
  @IsString()
  @IsOptional()
  related_project_uid?: string;

  @IsDateString()
  @IsOptional()
  incident_date?: string;
}
