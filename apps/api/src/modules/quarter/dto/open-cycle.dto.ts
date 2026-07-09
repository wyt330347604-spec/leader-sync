import { IsString, Matches } from 'class-validator';

export class OpenCycleDto {
  // 'YYYY-QN'（N 1–4）
  @IsString()
  @Matches(/^\d{4}-Q[1-4]$/, { message: 'quarter 须形如 2026-Q3' })
  quarter!: string;
}
