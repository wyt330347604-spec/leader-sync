import {
  bigserial,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const orgCache = pgTable('org_cache', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull().unique(),
  openId: varchar('open_id', { length: 128 }),
  userName: varchar('user_name', { length: 128 }),
  deptId: varchar('dept_id', { length: 128 }),
  deptName: varchar('dept_name', { length: 128 }),
  managerUserId: varchar('manager_user_id', { length: 128 }),
  managerName: varchar('manager_name', { length: 128 }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});
