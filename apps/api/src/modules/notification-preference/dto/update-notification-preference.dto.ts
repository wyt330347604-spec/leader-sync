import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  dailyOverdueEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  weeklySummaryEnabled?: boolean;
}
