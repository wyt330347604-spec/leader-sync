import { Controller, Get, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { sql } from 'drizzle-orm';

@Controller()
export class HealthController {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readyz() {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { db: 'ok' };
    } catch {
      throw new HttpException({ db: 'unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
