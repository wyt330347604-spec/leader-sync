-- db/migrations/0019_add_quarter_review.sql
-- 季度考核核心流 P2（spec 2026-07-08 performance-review-module §2.3 §3.3 §4 §5 §6 §10）：
--   quarter_cycle          季度评分周期
--   quarter_task           某被评人一季一条任务（串行门控 stage）
--   quarter_sheet          单张打分表（self|manager|peer|management）
--   quarter_sheet_item     每维度明细（weight 提交时快照）
--   peer_assignment        同事互评指定（连任校验用）
--   quarter_goal           半年目标（直属设定，本人可见）
--   quarter_goal_revision  半年目标季中调整留痕
-- 完全隔离：新表，不改现有表行为，无 DB 外键（软引用）。
-- 幂等：全部 IF NOT EXISTS，可重复执行。照 0017/0018 风格。
--
-- 编号接续：现有迁移已推进至 0018，故本次为 0019。

-- quarter_cycle --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_cycle (
  id            BIGSERIAL     PRIMARY KEY,
  cycle_uid     VARCHAR(64)   NOT NULL,        -- 业务主键 qc_<hex>
  quarter       VARCHAR(16)   NOT NULL,        -- 'YYYY-QN'
  status        VARCHAR(16)   NOT NULL DEFAULT 'scoring',  -- goal_check|scoring|panel|published|closed
  open_at       TIMESTAMPTZ,
  deadline_at   TIMESTAMPTZ,
  panel_at      TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_cycle_uid     ON quarter_cycle (cycle_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_cycle_quarter ON quarter_cycle (quarter);

-- quarter_task ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_task (
  id                BIGSERIAL     PRIMARY KEY,
  task_uid          VARCHAR(64)   NOT NULL,    -- qt_<hex>
  cycle_uid         VARCHAR(64)   NOT NULL,
  ratee_user_id     VARCHAR(128)  NOT NULL,
  ratee_name        VARCHAR(128),
  sheet_type        VARCHAR(16)   NOT NULL,    -- employee|leader
  template_uid      VARCHAR(64),               -- 开窗盖章
  mgmt_required     BOOLEAN       NOT NULL DEFAULT false,
  mgmt_reason       TEXT,
  enrolled          BOOLEAN       NOT NULL DEFAULT true,
  skip_reason       TEXT,
  stage             VARCHAR(24)   NOT NULL DEFAULT 'pending_self',
  self_skipped      BOOLEAN       NOT NULL DEFAULT false,
  stage_deadlines   JSONB,                     -- {self, peer_manager, mgmt} ISO 串
  mgmt_trace        JSONB,                     -- 排除名单留痕 {rule, excludedIds, raterIds}
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_task_uid          ON quarter_task (task_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_task_cycle_ratee  ON quarter_task (cycle_uid, ratee_user_id);
CREATE INDEX        IF NOT EXISTS idx_quarter_task_ratee         ON quarter_task (ratee_user_id);
CREATE INDEX        IF NOT EXISTS idx_quarter_task_stage         ON quarter_task (stage);

-- quarter_sheet --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_sheet (
  id            BIGSERIAL     PRIMARY KEY,
  sheet_uid     VARCHAR(64)   NOT NULL,        -- qs_<hex>
  cycle_uid     VARCHAR(64)   NOT NULL,
  task_uid      VARCHAR(64)   NOT NULL,
  ratee_user_id VARCHAR(128)  NOT NULL,
  rater_user_id VARCHAR(128)  NOT NULL,
  rater_name    VARCHAR(128),
  rater_role    VARCHAR(16)   NOT NULL,        -- self|manager|peer|management
  status        VARCHAR(16)   NOT NULL DEFAULT 'draft',  -- draft|submitted
  soft_total    NUMERIC(6,2),
  goal_score    NUMERIC(6,2),                  -- 仅 manager sheet
  submitted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  version       INTEGER       NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_sheet_uid            ON quarter_sheet (sheet_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_sheet_task_rater_role ON quarter_sheet (task_uid, rater_user_id, rater_role);
CREATE INDEX        IF NOT EXISTS idx_quarter_sheet_rater           ON quarter_sheet (rater_user_id);
CREATE INDEX        IF NOT EXISTS idx_quarter_sheet_cycle           ON quarter_sheet (cycle_uid);

-- quarter_sheet_item ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_sheet_item (
  id                BIGSERIAL     PRIMARY KEY,
  item_uid          VARCHAR(64)   NOT NULL,    -- qsi_<hex>
  sheet_uid         VARCHAR(64)   NOT NULL,
  dimension_code    VARCHAR(32)   NOT NULL,
  dimension_name    VARCHAR(128),
  weight            NUMERIC(5,2)  NOT NULL,    -- 提交时快照
  raw               INTEGER       NOT NULL,    -- 1–10
  weighted          NUMERIC(6,2)  NOT NULL,    -- raw/10 × weight
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_sheet_item_uid       ON quarter_sheet_item (item_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_sheet_item_sheet_dim ON quarter_sheet_item (sheet_uid, dimension_code);

-- peer_assignment ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS peer_assignment (
  id            BIGSERIAL     PRIMARY KEY,
  assign_uid    VARCHAR(64)   NOT NULL,        -- pa_<hex>
  cycle_uid     VARCHAR(64)   NOT NULL,
  quarter       VARCHAR(16)   NOT NULL,        -- 连任历史查询用
  ratee_user_id VARCHAR(128)  NOT NULL,
  peer_user_id  VARCHAR(128)  NOT NULL,
  peer_name     VARCHAR(128),
  assigned_by   VARCHAR(128),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_peer_assignment_uid          ON peer_assignment (assign_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_peer_assignment_cycle_ratee  ON peer_assignment (cycle_uid, ratee_user_id);
CREATE INDEX        IF NOT EXISTS idx_peer_assignment_ratee         ON peer_assignment (ratee_user_id);

-- quarter_goal ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_goal (
  id            BIGSERIAL     PRIMARY KEY,
  goal_uid      VARCHAR(64)   NOT NULL,        -- qg_<hex>
  half          VARCHAR(16)   NOT NULL,        -- 'YYYY-H2'
  ratee_user_id VARCHAR(128)  NOT NULL,
  content       TEXT,
  set_by        VARCHAR(128),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_goal_uid        ON quarter_goal (goal_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_goal_half_ratee ON quarter_goal (half, ratee_user_id);

-- quarter_goal_revision ------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_goal_revision (
  id            BIGSERIAL     PRIMARY KEY,
  revision_uid  VARCHAR(64)   NOT NULL,        -- qgr_<hex>
  goal_uid      VARCHAR(64)   NOT NULL,
  before        TEXT,
  after         TEXT,
  reason        TEXT,
  revised_by    VARCHAR(128),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_goal_revision_uid ON quarter_goal_revision (revision_uid);
