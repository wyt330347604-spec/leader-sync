import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class SetGoalDto {
  @IsString()
  @MinLength(1)
  ratee_user_id!: string;

  // 'YYYY-HN'
  @IsString()
  @Matches(/^\d{4}-H[12]$/, { message: 'half 须形如 2026-H2' })
  half!: string;

  @IsString()
  content!: string;
}

export class UpdateGoalDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

/** 员工发起的目标调整建议（写 pending 提案，不直接改正式内容）。 */
export class ProposeGoalDto {
  @IsString()
  @MinLength(1)
  content!: string;
}

/** 直属确认目标提案：accept=true 应用为正式内容并写 revision；false 关提案并留痕。 */
export class ConfirmGoalDto {
  @IsBoolean()
  accept!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
