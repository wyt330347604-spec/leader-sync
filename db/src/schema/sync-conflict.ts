import {
  bigserial,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const syncConflict = pgTable('sync_conflict', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  taskUid: varchar('task_uid', { length: 64 }).notNull(),
  fieldName: varchar('field_name', { length: 64 }).notNull(),
  localValue: text('local_value'),
  remoteValue: text('remote_value'),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  sourceEventId: varchar('source_event_id', { length: 256 }),
  localVersion: integer('local_version'),
  remoteVersion: integer('remote_version'),
  resolutionStatus: varchar('resolution_status', { length: 64 }).default('unresolved_pending_review'),
  resolvedBy: varchar('resolved_by', { length: 128 }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionReason: text('resolution_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
