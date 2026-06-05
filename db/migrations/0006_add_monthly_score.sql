-- db/migrations/0006_add_monthly_score.sql
-- 月度绩效打分表：支持 draft → scored → challenged → pending_lock → locked 状态机
-- 完全隔离：不修改任何现有表，不设数据库级外键

CREATE TABLE monthly_score (
  id              BIGSERIAL     PRIMARY KEY,
  score_uid       VARCHAR(64)   NOT NULL,                -- 业务主键，格式 sc_<8hex>

  score_month     VARCHAR(7)    NOT NULL,                -- 'YYYY-MM'，与 task.month_bucket 对齐
  ratee_user_id   VARCHAR(128)  NOT NULL,                -- 被打分人 user_id（软引用 org_cache.user_id）
  ratee_name      VARCHAR(128),                          -- 冗余快照，来自 org_cache
  rater_user_id   VARCHAR(128)  NOT NULL,                -- 打分人（直属 leader）
  rater_name      VARCHAR(128),                          -- 冗余快照

  -- 0.0-1.0 小数制；null = 未打分（draft 状态）
  score           DECIMAL(3,1),

  -- 状态机：draft → scored → challenged → pending_lock → locked（终态）
  status          VARCHAR(32)   NOT NULL DEFAULT 'draft',

  challenge_note  TEXT,                                  -- 质疑备注（线下沟通摘要）
  challenged_at   TIMESTAMPTZ,                           -- 质疑发起时间
  resolved_at     TIMESTAMPTZ,                           -- leader 响应时间
  locked_at       TIMESTAMPTZ,                           -- 最终 locked 时间
  locked_by       VARCHAR(128),                          -- 执行 lock 的 PMO/Boss user_id

  -- 超时升级通知发送时间（idempotency guard：escalated_at IS NULL 过滤确保每条质疑只发一次）
  escalated_at    TIMESTAMPTZ,

  -- 软引用 monthly_snapshot.snapshot_uid（employee scope）
  snapshot_ref    VARCHAR(64),

  -- OCC（乐观并发控制）
  version         INTEGER       NOT NULL DEFAULT 1,

  -- 审计
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(128)  NOT NULL,
  updated_by      VARCHAR(128),

  CONSTRAINT uniq_score_month_ratee UNIQUE (score_month, ratee_user_id)
);

CREATE UNIQUE INDEX uniq_monthly_score_uid  ON monthly_score (score_uid);
CREATE INDEX idx_ms_score_month             ON monthly_score (score_month);
CREATE INDEX idx_ms_ratee_user_id           ON monthly_score (ratee_user_id);
CREATE INDEX idx_ms_rater_user_id           ON monthly_score (rater_user_id);
CREATE INDEX idx_ms_status                  ON monthly_score (status);
-- 质疑超时升级专用索引：仅对 challenged 且已填 challenged_at 的行建索引
CREATE INDEX idx_ms_challenged_at           ON monthly_score (challenged_at)
  WHERE challenged_at IS NOT NULL AND status = 'challenged';
