import { IsString, IsNotEmpty } from 'class-validator';

export class RejectIncidentDto {
  @IsString()
  @IsNotEmpty()
  reject_reason!: string;
}
