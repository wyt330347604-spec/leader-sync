import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { FeishuAuthService } from './feishu-auth.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly feishuAuth: FeishuAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('feishu/jsapi-auth')
  @HttpCode(200)
  async jsApiAuth(
    @Body('code') code: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.loginWithCode(code);
    res.cookie('token', token, {
      httpOnly: true,
      secure: this.config.get('APP_ENV') === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8h
    });
    return user;
  }

  @Get('feishu/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('redirect') redirect: string,
    @Res() res: Response,
  ) {
    const { token } = await this.authService.loginWithCode(code);
    res.cookie('token', token, {
      httpOnly: true,
      secure: this.config.get('APP_ENV') === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.redirect(redirect || '/tasks');
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: CurrentUserPayload) {
    const profile = await this.authService.getMe(user.user_id);
    if (!profile) {
      return user; // fallback to JWT payload
    }
    return profile;
  }
}
