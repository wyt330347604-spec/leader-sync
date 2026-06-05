import {
  bigserial,
  decimal,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// monthly_score — 月度绩效打分表
// 对应 migration 0006_add_monthly_score.sql
//
// 状态机：draft → scored → challenged → pending_lock → locked（终态）
// locked 状态：任何代码路径不得触发 UPDATE score / status（service 层硬检查）
//
// 与 monthly_snapshot 区别：
//   monthly_snapshot = 任务维度月结快照（leader/company scope，worker 自动生成）
//   monthly_score    = 员工个人绩效评分（employee scope，Boss/PMO 手工录入，MVP 阶段）

export const monthlyScore = pgTable(
  'monthly_score',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scoreUid: varchar('score_uid', { length: 64 }).notNull(),  // 业务主键，格式 sc_<8hex>

    scoreMonth: varchar('score_month', { length: 7 }).notNull(),    // 'YYYY-MM'，与 task.month_bucket 对齐
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),  // 被打分人，软引用 org_cache.user_id
    rateeName: varchar('ratee_name', { length: 128 }),                 // 冗余快照，来自 org_cache
    raterUserId: varchar('rater_user_id', { length: 128 }).notNull(),  // 打分人（直属 leader）
    raterName: varchar('rater_name', { length: 128 }),                 // 冗余快照

    // 0.0-1.0 小数制；null = 未打分（draft 状态）
    score: decimal('score', { precision: 3, scale: 1 }),

    // 状态机状态：draft / scored / challenged / pending_lock / locked
    status: varchar('status', { length: 32 }).notNull().default('draft'),

    challengeNote: text('challenge_note'),                      // 质疑备注（线下沟通摘要）
    challengedAt: timestamp('challenged_at', { withTimezone: true }),   // 质疑发起时间
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),       // leader 响应时间
    lockedAt: timestamp('locked_at', { withTimezone: true }),           // 最终 locked 时间
    lockedBy: varchar('locked_by', { length: 128 }),                   // 执行 lock 的 PMO/Boss user_id

    // 超时升级通知发送时间
    // idempotency guard：escalated_at IS NULL 确保每条质疑只发一次升级通知
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),

    // 软引用 monthly_snapshot.snapshot_uid（employee scope），与 task.project_uid 保持一致
    snapshotRef: varchar('snapshot_ref', { length: 64 }),

    // OCC（乐观并发控制）
    version: integer('version').notNull().default(1),

    // 审计
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    updatedBy: varchar('updated_by', { length: 128 }),
  },
  (table) => [
    uniqueIndex('uniq_monthly_score_uid').on(table.scoreUid),
    uniqueIndex('uniq_score_month_ratee').on(table.scoreMonth, table.rateeUserId),
    index('idx_ms_score_month').on(table.scoreMonth),
    index('idx_ms_ratee_user_id').on(table.rateeUserId),
    index('idx_ms_rater_user_id').on(table.raterUserId),
    index('idx_ms_status').on(table.status),
  ],
);
