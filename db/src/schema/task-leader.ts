import { pgTable, bigserial, varchar, timestamp } from 'drizzle-orm/pg-core';

export const taskLeader = pgTable('task_leader', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  taskUid: varchar('task_uid', { length: 64 }).notNull(),
  leaderUserId: varchar('leader_user_id', { length: 128 }).notNull(),
  leaderName: varchar('leader_name', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
