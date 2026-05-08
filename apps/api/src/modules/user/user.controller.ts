import { Controller, Get, Query, UseGuards, Inject } from '@nestjs/common';
import { pinyin } from 'pinyin-pro';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { orgCache } from '@leader-sync/db';

interface PinyinIndex {
  readonly fullPinyin: string;   // "wangyongtao"
  readonly firstLetters: string; // "wyt"
}

function buildPinyinIndex(name: string): PinyinIndex {
  const full = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase();
  const first = pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase();
  return { fullPinyin: full, firstLetters: first };
}

@Controller('api/v1/users')
@UseGuards(AuthGuard)
export class UserController {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  @Get('search')
  async search(@Query('q') query: string) {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase().trim();

    // Pull the org cache once and match in memory (org_cache is small ~<1000 rows;
    // ILIKE alone misses pinyin / english abbreviations).
    const allUsers = await this.db.select().from(orgCache);

    const matched = allUsers.filter((u) => {
      if (!u.userName) return false;
      const name = u.userName.toLowerCase();
      if (name.includes(q)) return true;
      const idx = buildPinyinIndex(u.userName);
      return idx.fullPinyin.includes(q) || idx.firstLetters.includes(q);
    });

    // Deduplicate by open_id (some users have both ou_ and short id entries)
    const seen = new Set<string>();
    return matched
      .filter((u) => {
        const key = u.openId || u.userId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10)
      .map((u) => ({
        userId: u.openId || u.userId,
        userName: u.userName,
        deptName: u.deptName,
      }));
  }
}
