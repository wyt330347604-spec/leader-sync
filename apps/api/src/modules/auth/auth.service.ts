import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { orgCache, userRoleBinding } from '@leader-sync/db';
import { eq } from 'drizzle-orm';
import { FeishuAuthService } from './feishu-auth.service';

export interface JwtPayload {
  user_id: string;
  open_id?: string;
  user_name: string;
  role: string;
  dept_id: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jwtService: JwtService,
    private readonly feishuAuth: FeishuAuthService,
  ) {}

  async loginWithCode(
    code: string,
  ): Promise<{ token: string; user: JwtPayload }> {
    // Exchange code for user info
    const userAccessToken = await this.feishuAuth.getUserAccessToken(code);
    const feishuUser = await this.feishuAuth.getUserInfo(userAccessToken);

    // Upsert org_cache
    await this.db
      .insert(orgCache)
      .values({
        userId: feishuUser.user_id,
        openId: feishuUser.open_id,
        userName: feishuUser.name,
        deptId: feishuUser.department_ids?.[0] || null,
      })
      .onConflictDoUpdate({
        target: orgCache.userId,
        set: {
          openId: feishuUser.open_id,
          userName: feishuUser.name,
          deptId: feishuUser.department_ids?.[0] || null,
          syncedAt: new Date(),
        },
      });

    // Get role (default to employee)
    const roles = await this.db
      .select()
      .from(userRoleBinding)
      .where(eq(userRoleBinding.userId, feishuUser.user_id));
    const role = roles[0]?.role || 'employee';

    const payload: JwtPayload = {
      user_id: feishuUser.user_id,
      open_id: feishuUser.open_id,
      user_name: feishuUser.name,
      role,
      dept_id: feishuUser.department_ids?.[0] || '',
    };

    const token = await this.jwtService.signAsync(payload);
    return { token, user: payload };
  }

  // DEV-ONLY: sign a JWT for any user_id without OAuth. Used by playwright e2e
  // screenshot scripts. The endpoint that calls this is gated by NODE_ENV.
  async devSignToken(userId: string): Promise<{ token: string; user: JwtPayload }> {
    const profile = await this.getMe(userId);
    const payload: JwtPayload = profile ?? {
      user_id: userId,
      user_name: 'dev',
      role: 'employee',
      dept_id: '',
    };
    const token = await this.jwtService.signAsync(payload);
    return { token, user: payload };
  }

  async getMe(userId: string): Promise<JwtPayload | null> {
    const users = await this.db
      .select()
      .from(orgCache)
      .where(eq(orgCache.userId, userId));

    if (!users[0]) return null;

    const roles = await this.db
      .select()
      .from(userRoleBinding)
      .where(eq(userRoleBinding.userId, userId));

    return {
      user_id: users[0].userId,
      open_id: users[0].openId ?? undefined,
      user_name: users[0].userName || '',
      role: roles[0]?.role || 'employee',
      dept_id: users[0].deptId || '',
    };
  }
}
