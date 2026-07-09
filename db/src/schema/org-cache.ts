import {
  bigserial,
  boolean,
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
  // manager 来源：'feishu'=通讯录同步 | 'manual'=组织架构图人工调整（同步不覆盖）
  // migration 0015；消费方只读 manager_user_id，source 仅供写入侧仲裁
  managerSource: varchar('manager_source', { length: 16 }).notNull().default('feishu'),
  managerUpdatedAt: timestamp('manager_updated_at', { withTimezone: true }),
  managerUpdatedBy: varchar('manager_updated_by', { length: 128 }),
  // 绩效豁免：true = 不参与月度绩效（不生成打分草稿）。migration 0016
  scoreExempt: boolean('score_exempt').notNull().default(false),
  // 入职日期：飞书通讯录 join_time 同步；拉不到时为 null，由 HR 手补。migration 0017
  // 用途：季度新人规则（周期内 ≥2 完整月才参评）。sync-engine 不写此字段。
  joinedAt: timestamp('joined_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  // 职级字段：格式 T4.0–T8.3，NULL 表示该员工尚未分配职级
  // 由应用层正则 /^T[4-8]\.[0-3]$/ 校验，DB 层不加 CHECK 约束
  // Drizzle 只新增字段，不修改已有字段 — sync-engine 不写此字段，隔离安全
  currentGrade: varchar('current_grade', { length: 8 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
