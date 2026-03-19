import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CompleteTaskRequestDto {
  @IsString()
  @IsOptional()
  latest_progress?: string;

  @IsDateString()
  @IsOptional()
  completed_at?: string;
}
