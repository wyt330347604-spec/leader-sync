import {
  bigserial,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// score_template / score_dimension — 打分规则模板（进库不写死）
// 对应 migration 0017_add_perf_foundation.sql
//
// 设计原则（spec 2026-07-08 performance-review-module §3.1）：
//   规则变了改数据不改代码。四个模板 code：
//     monthly_employee | monthly_leader | quarterly_employee | quarterly_leader
//   月度 scale=coefficient（手写系数 × 权重，可超 100）；
//   季度 scale=one_to_ten（打 1–10 ÷ 10 × 权重）+ goal_weight（目标/团队结果单独打）。
//
// 命名说明：spec 用泛称 uid；本仓库 _uid 惯例为实体前缀（score_uid/record_uid…），
// 故 score_template 的业务键落为 template_uid，score_dimension 以同名 template_uid 反向引用
// （命名主权：同一语义单一 canonical 字段名），其自身业务键为 dimension_uid。
// 软引用，无 DB 外键。

// grade_bands jsonb 形态（供计分引擎直接消费，评级 = 自上而下首个满足下界的档）：
//   [{ grade, min, minInclusive, label, display }]，min=null 表示无下界（最低档）。
export interface GradeBand {
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  min: number | null;
  minInclusive: boolean;
  label: string;
  display: string;
}

// anchors jsonb 形态（每档一条，desc 为定稿原文，不改写）：
//   [{ grade, range, desc }]
export interface DimensionAnchor {
  grade: string;
  range: string;
  desc: string;
}

export const scoreTemplate = pgTable(
  'score_template',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    templateUid: varchar('template_uid', { length: 64 }).notNull(),
    // monthly_employee | monthly_leader | quarterly_employee | quarterly_leader
    code: varchar('code', { length: 32 }).notNull(),
    version: integer('version').notNull().default(1),
    active: boolean('active').notNull().default(true),
    gradeBands: jsonb('grade_bands').$type<GradeBand[]>().notNull(),
    // 季度软项模板的目标达成/团队结果分值（45/40）；月度为 null（无独立目标项）
    goalWeight: integer('goal_weight'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_score_template_uid').on(table.templateUid),
    uniqueIndex('uniq_score_template_code').on(table.code),
  ],
);

export const scoreDimension = pgTable(
  'score_dimension',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dimensionUid: varchar('dimension_uid', { length: 64 }).notNull(),
    // 反向引用 score_template.template_uid（软引用）
    templateUid: varchar('template_uid', { length: 64 }).notNull(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    // 权重：月度合计 100；季度软项合计 55（员工）/60（leader），目标另计
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull(),
    sort: integer('sort').notNull().default(0),
    // 'coefficient'（月度系数制）| 'one_to_ten'（季度 1–10 制）
    scale: varchar('scale', { length: 16 }).notNull(),
    anchors: jsonb('anchors').$type<DimensionAnchor[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_score_dimension_uid').on(table.dimensionUid),
    // (template_uid, code) 唯一：幂等 upsert + 数据完整性；
    // template_uid 为最左前缀，同时满足「按模板查维度」的索引需求。
    uniqueIndex('uniq_score_dimension_template_code').on(table.templateUid, table.code),
  ],
);
