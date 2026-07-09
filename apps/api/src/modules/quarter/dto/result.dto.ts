import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * POST /quarter/tasks/:task_uid/result/compute（及批量）请求体。
 *   red_line：季度红线一票否决（默认 false；省略时保留结果既有值）。
 *   red_line_note：红线事由（勾选红线时建议填写）。
 */
export class ComputeResultDto {
  @IsOptional()
  @IsBoolean()
  red_line?: boolean;

  @IsOptional()
  @IsString()
  red_line_note?: string;
}

/**
 * PATCH /quarter/results/:result_uid 评分会改分请求体。
 *   field：goal_score|soft_merged（重算 total/grade）| total|grade（仅记录）。
 *   after：新值（字符串，service 按 field 解析）。
 *   reason：必填，写入 revision 留痕。
 */
export class ReviseResultDto {
  @IsIn(['goal_score', 'soft_merged', 'total', 'grade'])
  field!: 'goal_score' | 'soft_merged' | 'total' | 'grade';

  @IsString()
  @MinLength(1)
  after!: string;

  @IsString()
  @MinLength(1, { message: '改分必须填写原因' })
  reason!: string;
}
