-- db/migrations/0005_add_grade_system.sql
-- 职级体系：org_cache 新增 current_grade 字段 + grade_history 变更审计表
-- 不修改任何现有字段，不设数据库级外键

-- 给 org_cache 新增职级字段（nullable，上线前人工录入存量数据）
-- 约束由应用层校验（正则 /^T[4-8]\.[0-3]$/），不在 DB 层加 CHECK（枚举更新无需 migration）
ALTER TABLE org_cache
  ADD COLUMN IF NOT EXISTS current_grade VARCHAR(8);

-- ---

-- 职级变更历史表
CREATE TABLE grade_history (
  id             BIGSERIAL    PRIMARY KEY,
  record_uid     VARCHAR(64)  NOT NULL,                  -- 业务主键，格式 gh_<nanoid>

  -- 软引用 org_cache.user_id，不设 DB 外键
  user_id        VARCHAR(128) NOT NULL,

  grade          VARCHAR(8)   NOT NULL,                  -- 变更后职级，如 "T5.2"
  prev_grade     VARCHAR(8),                             -- 变更前职级（首次设定时为 NULL）

  changed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  changed_by     VARCHAR(128) NOT NULL,                  -- 操作人 user_id，来自 JWT，不接受客户端传入

  -- 触发类型枚举：initial_entry / biannual_promotion / manual_adjustment
  trigger_type   VARCHAR(32)  NOT NULL,

  score_snapshot JSONB,                                  -- 可选：触发变更时的绩效快照（jsonb 为多维评分预留）
  note           TEXT,                                   -- 可选备注（manual_adjustment 时必填，应用层校验）

  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX uniq_grade_history_uid  ON grade_history (record_uid);
CREATE INDEX idx_grade_history_user_id      ON grade_history (user_id);
CREATE INDEX idx_grade_history_changed_at   ON grade_history (changed_at);
