import { IsArray, IsString, ArrayMaxSize } from 'class-validator';

/**
 * 保存当前用户对一组任务的手动排序。task_uids 为「同一分组内」拖拽后的完整有序列表，
 * 服务端按下标写入 position。上限防滥用。
 */
export class ReorderTasksRequestDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(2000)
  task_uids!: string[];
}
