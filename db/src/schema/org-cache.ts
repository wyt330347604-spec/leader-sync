import {
  bigserial,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const orgCache = pgTable('org_cache', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull().unique(),
  openId: varchar('open_id', { length: 128 }),
  userName: varchar('user_name', { length: 128 }),
  deptId: varchar('dept_id', { length: 128 }),
  deptName: varchar('dept_name', { length: 128 }),
  managerUserId: varchar('manager_user_id', { length: 128 }),
  managerName: varchar('manager_name', { length: 128 }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  // 职级字段：格式 T4.0–T8.3，NULL 表示该员工尚未分配职级
  // 由应用层正则 /^T[4-8]\.[0-3]$/ 校验，DB 层不加 CHECK 约束
  // Drizzle 只新增字段，不修改已有字段 — sync-engine 不写此字段，隔离安全
  currentGrade: varchar('current_grade', { length: 8 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
