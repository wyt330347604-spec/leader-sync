import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** 员工任务专用：勾/取消进管理层评分（勾选时 reason 必填，由 service 校验）。 */
export class MgmtRequiredDto {
  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
