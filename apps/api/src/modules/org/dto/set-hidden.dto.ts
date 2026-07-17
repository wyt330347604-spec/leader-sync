import { IsBoolean } from 'class-validator';

export class SetHiddenDto {
  /** true=隐藏（在职但不入目录） | false=取消隐藏 */
  @IsBoolean()
  hidden!: boolean;
}
