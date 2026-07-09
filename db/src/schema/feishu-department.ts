import {
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// feishu_department — 飞书组织架构部门树
// 对应 migration 0017_add_perf_foundation.sql
//
// 用途（spec 2026-07-08 performance-review-module §2.3）：季度管理层评分的
// 「关联的一级部门领导除外」规则 —— 沿部门树向上走到根（level 0）的下一层
// 那个部门即被评人的一级部门，其 leader_user_id 从管理层均值中排除。
//
// worker job sync-departments 每日随通讯录同步一起拉：
//   contact.department.children 递归结果 upsert；level 从根往下算（根的直接子 = 1）。
// 软引用，无 DB 外键（与本仓库其余表一致）。

export const feishuDepartment = pgTable(
  'feishu_department',
  {
    // 飞书 open_department_id，作主键（一部门一行）
    deptId: varchar('dept_id', { length: 128 }).primaryKey(),
    // 上级部门 open_department_id，根部门为 '0'
    parentDeptId: varchar('parent_dept_id', { length: 128 }),
    name: varchar('name', { length: 256 }),
    // 部门负责人 open_id（软引用 org_cache.user_id / open_id）
    leaderUserId: varchar('leader_user_id', { length: 128 }),
    // 层级：根 = 0，根的直接子 = 1，依次递增
    level: integer('level').notNull().default(0),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_feishu_department_parent').on(table.parentDeptId),
  ],
);
