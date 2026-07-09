import {
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// quarter_appeal — 季度公示后的申诉（本人提交、hr/admin 处理）
// 对应 migration 0020_add_quarter_result.sql
//
// spec 2026-07-08 performance-review-module §3.3 §5 步骤4 §8：
//   仅被评人本人、结果 published 且未过 appeal_deadline_at 时可提交；每 result 至多一条 open。
//   hr/admin 处理：resolved | rejected（resolution 必填）。提交时通知 hr 角色绑定用户。
//   partial unique index（status='open'）在 DB 级兜底「一 result 一 open」。
// 软引用，无 DB 外键。

export const quarterAppeal = pgTable(
  'quarter_appeal',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    appealUid: varchar('appeal_uid', { length: 64 }).notNull(), // qap_<hex>
    resultUid: varchar('result_uid', { length: 64 }).notNull(),
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),
    content: text('content'),
    status: varchar('status', { length: 16 }).notNull().default('open'), // open|resolved|rejected
    handler: varchar('handler', { length: 128 }),
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uniq_quarter_appeal_uid').on(table.appealUid),
    index('idx_quarter_appeal_result').on(table.resultUid),
    index('idx_quarter_appeal_ratee').on(table.rateeUserId),
  ],
);
