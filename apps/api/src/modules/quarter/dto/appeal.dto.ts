import { IsIn, IsString, MinLength } from 'class-validator';

/** POST /quarter/results/:result_uid/appeal 请求体（本人公示期内提交）。 */
export class CreateAppealDto {
  @IsString()
  @MinLength(1, { message: '申诉内容不能为空' })
  content!: string;
}

/** PATCH /quarter/appeals/:appeal_uid 处理请求体（hr/admin）。 */
export class HandleAppealDto {
  @IsIn(['resolved', 'rejected'])
  status!: 'resolved' | 'rejected';

  @IsString()
  @MinLength(1, { message: '处理申诉必须填写处理结论' })
  resolution!: string;
}
