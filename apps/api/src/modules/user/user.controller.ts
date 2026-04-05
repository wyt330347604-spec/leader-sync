import { Controller, Get, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { orgCache } from '@leader-sync/db';
import { sql } from 'drizzle-orm';

@Controller('api/v1/users')
@UseGuards(AuthGuard)
export class UserController {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  @Get('search')
  async search(@Query('q') query: string) {
    if (!query || query.length < 1) {
      return [];
    }

    const pattern = `%${query}%`;
    const users = await this.db
      .select()
      .from(orgCache)
      .where(sql`${orgCache.userName} ILIKE ${pattern}`)
      .limit(10);

    // Deduplicate by open_id (some users have both ou_ and short id entries)
    const seen = new Set<string>();
    return users
      .filter((u) => {
        const key = u.openId || u.userId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((u) => ({
        userId: u.openId || u.userId,
        userName: u.userName,
        deptName: u.deptName,
      }));
  }
}
