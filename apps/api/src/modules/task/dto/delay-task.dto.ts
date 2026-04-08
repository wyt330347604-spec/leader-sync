import { IsString, IsOptional, IsDateString } from 'class-validator';

export class DelayTaskRequestDto {
  @IsDateString()
  new_due_at!: string;

  @IsString()
  @IsOptional()
  delay_reason?: string;
}
