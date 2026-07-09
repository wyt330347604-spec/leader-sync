import {
  bigserial,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// quarter_goal / quarter_goal_revision — 半年目标 + 季中调整留痕
// 对应 migration 0019_add_quarter_review.sql
//
// spec 2026-07-08 performance-review-module §3.3 §10.4：
//   半年目标由直属设定、本人可见、双方可发起调整、直属确认留痕。
//   half：'YYYY-H1' / 'YYYY-H2'。一人一半年一条目标（可改，改动写 revision）。
//   manager 季度打分页右侧栏展示该目标作参照（P2）。
// 软引用，无 DB 外键。

export const quarterGoal = pgTable(
  'quarter_goal',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    goalUid: varchar('goal_uid', { length: 64 }).notNull(), // qg_<hex>
    half: varchar('half', { length: 16 }).notNull(), // 'YYYY-H2'
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),
    content: text('content'),
    setBy: varchar('set_by', { length: 128 }),
    // P4b 提案流（migration 0022）：员工发起的待确认调整建议。
    //   pending 提案存在 iff proposedAt IS NOT NULL；直属确认后清空。
    proposedContent: text('proposed_content'),
    proposedBy: varchar('proposed_by', { length: 128 }),
    proposedAt: timestamp('proposed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_quarter_goal_uid').on(table.goalUid),
    // 一人一半年一条；half 最左前缀兼作「按半年查目标」索引。
    uniqueIndex('uniq_quarter_goal_half_ratee').on(table.half, table.rateeUserId),
  ],
);

export const quarterGoalRevision = pgTable(
  'quarter_goal_revision',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    revisionUid: varchar('revision_uid', { length: 64 }).notNull(), // qgr_<hex>
    goalUid: varchar('goal_uid', { length: 64 }).notNull(),
    before: text('before'),
    after: text('after'),
    reason: text('reason'),
    revisedBy: varchar('revised_by', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uniq_quarter_goal_revision_uid').on(table.revisionUid)],
);
