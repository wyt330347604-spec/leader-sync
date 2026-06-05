-- db/migrations/0004_add_incident_module.sql
-- 新增事故记录模块：incident 主表 + incident_user 关联表
-- 完全隔离：不修改任何现有表，不设数据库级外键

CREATE TABLE incident (
  id                 BIGSERIAL     PRIMARY KEY,
  incident_uid       VARCHAR(64)   NOT NULL,

  title              VARCHAR(500)  NOT NULL,
  description        TEXT,

  -- 严重程度：P0 / P1 / P2 / P3
  severity           VARCHAR(8)    NOT NULL,

  -- 记录人（发起人）
  reporter_user_id   VARCHAR(128)  NOT NULL,
  reporter_name      VARCHAR(128)  NOT NULL,

  -- 关联任务（可选，软引用 task.task_uid，不设 FK）
  related_task_uid   VARCHAR(64),

  -- 公司/组织 ID（预留多租户扩展，MVP 阶段硬编码单租户值）
  company_id         VARCHAR(64)   NOT NULL,

  -- P0/P1 二次确认机制
  -- pending_confirm = 待 PMO/Boss 确认
  -- confirmed       = 已确认生效
  -- rejected        = 被驳回（永不生效）
  confirm_status     VARCHAR(32)   NOT NULL DEFAULT 'confirmed',
  confirmed_by       VARCHAR(128),
  confirmed_at       TIMESTAMPTZ,
  reject_reason      TEXT,

  -- 事故发生日期（区别于 created_at 记录时间，支持跨月记录）
  -- 为空时以 created_at 月份作为归属月
  incident_date      DATE,

  -- 审计字段
  version            INTEGER       NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by         VARCHAR(128)  NOT NULL,
  updated_by         VARCHAR(128),
  deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX uniq_incident_uid        ON incident (incident_uid);
CREATE INDEX idx_incident_company_id         ON incident (company_id);
CREATE INDEX idx_incident_severity           ON incident (severity);
CREATE INDEX idx_incident_confirm_status     ON incident (confirm_status);
CREATE INDEX idx_incident_created_at         ON incident (created_at);

-- ---

CREATE TABLE incident_user (
  id             BIGSERIAL    PRIMARY KEY,
  incident_uid   VARCHAR(64)  NOT NULL,
  user_id        VARCHAR(128) NOT NULL,
  user_name      VARCHAR(128) NOT NULL,

  -- 员工在此事故中的角色
  -- involved = 涉及（默认）
  -- primary  = 主要责任人
  involvement    VARCHAR(32)  NOT NULL DEFAULT 'involved',

  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incident_user_incident_uid  ON incident_user (incident_uid);
CREATE INDEX idx_incident_user_user_id       ON incident_user (user_id);
-- 同一员工在同一事故中只能有一条记录
CREATE UNIQUE INDEX uniq_incident_user       ON incident_user (incident_uid, user_id);
