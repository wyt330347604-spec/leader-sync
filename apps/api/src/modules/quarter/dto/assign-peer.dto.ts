import { IsString, MinLength } from 'class-validator';

export class AssignPeerDto {
  @IsString()
  @MinLength(1)
  peer_user_id!: string;
}
