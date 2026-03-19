import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { AssignmentType, type AssignTaskDto } from '@leader-sync/shared-types';

export class AssignTaskRequestDto implements AssignTaskDto {
  @IsString()
  @IsNotEmpty()
  assignee_user_id!: string;

  @IsIn(Object.values(AssignmentType))
  assignment_type!: AssignmentType;

  @IsString()
  @IsOptional()
  reason?: string;
}
