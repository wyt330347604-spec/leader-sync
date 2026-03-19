import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FeishuAuthService } from './feishu-auth.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '8h') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, FeishuAuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
