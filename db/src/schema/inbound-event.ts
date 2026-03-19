import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const inboundEvent = pgTable('inbound_event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  sourceEventId: varchar('source_event_id', { length: 256 }).notNull().unique(),
  sourceObjectId: varchar('source_object_id', { length: 256 }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  traceId: varchar('trace_id', { length: 128 }),
  payload: jsonb('payload'),
  processStatus: varchar('process_status', { length: 32 }).notNull().default('pending'),
  processResult: text('process_result'),
  retryCount: integer('retry_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
