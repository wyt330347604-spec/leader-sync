import { IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class DelayTaskRequestDto {
  @IsDateString()
  new_due_at!: string;

  @IsString()
  @IsNotEmpty()
  delay_reason!: string;
}
