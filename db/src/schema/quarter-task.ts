import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// quarter_task — 季度某被评人的考核任务（一人一季一条）
// 对应 migration 0019_add_quarter_review.sql
//
// spec 2026-07-08 performance-review-module §3.3 §5：
//   开窗时对 org_cache 全员（score_exempt 跳过）生成，template_uid 开窗盖章。
//   stage 串行门控（Harvey 定）：
//     pending_self → pending_peer_manager → pending_mgmt → scored
//   自评提交/超时(self_skipped) → 解锁 同事+直属；直属提交 → mgmt_required ?
//     建管理层 sheet + pending_mgmt : scored。无 mgmt 的员工走完 ② 即 scored。
//   enrolled=false（新人不足 2 完整月等）记 skip_reason，不建 sheet。
//   mgmt_required：leader 恒 true；员工由直属勾"表现差/晋级申请"（mgmt_reason 必填）。
//   stage_deadlines jsonb：{self, peer_manager, mgmt} ISO 时间串（开窗时按偏移算）。
//   mgmt_trace jsonb：管理层 sheet 生成时的排除名单留痕
//     { rule, excludedIds, raterIds }（rule=first_level_dept | manager_chain_fallback）。
// 软引用，无 DB 外键。

export interface QuarterStageDeadlines {
  self: string;
  peer_manager: string;
  mgmt: string;
}

export interface QuarterMgmtTrace {
  // first_level_dept / manager_chain_fallback：正常排除规则；
  // all_excluded_fallback（硬化2）：排除后管理层评分人为空，本任务退化为无 mgmt（raterIds=[]）。
  rule: 'first_level_dept' | 'manager_chain_fallback' | 'all_excluded_fallback';
  excludedIds: string[];
  raterIds: string[];
}

export const quarterTask = pgTable(
  'quarter_task',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    taskUid: varchar('task_uid', { length: 64 }).notNull(), // qt_<hex>
    cycleUid: varchar('cycle_uid', { length: 64 }).notNull(),
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),
    rateeName: varchar('ratee_name', { length: 128 }),
    // employee | leader（决定用哪份季度模板）
    sheetType: varchar('sheet_type', { length: 16 }).notNull(),
    // 开窗盖章：quarterly_employee / quarterly_leader 的 active 模板 uid
    templateUid: varchar('template_uid', { length: 64 }),
    mgmtRequired: boolean('mgmt_required').notNull().default(false),
    mgmtReason: text('mgmt_reason'),
    enrolled: boolean('enrolled').notNull().default(true),
    skipReason: text('skip_reason'),
    // pending_self | pending_peer_manager | pending_mgmt | scored
    stage: varchar('stage', { length: 24 }).notNull().default('pending_self'),
    selfSkipped: boolean('self_skipped').notNull().default(false),
    // 硬化3 · 同事超时放行：pending_peer_manager 过截止且 peer 未提交 → 置 true，
    //   门控视同「同事已完成」（worker advance-peer-timeout 写入）。migration 0021。
    peerSkipped: boolean('peer_skipped').notNull().default(false),
    stageDeadlines: jsonb('stage_deadlines').$type<QuarterStageDeadlines>(),
    // 管理层评分排除名单留痕（manager 提交、mgmt_required 时写入）
    mgmtTrace: jsonb('mgmt_trace').$type<QuarterMgmtTrace>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_quarter_task_uid').on(table.taskUid),
    // 一人一季一条；cycle_uid 最左前缀兼作「按周期查任务」索引。
    uniqueIndex('uniq_quarter_task_cycle_ratee').on(table.cycleUid, table.rateeUserId),
    index('idx_quarter_task_ratee').on(table.rateeUserId),
    index('idx_quarter_task_stage').on(table.stage),
  ],
);
