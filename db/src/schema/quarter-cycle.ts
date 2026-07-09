import {
  bigserial,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// quarter_cycle — 季度考核周期
// 对应 migration 0019_add_quarter_review.sql
//
// spec 2026-07-08 performance-review-module §3.3 §5：
//   一个季度结束后开一次评分周期（Harvey 定：季度结束后才开窗）。
//   status 状态机：goal_check → scoring → panel → published → closed
//   P2 只落到 scoring（开窗建 cycle 即 scoring）；panel/published/closed 属 P3/P4。
//   open_at 开窗时刻；deadline_at 打分总截止；panel_at 评分会；published_at 公示。
// 软引用，无 DB 外键（与本仓库其余表一致）。

export const quarterCycle = pgTable(
  'quarter_cycle',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // 业务主键，格式 qc_<hex>
    cycleUid: varchar('cycle_uid', { length: 64 }).notNull(),
    // 'YYYY-QN'，一季一周期（唯一）
    quarter: varchar('quarter', { length: 16 }).notNull(),
    // goal_check | scoring | panel | published | closed
    status: varchar('status', { length: 16 }).notNull().default('scoring'),
    openAt: timestamp('open_at', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    panelAt: timestamp('panel_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_quarter_cycle_uid').on(table.cycleUid),
    uniqueIndex('uniq_quarter_cycle_quarter').on(table.quarter),
  ],
);
