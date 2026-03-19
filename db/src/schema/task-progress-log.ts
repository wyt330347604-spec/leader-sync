import {
  bigserial,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const taskProgressLog = pgTable('task_progress_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  logUid: varchar('log_uid', { length: 64 }).notNull().unique(),
  taskUid: varchar('task_uid', { length: 64 }).notNull(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  sourceEventId: varchar('source_event_id', { length: 256 }),
  operatorUserId: varchar('operator_user_id', { length: 128 }),
  operatorName: varchar('operator_name', { length: 128 }),
  oldStatus: varchar('old_status', { length: 32 }),
  newStatus: varchar('new_status', { length: 32 }),
  progressDelta: integer('progress_delta'),
  logText: text('log_text'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
