import {
  bigserial,
  boolean,
  integer,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

export const externalMapping = pgTable(
  'external_mapping',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    taskUid: varchar('task_uid', { length: 64 }).notNull(),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    externalObjectId: varchar('external_object_id', { length: 256 }).notNull(),
    externalParentId: varchar('external_parent_id', { length: 256 }),
    syncVersion: integer('sync_version').notNull().default(1),
    lastSyncHash: varchar('last_sync_hash', { length: 128 }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncSource: varchar('last_sync_source', { length: 32 }),
    syncStatus: varchar('sync_status', { length: 32 }).notNull().default('pending'),
    conflictFlag: boolean('conflict_flag').default(false),
    archivedFlag: boolean('archived_flag').default(false),
  },
  (table) => [
    unique('uniq_task_source').on(table.taskUid, table.sourceType),
  ],
);
