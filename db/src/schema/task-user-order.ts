import {
  bigserial,
  doublePrecision,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * 每用户的任务手动排序偏好（个人视图，仅影响自己的「我的任务」列表）。
 * - 任务是共享实体，因此排序必须按用户隔离，绝不影响他人视图。
 * - position 为浮点数，便于拖拽时在相邻两项之间取中值插入（暂用整数下标 upsert，浮点留扩展空间）。
 * - 无记录的任务回落到服务端默认排序（done 末尾 → 优先级 → 项目）。
 */
export const taskUserOrder = pgTable(
  'task_user_order',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    taskUid: varchar('task_uid', { length: 64 }).notNull(),
    position: doublePrecision('position').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqUserTask: uniqueIndex('uniq_task_user_order_user_task').on(t.userId, t.taskUid),
  }),
);
