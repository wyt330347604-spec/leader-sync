import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 单个维度打分（1–10，整数范围由 domain-core quarterlyDimScore 兜底抛错 → 400）。 */
export class SheetItemInput {
  @IsString()
  dimension_code!: string;

  @IsInt()
  raw!: number;
}

/**
 * PATCH /quarter/sheets/:sheet_uid 提交请求体。
 *   items：模板全部软项维度各一条；
 *   goal_score：仅 manager sheet 需要（0–45 员工 / 0–40 leader，上界由 service 按模板校验）；
 *   version：OCC。
 */
export class SubmitSheetDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SheetItemInput)
  items!: SheetItemInput[];

  @IsOptional()
  @IsNumber()
  goal_score?: number;

  @IsInt()
  @Min(1)
  version!: number;
}
