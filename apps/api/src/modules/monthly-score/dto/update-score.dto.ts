import { IsNumber, IsInt, Min, Max, IsNotEmpty } from 'class-validator';

export class UpdateScoreDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  score!: number;

  @IsInt()
  @Min(1)
  version!: number;
}
