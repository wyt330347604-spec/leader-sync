import {
  bigserial,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// quarter_result / quarter_result_revision — 季度合成结果 + 评分会改分留痕
// 对应 migration 0020_add_quarter_result.sql
//
// spec 2026-07-08 performance-review-module §3.3 §4 §5：
//   compute（管理角色触发）从已提交 sheet 取数合成，写一条 draft 结果（一任务一条）：
//     goal_score + manager_soft/peer_soft/mgmt_avg → soft_merged（domain-core mergeSoft）
//     → total（quarterlyTotal）→ grade（quarterlyGrade，红线→D）。
//   weights_used 记 mergeSoft 实际权重组；mgmt_raters 记排除规则 + 参与人 + 个人分（留痕透明）。
//   status：draft（评分会可改分）→ published（公示，禁改，开放申诉）→ closed（申诉处理完锁定）。
// 软引用，无 DB 外键。

// 软项合成实际采用的权重组（domain-core SoftWeights 的落库形态，值之和恒为 1）。
// 硬化1：缺席方（管理层/同事）的 key 不出现，故 mgmt/peer 均可选。
export interface QuarterWeightsUsed {
  manager: number;
  mgmt?: number;
  peer?: number;
}

// 管理层评分留痕：排除规则 + 被排除名单 + 参与评分名单 + 每人软项分。
export interface QuarterMgmtRaters {
  // all_excluded_fallback（硬化2）：管理层评分人全排除，raterIds=[]、无 management sheet。
  rule: 'first_level_dept' | 'manager_chain_fallback' | 'all_excluded_fallback' | null;
  excludedIds: string[];
  raterIds: string[];
  scores: { raterId: string; raterName: string | null; soft: number }[];
}

export const quarterResult = pgTable(
  'quarter_result',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resultUid: varchar('result_uid', { length: 64 }).notNull(), // qr_<hex>
    cycleUid: varchar('cycle_uid', { length: 64 }).notNull(),
    taskUid: varchar('task_uid', { length: 64 }).notNull(), // 一任务一结果
    rateeUserId: varchar('ratee_user_id', { length: 128 }).notNull(),
    rateeName: varchar('ratee_name', { length: 128 }),
    sheetType: varchar('sheet_type', { length: 16 }), // employee|leader（冗余）
    goalScore: numeric('goal_score', { precision: 6, scale: 2 }),
    managerSoft: numeric('manager_soft', { precision: 6, scale: 2 }),
    peerSoft: numeric('peer_soft', { precision: 6, scale: 2 }),
    mgmtAvg: numeric('mgmt_avg', { precision: 6, scale: 2 }), // 无 mgmt / 全排除 → null
    softMerged: numeric('soft_merged', { precision: 6, scale: 2 }),
    total: numeric('total', { precision: 6, scale: 2 }),
    grade: varchar('grade', { length: 2 }), // S|A|B|C|D
    redLine: boolean('red_line').notNull().default(false),
    redLineNote: text('red_line_note'),
    weightsUsed: jsonb('weights_used').$type<QuarterWeightsUsed>(),
    mgmtRaters: jsonb('mgmt_raters').$type<QuarterMgmtRaters>(),
    status: varchar('status', { length: 16 }).notNull().default('draft'), // draft|published|closed
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // 公示 + 3 个工作日（domain-core addWorkingDays）
    appealDeadlineAt: timestamp('appeal_deadline_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_quarter_result_uid').on(table.resultUid),
    uniqueIndex('uniq_quarter_result_task').on(table.taskUid),
    index('idx_quarter_result_cycle').on(table.cycleUid),
    index('idx_quarter_result_ratee').on(table.rateeUserId),
  ],
);

export const quarterResultRevision = pgTable(
  'quarter_result_revision',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    revisionUid: varchar('revision_uid', { length: 64 }).notNull(), // qrr_<hex>
    resultUid: varchar('result_uid', { length: 64 }).notNull(),
    field: varchar('field', { length: 32 }).notNull(), // goal_score|soft_merged|total|grade
    before: text('before'),
    after: text('after'),
    reason: text('reason').notNull(), // 评分会改分必填
    revisedBy: varchar('revised_by', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_quarter_result_revision_uid').on(table.revisionUid),
    index('idx_quarter_result_revision_res').on(table.resultUid),
  ],
);
