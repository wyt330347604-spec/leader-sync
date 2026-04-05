import { pgTable, bigserial, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const project = pgTable('project', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectUid: varchar('project_uid', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 128 }).notNull(),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
