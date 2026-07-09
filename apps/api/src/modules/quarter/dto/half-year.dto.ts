import { IsString, Matches } from 'class-validator';

/**
 * POST /quarter/half-year/compute 请求体。
 *   half：'YYYY-H1'（Q1+Q2）| 'YYYY-H2'（Q3+Q4）。
 */
export class HalfYearComputeDto {
  @IsString()
  @Matches(/^\d{4}-H[12]$/, { message: 'half 必须形如 2026-H1 / 2026-H2' })
  half!: string;
}
