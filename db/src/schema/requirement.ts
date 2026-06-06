import {
  bigserial,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  date,
  integer,
} from 'drizzle-orm/pg-core';

/**
 * 需求（项目驱动 R1）：提出人发起、PM 收口把关、拆成任务执行的最小价值单元。
 * 挂在业务线(顶级 project) 或某 app(子 project) 下；任务从需求拆出(task.requirement_uid)。
 * 生命周期对齐《需求管理规范》：收集→分析→需求评审→技术评审→排期→开发→测试→产品验收→技术上线→业务验收→业务上线→复盘（可回退、可驳回）。
 */
export const requirement = pgTable(
  'requirement',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requirementUid: varchar('requirement_uid', { length: 64 }).notNull(),

    title: varchar('title', { length: 500 }).notNull(),
    value: text('value'),               // 价值/解决的问题
    description: text('description'),

    // 归属：业务线(顶级 project) 必填；app(子 project) 可空 = 挂业务线本身
    businessLineUid: varchar('business_line_uid', { length: 64 }).notNull(),
    appProjectUid: varchar('app_project_uid', { length: 64 }),

    source: varchar('source', { length: 16 }).notNull().default('biz'),     // biz/plan/tech/feedback
    priority: varchar('priority', { length: 8 }).notNull().default('P2'),   // P0/P1/P2
    status: varchar('status', { length: 32 }).notNull().default('collected'),
    targetVersion: varchar('target_version', { length: 32 }),               // 目标版本/迭代

    reporterUserId: varchar('reporter_user_id', { length: 128 }).notNull(),
    reporterName: varchar('reporter_name', { length: 128 }).notNull(),
    pmUserId: varchar('pm_user_id', { length: 128 }),       // 承接人(PM)，null=待认领
    pmName: varchar('pm_name', { length: 128 }),
    acceptorUserId: varchar('acceptor_user_id', { length: 128 }),
    acceptorName: varchar('acceptor_name', { length: 128 }),

    expectedReleaseDate: date('expected_release_date'),     // 期望上线(P0必填)
    estEffortDays: numeric('est_effort_days', { precision: 5, scale: 1 }),  // 预估工时(人天)

    companyId: varchar('company_id', { length: 64 }).notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    updatedBy: varchar('updated_by', { length: 128 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uniq_requirement_uid').on(t.requirementUid),
    index('idx_requirement_business_line').on(t.businessLineUid),
    index('idx_requirement_app').on(t.appProjectUid),
    index('idx_requirement_status').on(t.status),
    index('idx_requirement_pm').on(t.pmUserId),
  ],
);

/** 需求产出物（规范要求各阶段留痕：PRD/技术设计/测试用例/验收报告/业务确认/上线公告）。 */
export const requirementArtifact = pgTable(
  'requirement_artifact',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requirementUid: varchar('requirement_uid', { length: 64 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),   // prd/tech_design/test_case/accept_report/biz_confirm/release_note
    title: varchar('title', { length: 256 }).notNull(),
    url: varchar('url', { length: 1024 }),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_req_artifact_req').on(t.requirementUid)],
);
