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
  // 成员生命周期（migration 0023）——不物理删除，仅打标记
  // left_at: 飞书同步自动判定离职（NULL=在职）；sync-engine 之外由 sync-org-hierarchy 写
  leftAt: timestamp('left_at', { withTimezone: true }),
  // 离职来源：'feishu'=通讯录同步自动判定（可被复职自愈清除）| 'manual'=管理员手动标记（同步永不复活）
  // NULL 视同历史 'feishu'。migration 0024
  leftSource: varchar('left_source', { length: 16 }),
  // hidden_at / hidden_by: 管理员手动隐藏（在职但不入目录）
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenBy: varchar('hidden_by', { length: 128 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
