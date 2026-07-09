import {
  IsNumber,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsBoolean,
  IsString,
  IsArray,
  ValidateNested,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 单个维度系数（V1.4 多维系数制）。
 * coefficient 上下限 + 维度与模板一致性由 service 层按打分行的模板校验（这里只做类型/数值兜底）。
 */
export class ScoreDetailInput {
  @IsString()
  dimension_code!: string;

  @IsNumber()
  coefficient!: number;
}

/**
 * PATCH /scores/:score_uid/score 与 POST /scores/:score_uid/resolve 共用请求体。
 *
 * 两条路径（service 按 details 是否存在分流）：
 *   - 旧单值路径（无 template_uid 的历史行）：{ score: 0–1, version }
 *   - V1.4 多维路径（有 template_uid 的新行）：{ details: [...], red_line?, red_line_note?, version }
 *
 * 所有字段除 version 外均可选，具体必填/一致性校验在 service 层按打分行的模板执行。
 */
export class UpdateScoreDto {
  // 旧单值路径
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  score?: number;

  // V1.4 多维路径
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ScoreDetailInput)
  details?: ScoreDetailInput[];

  @IsOptional()
  @IsBoolean()
  red_line?: boolean;

  @IsOptional()
  @IsString()
  red_line_note?: string;

  // 乐观锁版本号
  @IsInt()
  @Min(1)
  version!: number;
}
