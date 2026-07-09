-- db/migrations/0021_add_half_year_and_peer_skipped.sql
-- 绩效 P4a（spec 2026-07-08 performance-review-module §3.3 §4 §5 §10）：
--   1. quarter_task.peer_skipped  硬化3 · 同事超时放行标记（门控视同「同事已完成」）
--   2. half_year_result           半年合成成绩（前季 40% + 后季 60%；仅一季 → single_100）
-- 完全隔离：加列 + 新表，不改现有行为，无 DB 外键（软引用）。
-- 幂等：IF NOT EXISTS，可重复执行。照 0017–0020 风格。
--
-- 编号接续：现有迁移已推进至 0020，故本次为 0021。

-- 1. quarter_task.peer_skipped ----------------------------------------------
ALTER TABLE quarter_task
  ADD COLUMN IF NOT EXISTS peer_skipped BOOLEAN NOT NULL DEFAULT false;

-- 2. half_year_result -------------------------------------------------------
CREATE TABLE IF NOT EXISTS half_year_result (
  id             BIGSERIAL     PRIMARY KEY,
  result_uid     VARCHAR(64)   NOT NULL,        -- hyr_<hex>
  half           VARCHAR(16)   NOT NULL,        -- 'YYYY-HN'
  ratee_user_id  VARCHAR(128)  NOT NULL,
  ratee_name     VARCHAR(128),
  prev_quarter   VARCHAR(16),                   -- 前季 'YYYY-QN'
  curr_quarter   VARCHAR(16),                   -- 后季 'YYYY-QN'
  prev_total     NUMERIC(6,2),                  -- 前季 quarter_result.total（缺 → NULL）
  curr_total     NUMERIC(6,2),                  -- 后季 quarter_result.total（缺 → NULL）
  formula        VARCHAR(16),                   -- '40/60' | 'single_100'
  total          NUMERIC(6,2),
  grade          VARCHAR(2),                    -- S|A|B|C|D
  synthesized_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_half_year_result_uid        ON half_year_result (result_uid);
-- 一人一半年一条（compute 幂等 upsert 目标）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_half_year_result_half_ratee ON half_year_result (half, ratee_user_id);
CREATE INDEX        IF NOT EXISTS idx_half_year_result_ratee       ON half_year_result (ratee_user_id);
