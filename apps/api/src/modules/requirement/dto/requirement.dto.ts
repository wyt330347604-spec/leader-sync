import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsNumber, IsDateString } from 'class-validator';
import { RequirementSource, RequirementPriority, RequirementStatus } from '@leader-sync/shared-types';

export class CreateRequirementDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsOptional() value?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsNotEmpty() business_line_uid!: string;
  @IsString() @IsOptional() app_project_uid?: string | null;
  @IsIn(Object.values(RequirementSource)) @IsOptional() source?: string;
  @IsIn(Object.values(RequirementPriority)) priority!: string;
  @IsDateString() @IsOptional() expected_release_date?: string;
}

export class UpdateRequirementDto {
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() value?: string;
  @IsString() @IsOptional() description?: string;
  @IsIn(Object.values(RequirementPriority)) @IsOptional() priority?: string;
  @IsString() @IsOptional() target_version?: string | null;
  @IsString() @IsOptional() acceptor_user_id?: string | null;
  @IsDateString() @IsOptional() expected_release_date?: string | null;
  @IsNumber() @IsOptional() est_effort_days?: number | null;
  // 状态流转（含回退 / 驳回）。校验合法性在 service。
  @IsIn(Object.values(RequirementStatus)) @IsOptional() status?: string;
  @IsString() @IsOptional() transition_reason?: string; // 回退/驳回原因，留痕
}

export class LinkTasksDto {
  @IsArray() @IsString({ each: true }) task_uids!: string[];
  @IsNumber() @IsOptional() est_effort_days?: number;
  @IsNumber() @IsOptional() allocation_pct?: number;
}

export class AddArtifactDto {
  @IsString() @IsNotEmpty() type!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsOptional() url?: string;
}

/** R3：P0/变更 影响评估预览输入（提需求前算影响、出通知名单，人工确认）。 */
export class ImpactPreviewDto {
  @IsString() @IsNotEmpty() business_line_uid!: string;
  @IsString() @IsOptional() app_project_uid?: string | null;
  @IsDateString() expected_release_date!: string;
}
