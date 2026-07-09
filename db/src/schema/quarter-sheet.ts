import {
  bigserial,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// quarter_sheet / quarter_sheet_item — 季度单张打分表 + 每维度明细
// 对应 migration 0019_add_quarter_review.sql
//
// spec 2026-07-08 performance-review-module §3.3 §4：
//   rater_role：self（参照不计分）| manager（+目标达成 goal_score）| peer | management。
//   status：draft → submitted。soft_total = Σ(raw/10 × weight)（domain-core softSum）。
//   goal_score：仅 manager sheet 有（0–45 员工 / 0–40 leader）。
//   version：OCC，提交时校验（防并发重复提交）。
// quarter_sheet_item：weight 提交时快照（防模板后改影响历史）；
//   weighted = raw/10 × weight（domain-core quarterlyDimScore）。
// 软引用，无 DB 外键。

export const quarterSheet = pgTable(
  'quarter_sheet',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sheetUid: varchar('sheet_uid', { length: 64 }).notNull(), // qs_<hex>
    cycleUid: varchar('cycle_uid', { length: 64 }).notNull(),
    taskUid: varchar('task_uid', { length: 64 }).notNull(),
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),
    raterUserId: varchar('rater_user_id', { length: 128 }).notNull(),
    raterName: varchar('rater_name', { length: 128 }),
    // self | manager | peer | management
    raterRole: varchar('rater_role', { length: 16 }).notNull(),
    // draft | submitted
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    softTotal: numeric('soft_total', { precision: 6, scale: 2 }),
    // 目标达成/团队结果，仅 manager sheet 用
    goalScore: numeric('goal_score', { precision: 6, scale: 2 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('uniq_quarter_sheet_uid').on(table.sheetUid),
    // 一个任务下同一 rater 同一角色只有一张表；task_uid 最左前缀兼作「按任务查表」索引。
    uniqueIndex('uniq_quarter_sheet_task_rater_role').on(
      table.taskUid,
      table.raterUserId,
      table.raterRole,
    ),
    index('idx_quarter_sheet_rater').on(table.raterUserId),
    index('idx_quarter_sheet_cycle').on(table.cycleUid),
  ],
);

export const quarterSheetItem = pgTable(
  'quarter_sheet_item',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemUid: varchar('item_uid', { length: 64 }).notNull(), // qsi_<hex>
    sheetUid: varchar('sheet_uid', { length: 64 }).notNull(),
    dimensionCode: varchar('dimension_code', { length: 32 }).notNull(),
    dimensionName: varchar('dimension_name', { length: 128 }),
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull(), // 快照
    raw: integer('raw').notNull(), // 1–10
    weighted: numeric('weighted', { precision: 6, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_quarter_sheet_item_uid').on(table.itemUid),
    // 一张表每维度一条；sheet_uid 最左前缀兼作「按表查明细」索引。
    uniqueIndex('uniq_quarter_sheet_item_sheet_dim').on(table.sheetUid, table.dimensionCode),
  ],
);
