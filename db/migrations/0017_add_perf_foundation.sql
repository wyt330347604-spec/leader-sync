-- db/migrations/0017_add_perf_foundation.sql
-- 绩效模块 P0 地基（spec 2026-07-08 performance-review-module §2 §3 §10）：
--   perf_role         绩效打分身份（飞书群同步）
--   feishu_department 组织架构部门树（一级部门 leader 排除规则用）
--   score_template    打分规则模板（规则进库不写死）
--   score_dimension   模板维度 + 档位锚定
--   org_cache.joined_at  入职日期（季度新人规则用）
-- 完全隔离：新表 + 单列新增，不改现有表行为，无 DB 外键（软引用）。
-- 幂等：全部 IF NOT EXISTS，可重复执行。
--
-- 注：紧邻的 0008_add_performance_indexes.sql 已占用 0008 编号，且现有迁移
-- 已推进至 0016，故本次接续为 0017（非 spec/任务书笔误的 0008）。

-- perf_role ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perf_role (
  id                BIGSERIAL     PRIMARY KEY,
  user_id           VARCHAR(128)  NOT NULL,          -- 软引用 org_cache.user_id
  open_id           VARCHAR(128),                    -- 飞书 open_id（群成员 member_id）
  is_leader         BOOLEAN       NOT NULL DEFAULT false,
  is_management     BOOLEAN       NOT NULL DEFAULT false,
  source_chat_ids   JSONB,                            -- string[]：身份来源群（留痕）
  synced_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_perf_role_user_id ON perf_role (user_id);
CREATE INDEX IF NOT EXISTS idx_perf_role_open_id        ON perf_role (open_id);

-- feishu_department ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS feishu_department (
  dept_id           VARCHAR(128)  PRIMARY KEY,        -- open_department_id
  parent_dept_id    VARCHAR(128),                     -- 上级部门，根为 '0'
  name              VARCHAR(256),
  leader_user_id    VARCHAR(128),                     -- 部门负责人 open_id（软引用）
  level             INTEGER       NOT NULL DEFAULT 0,  -- 根=0，根的直接子=1，依次递增
  synced_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feishu_department_parent ON feishu_department (parent_dept_id);

-- score_template -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_template (
  id                BIGSERIAL     PRIMARY KEY,
  template_uid      VARCHAR(64)   NOT NULL,           -- 业务主键
  code              VARCHAR(32)   NOT NULL,           -- monthly_employee|monthly_leader|quarterly_employee|quarterly_leader
  version           INTEGER       NOT NULL DEFAULT 1,
  active            BOOLEAN       NOT NULL DEFAULT true,
  grade_bands       JSONB         NOT NULL,           -- [{grade,min,minInclusive,label,display}]
  goal_weight       INTEGER,                          -- 季度目标/团队结果分值（45/40）；月度为 NULL
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_score_template_uid  ON score_template (template_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_score_template_code ON score_template (code);

-- score_dimension ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_dimension (
  id                BIGSERIAL     PRIMARY KEY,
  dimension_uid     VARCHAR(64)   NOT NULL,           -- 业务主键
  template_uid      VARCHAR(64)   NOT NULL,           -- 反向引用 score_template.template_uid（软引用）
  code              VARCHAR(32)   NOT NULL,
  name              VARCHAR(128)  NOT NULL,
  description       TEXT,
  weight            NUMERIC(5,2)  NOT NULL,           -- 月度合计 100；季度软项合计 55/60
  sort              INTEGER       NOT NULL DEFAULT 0,
  scale             VARCHAR(16)   NOT NULL,           -- 'coefficient' | 'one_to_ten'
  anchors           JSONB         NOT NULL,           -- [{grade,range,desc}]
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_score_dimension_uid ON score_dimension (dimension_uid);
-- (template_uid, code) 唯一：幂等 upsert + 完整性；template_uid 为最左前缀，
-- 同时满足「按模板查维度」的索引需求。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_score_dimension_template_code
  ON score_dimension (template_uid, code);

-- org_cache.joined_at --------------------------------------------------------
ALTER TABLE org_cache
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;
