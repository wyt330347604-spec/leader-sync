import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class AiChatDto {
  @IsString()
  @IsNotEmpty({ message: '问题不能为空' })
  @MaxLength(500, { message: '问题长度不能超过 500 字' })
  question!: string;

  @IsString()
  @IsNotEmpty({ message: 'session_id 不能为空' })
  session_id!: string;

  @IsOptional()
  @IsString()
  source?: 'web';
}
