import {
  bigserial,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const syncLog = pgTable('sync_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  taskUid: varchar('task_uid', { length: 64 }).notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  direction: varchar('direction', { length: 16 }).notNull(),
  syncStatus: varchar('sync_status', { length: 32 }).notNull(),
  syncVersion: integer('sync_version'),
  errorMessage: text('error_message'),
  traceId: varchar('trace_id', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
