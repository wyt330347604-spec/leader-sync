import { Injectable, Inject, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { userRoleBinding } from '@leader-sync/db';
import { inArray } from 'drizzle-orm';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(DATABASE_TOKEN) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.token;

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // 角色实时读库覆盖 JWT 快照：绑定变更即时生效，无需重新登录（JWT 30 天，
    // 烧在里面的 role 会长期过期）。绑定表统一 ou_ 维护，双命名空间任一命中。
    // 查询失败时回落 JWT 快照角色（防御：不因角色查询故障阻断请求）。
    try {
      const candidates = [payload.user_id, payload.open_id].filter(
        (x: unknown): x is string => typeof x === 'string' && x.length > 0,
      );
      if (candidates.length > 0) {
        const roles = await this.db
          .select()
          .from(userRoleBinding)
          .where(inArray(userRoleBinding.userId, candidates));
        payload.role = roles[0]?.role ?? 'employee';
      }
    } catch {
      // keep JWT snapshot role
    }

    request.user = payload;
    return true;
  }
}
