import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { orgCache, userRoleBinding } from '@leader-sync/db';
import { eq } from 'drizzle-orm';
import { FeishuAuthService } from './feishu-auth.service';

export interface JwtPayload {
  user_id: string;
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
        userName: feishuUser.name,
        deptId: feishuUser.department_ids?.[0] || null,
      })
      .onConflictDoUpdate({
        target: orgCache.userId,
        set: {
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
      user_name: feishuUser.name,
      role,
      dept_id: feishuUser.department_ids?.[0] || '',
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
      user_name: users[0].userName || '',
      role: roles[0]?.role || 'employee',
      dept_id: users[0].deptId || '',
    };
  }
}
