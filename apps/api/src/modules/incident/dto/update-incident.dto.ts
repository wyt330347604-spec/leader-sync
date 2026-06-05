import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateIncidentDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  involved_user_ids?: string[];

  // null to remove association; string to set it
  @IsString()
  @IsOptional()
  related_task_uid?: string | null;
}
