import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// grade_history — 职级变更审计表
// 对应 migration 0005_add_grade_system.sql
//
// org_cache.current_grade 字段扩展说明：
//   字段在 org-cache.ts 中通过 currentGrade: varchar('current_grade', { length: 8 }) 声明。
//   由于任务要求不修改现有文件，此处提供类型声明供使用方参考：
//
//   type OrgCacheExtended = typeof orgCache.$inferSelect & {
//     currentGrade: string | null;  // 格式 T4.0–T8.3，NULL 表示未分配职级
//   };
//
// 格式约束：T4.0–T8.3，共 20 级；由应用层正则 /^T[4-8]\.[0-3]$/ 校验，DB 层不加 CHECK。

export const gradeHistory = pgTable(
  'grade_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    recordUid: varchar('record_uid', { length: 64 }).notNull(),  // 业务主键，格式 gh_<nanoid>

    // 软引用 org_cache.user_id，不设 DB 外键
    userId: varchar('user_id', { length: 128 }).notNull(),

    grade: varchar('grade', { length: 8 }).notNull(),       // 变更后职级，如 "T5.2"
    prevGrade: varchar('prev_grade', { length: 8 }),        // 变更前职级（首次设定时为 NULL）

    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedBy: varchar('changed_by', { length: 128 }).notNull(),  // 操作人 user_id，来自 JWT

    // 触发类型枚举：initial_entry / biannual_promotion / manual_adjustment
    triggerType: varchar('trigger_type', { length: 32 }).notNull(),

    // 可选：触发变更时的绩效快照（jsonb 为多维评分预留扩展空间）
    scoreSnapshot: jsonb('score_snapshot'),

    note: text('note'),  // manual_adjustment 时由应用层强制要求填写

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uniq_grade_history_uid').on(table.recordUid),
    index('idx_grade_history_user_id').on(table.userId),
    index('idx_grade_history_changed_at').on(table.changedAt),
  ],
);
