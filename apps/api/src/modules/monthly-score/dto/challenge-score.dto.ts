import { IsString, IsOptional, IsInt } from 'class-validator';

export class ChallengeScoreDto {
  @IsString()
  @IsOptional()
  challenge_note?: string;

  // 乐观锁版本号（防并发覆盖）。
  @IsInt()
  version!: number;
}
