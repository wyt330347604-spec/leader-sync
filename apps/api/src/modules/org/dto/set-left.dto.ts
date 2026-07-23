import { IsBoolean } from 'class-validator';

export class SetLeftDto {
  /** true=标记离职（人工，同步不复活） | false=撤销离职 */
  @IsBoolean()
  left!: boolean;
}
