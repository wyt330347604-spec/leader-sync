import {
  bigserial,
  index,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// half_year_result — 半年合成成绩（前季 40% + 后季 60%；仅一季有分 → 该季 ×100%）
// 对应 migration 0021_add_half_year_and_peer_skipped.sql
//
// spec 2026-07-08 performance-review-module §3.3 §4 §5：
//   half='2026-H1' → Q1(prev)+Q2(curr)；'2026-H2' → Q3(prev)+Q4(curr)。
//   仅对该半年有 published quarter_result 的人合成（domain-core halfYearTotal）：
//     双季有分 → formula '40/60'；仅一季有分 → 'single_100'。
//   grade 由 domain-core quarterlyGrade(total) 判定（半年不再套红线）。
//   upsert 幂等：唯一 (half, ratee_user_id)。软引用，无 DB 外键。

export const halfYearResult = pgTable(
  'half_year_result',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resultUid: varchar('result_uid', { length: 64 }).notNull(), // hyr_<hex>
    half: varchar('half', { length: 16 }).notNull(), // 'YYYY-HN'
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),
    rateeName: varchar('ratee_name', { length: 128 }),
    prevQuarter: varchar('prev_quarter', { length: 16 }), // 前季 'YYYY-QN'
    currQuarter: varchar('curr_quarter', { length: 16 }), // 后季 'YYYY-QN'
    prevTotal: numeric('prev_total', { precision: 6, scale: 2 }), // 前季 quarter_result.total（缺 → NULL）
    currTotal: numeric('curr_total', { precision: 6, scale: 2 }), // 后季 quarter_result.total（缺 → NULL）
    formula: varchar('formula', { length: 16 }), // '40/60' | 'single_100'
    total: numeric('total', { precision: 6, scale: 2 }),
    grade: varchar('grade', { length: 2 }), // S|A|B|C|D
    synthesizedAt: timestamp('synthesized_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_half_year_result_uid').on(table.resultUid),
    // 一人一半年一条（upsert 目标）
    uniqueIndex('uniq_half_year_result_half_ratee').on(table.half, table.rateeUserId),
    index('idx_half_year_result_ratee').on(table.rateeUserId),
  ],
);
