import { IsArray, IsString, ArrayMaxSize, IsOptional, ValidateIf } from 'class-validator';

/** 批量把任务归类到某项目（project_uid=null 即移回未归属）。 */
export class BulkAssignProjectRequestDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1000)
  task_uids!: string[];

  // 允许 null（未归属）；非 null 时必须是字符串
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  project_uid?: string | null;
}
