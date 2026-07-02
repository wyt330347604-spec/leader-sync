import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SetManagerDto {
  /** 新直属上级的 user_id / open_id；null = 设为根节点（无上级） */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  manager_user_id?: string | null;
}
