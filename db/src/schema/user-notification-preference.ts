import {
  bigserial,
  boolean,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const userNotificationPreference = pgTable('user_notification_preference', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull().unique('uniq_user_notif_pref_user'),
  dailyOverdueEnabled: boolean('daily_overdue_enabled').notNull().default(false),
  weeklySummaryEnabled: boolean('weekly_summary_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
