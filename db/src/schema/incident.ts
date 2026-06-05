import {
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  date,
  integer,
} from 'drizzle-orm/pg-core';

export const incident = pgTable(
  'incident',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    incidentUid: varchar('incident_uid', { length: 64 }).notNull(),

    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),

    // 严重程度：P0 / P1 / P2 / P3
    severity: varchar('severity', { length: 8 }).notNull(),

    // 记录人（发起人）
    reporterUserId: varchar('reporter_user_id', { length: 128 }).notNull(),
    reporterName: varchar('reporter_name', { length: 128 }).notNull(),

    // 关联任务（可选，软引用 task.task_uid，不设 DB 外键）
    relatedTaskUid: varchar('related_task_uid', { length: 64 }),

    // 关联项目（V2 问责闭环，软引用 project.project_uid）。关联任务时自动带出该任务的项目。
    relatedProjectUid: varchar('related_project_uid', { length: 64 }),

    // 公司/组织 ID（预留多租户扩展，MVP 阶段硬编码单租户值）
    companyId: varchar('company_id', { length: 64 }).notNull(),

    // P0/P1 二次确认机制
    // pending_confirm = 待 PMO/Boss 确认
    // confirmed       = 已确认生效
    // rejected        = 被驳回（永不生效）
    confirmStatus: varchar('confirm_status', { length: 32 }).notNull().default('confirmed'),
    confirmedBy: varchar('confirmed_by', { length: 128 }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),

    // 事故发生日期（区别于 created_at 记录时间，支持跨月记录）
    // 为空时以 created_at 月份作为归属月
    incidentDate: date('incident_date'),

    // 审计字段
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar('created_by', { length: 128 }).notNull(),
    updatedBy: varchar('updated_by', { length: 128 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uniq_incident_uid').on(table.incidentUid),
    index('idx_incident_company_id').on(table.companyId),
    index('idx_incident_severity').on(table.severity),
    index('idx_incident_confirm_status').on(table.confirmStatus),
    index('idx_incident_created_at').on(table.createdAt),
  ],
);

export const incidentUser = pgTable(
  'incident_user',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    // 软引用 incident.incident_uid，不设 DB 外键
    incidentUid: varchar('incident_uid', { length: 64 }).notNull(),

    // 软引用 org_cache.user_id，不设 DB 外键
    userId: varchar('user_id', { length: 128 }).notNull(),
    userName: varchar('user_name', { length: 128 }).notNull(),

    // 员工在此事故中的角色
    // involved = 涉及（默认）
    // primary  = 主要责任人
    involvement: varchar('involvement', { length: 32 }).notNull().default('involved'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_incident_user').on(table.incidentUid, table.userId),
    index('idx_incident_user_incident_uid').on(table.incidentUid),
    index('idx_incident_user_user_id').on(table.userId),
  ],
);
