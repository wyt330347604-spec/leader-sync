import {
  bigserial,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// peer_assignment — 季度同事互评指定（一人一季一名 peer）
// 对应 migration 0019_add_quarter_review.sql
//
// spec 2026-07-08 performance-review-module §3.3：
//   被评人的直属（或 admin/hr）为其指定一名同事评价人。
//   连任校验（domain-core validatePeerAssignment）：同一 peer 最多连续两季 —— 校验时
//   按 ratee 查历史（各季 quarter + peer_user_id）。故本表同时存 quarter 与 cycle_uid：
//     quarter 供跨季历史查询，cycle_uid 供本周期定位（二者一一对应）。
// 软引用，无 DB 外键。

export const peerAssignment = pgTable(
  'peer_assignment',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    assignUid: varchar('assign_uid', { length: 64 }).notNull(), // pa_<hex>
    cycleUid: varchar('cycle_uid', { length: 64 }).notNull(),
    quarter: varchar('quarter', { length: 16 }).notNull(), // 'YYYY-QN'，连任历史查询用
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),
    peerUserId: varchar('peer_user_id', { length: 128 }).notNull(),
    peerName: varchar('peer_name', { length: 128 }),
    assignedBy: varchar('assigned_by', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_peer_assignment_uid').on(table.assignUid),
    // 一人一季一条；cycle_uid 最左前缀兼作「按周期查指定」索引。
    uniqueIndex('uniq_peer_assignment_cycle_ratee').on(table.cycleUid, table.rateeUserId),
    // 连任历史：按 ratee 查各季 peer。
    index('idx_peer_assignment_ratee').on(table.rateeUserId),
  ],
);
