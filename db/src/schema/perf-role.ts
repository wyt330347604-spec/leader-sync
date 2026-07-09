import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// perf_role — 绩效打分身份（来自飞书群同步，非 RBAC）
// 对应 migration 0017_add_perf_foundation.sql
//
// 两个身份来源（spec 2026-07-08 performance-review-module §2.1/§2.2）：
//   is_leader      = leader 群 oc_1181... 成员 → 用 leader 版打分表，且必进管理层评分
//   is_management  = 管理层群 oc_ba5a... 成员 → 参与季度管理层集体打分
// 与 user_role_binding（应用 RBAC：admin/pmo/boss/hr）两套不混。
//
// worker job sync-perf-roles 每日 07:10 全量对账：在群→置位，不在群→置 false。
// open_id 关联 org_cache 补 user_id；群里有但 org_cache 没有的人记 warn 跳过。

export const perfRole = pgTable(
  'perf_role',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    // 软引用 org_cache.user_id（唯一：一人一行）
    userId: varchar('user_id', { length: 128 }).notNull(),
    // 飞书 open_id（群成员接口返回的 member_id，用于对回 org_cache）
    openId: varchar('open_id', { length: 128 }),

    isLeader: boolean('is_leader').notNull().default(false),
    isManagement: boolean('is_management').notNull().default(false),

    // 该身份来源于哪些群（留痕）：string[]，如 ['oc_1181...','oc_ba5a...']
    sourceChatIds: jsonb('source_chat_ids').$type<string[]>(),

    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_perf_role_user_id').on(table.userId),
    index('idx_perf_role_open_id').on(table.openId),
  ],
);
