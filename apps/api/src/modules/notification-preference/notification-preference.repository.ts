import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { userNotificationPreference } from '@leader-sync/db';
import { eq, sql } from 'drizzle-orm';

export interface PreferenceRow {
  readonly userId: string;
  readonly dailyOverdueEnabled: boolean;
  readonly weeklySummaryEnabled: boolean;
}

@Injectable()
export class NotificationPreferenceRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async findByUserId(userId: string): Promise<PreferenceRow | null> {
    const [row] = await this.db
      .select()
      .from(userNotificationPreference)
      .where(eq(userNotificationPreference.userId, userId));
    return row ?? null;
  }

  async upsert(
    userId: string,
    values: { dailyOverdueEnabled: boolean; weeklySummaryEnabled: boolean },
  ): Promise<PreferenceRow> {
    const [row] = await this.db
      .insert(userNotificationPreference)
      .values({
        userId,
        dailyOverdueEnabled: values.dailyOverdueEnabled,
        weeklySummaryEnabled: values.weeklySummaryEnabled,
      })
      .onConflictDoUpdate({
        target: userNotificationPreference.userId,
        set: {
          dailyOverdueEnabled: values.dailyOverdueEnabled,
          weeklySummaryEnabled: values.weeklySummaryEnabled,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();
    return row;
  }
}
