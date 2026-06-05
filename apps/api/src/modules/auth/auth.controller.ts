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

/**
 * 登录态 cookie 存活时长（30 天），与 JWT 的 JWT_EXPIRES_IN=30d 对齐，
 * 避免「cookie 还在但 token 已过期」的不一致。
 */
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
      maxAge: SESSION_MAX_AGE_MS,
    });
    return user;
  }

  @Get('feishu/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('redirect') redirect: string,
    @Res() res: Response,
  ) {
    // No code = user hasn't authorized yet, redirect to Feishu OAuth page
    // Use state param to carry redirect path (keeps redirect_uri clean for Feishu matching)
    if (!code) {
      const baseUrl = this.config.get('APP_BASE_URL', 'http://localhost:3000');
      const callbackUrl = `${baseUrl}/api/v1/auth/feishu/callback`;
      const authUrl = this.feishuAuth.getOAuthRedirectUrl(callbackUrl, redirect || '/tasks');
      res.redirect(authUrl);
      return;
    }

    // Feishu sends back: ?code=xxx&state=<redirect_path>
    const redirectPath = state || redirect || '/tasks';

    try {
      const { token } = await this.authService.loginWithCode(code);
      res.cookie('token', token, {
        httpOnly: true,
        secure: this.config.get('APP_ENV') === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE_MS,
      });
      // Validate redirect is internal path
      const safePath = redirectPath.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : '/tasks';
      res.redirect(safePath);
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.redirect('/tasks?error=auth_failed');
    }
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

  // DEV-ONLY: sign a JWT for any user_id and set the cookie. Used by e2e
  // screenshot scripts. Returns 404 unless NODE_ENV=development.
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(
    @Body('user_id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (process.env.NODE_ENV !== 'development') {
      res.status(404);
      return { code: 404, message: 'Not Found' };
    }
    if (!userId) {
      res.status(400);
      return { code: 400, message: 'user_id required' };
    }
    const { token, user } = await this.authService.devSignToken(userId);
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    });
    return { token, user };
  }
}
