import {
  bigserial,
  boolean,
  decimal,
  index,
  integer,
  numeric,
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
    // V1.4 起冻结为历史只读（Harvey 已批 §10.5）：无 template_uid 的旧行仍用此列，
    // 有 template_uid 的新行改用 total_score/composite/grade + monthly_score_detail。
    score: decimal('score', { precision: 3, scale: 1 }),

    // ── V1.4 多维系数制（migration 0018）──────────────────────────────────────
    // 开窗时按被评人 perf_role.is_leader 盖章（monthly_leader / monthly_employee 的 active 模板）；
    // null = 旧行（单系数历史），前端渲染单值只读、后端拒绝多维提交。
    templateUid: varchar('template_uid', { length: 64 }),
    // 派生汇总（服务端用 domain-core 计算后回写）：total=Σ(系数×权重) 可 >100；composite=total/100。
    totalScore: numeric('total_score', { precision: 5, scale: 1 }),
    composite: numeric('composite', { precision: 4, scale: 2 }),
    // 自动评级：S>100 / A 90–100 / B 80–89 / C 70–79 / D<70；红线强制 D。
    grade: varchar('grade', { length: 2 }),
    // 红线一票否决：true → 强制 D + 必填说明 + 通知 boss/hr。
    redLine: boolean('red_line').notNull().default(false),
    redLineNote: text('red_line_note'),

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
    index('idx_ms_template_uid').on(table.templateUid),
  ],
);

// monthly_score_detail — 月度 V1.4 每维度明细
// 对应 migration 0018_monthly_v14.sql
//
// 一条打分行（monthly_score）在 V1.4 下按模板维度拆成多条明细：
//   员工 2 维（工作量15/交付85），leader 3 维（团队量10/团队交付70/领导力20）。
// weight 打分时快照（防模板规则后改影响历史）；weighted = coefficient × weight。
// 软引用 monthly_score.score_uid，无 DB 外键。
export const monthlyScoreDetail = pgTable(
  'monthly_score_detail',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    detailUid: varchar('detail_uid', { length: 64 }).notNull(),  // 业务主键 msd_<...>
    scoreUid: varchar('score_uid', { length: 64 }).notNull(),    // 软引用 monthly_score.score_uid
    dimensionCode: varchar('dimension_code', { length: 32 }).notNull(),
    dimensionName: varchar('dimension_name', { length: 128 }),   // 维度名快照（展示用）
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull(),        // 权重快照
    coefficient: numeric('coefficient', { precision: 4, scale: 2 }).notNull(), // 手写系数
    weighted: numeric('weighted', { precision: 6, scale: 2 }).notNull(),    // = coefficient × weight
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_msd_detail_uid').on(table.detailUid),
    // (score_uid, dimension_code) 唯一：一行每维度一条；score_uid 最左前缀兼作查明细索引。
    uniqueIndex('uniq_msd_score_dimension').on(table.scoreUid, table.dimensionCode),
  ],
);
