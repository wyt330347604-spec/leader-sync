import { IsNumber, IsString, IsNotEmpty, Min, Max, IsOptional } from 'class-validator';

export class CreateScoreDto {
  @IsString()
  @IsNotEmpty()
  ratee_user_id!: string;

  @IsString()
  @IsNotEmpty()
  score_month!: string; // 'YYYY-MM'

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  score?: number;
}
