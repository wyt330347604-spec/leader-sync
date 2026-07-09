-- db/migrations/0020_add_quarter_result.sql
-- 季度评分会 + 结果合成/公示/申诉 P3（spec 2026-07-08 performance-review-module §3.3 §4 §5 §6 §8 §10）：
--   quarter_result           某被评人一季一条合成结果（三方分解 + total/grade + 留痕）
--   quarter_result_revision  评分会改分留痕（谁改、改了哪个字段、为什么）
--   quarter_appeal           公示后申诉（本人提交、hr/admin 处理）
-- 完全隔离：新表，不改现有表行为，无 DB 外键（软引用）。
-- 幂等：全部 IF NOT EXISTS，可重复执行。照 0017/0018/0019 风格。
--
-- 编号接续：现有迁移已推进至 0019，故本次为 0020。

-- quarter_result -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_result (
  id                 BIGSERIAL     PRIMARY KEY,
  result_uid         VARCHAR(64)   NOT NULL,        -- qr_<hex>
  cycle_uid          VARCHAR(64)   NOT NULL,
  task_uid           VARCHAR(64)   NOT NULL,        -- 一任务一结果（唯一）
  ratee_user_id      VARCHAR(128)  NOT NULL,
  ratee_name         VARCHAR(128),
  sheet_type         VARCHAR(16),                   -- employee|leader（冗余，便于 panel 展示）
  goal_score         NUMERIC(6,2),                  -- 目标达成/团队结果（manager sheet）
  manager_soft       NUMERIC(6,2),                  -- 直属软项合计
  peer_soft          NUMERIC(6,2),                  -- 同事软项合计
  mgmt_avg           NUMERIC(6,2),                  -- 管理层软项均值（无 mgmt / 全排除 → NULL）
  soft_merged        NUMERIC(6,2),                  -- 三方合成软项
  total              NUMERIC(6,2),                  -- goal_score + soft_merged
  grade              VARCHAR(2),                    -- S|A|B|C|D
  red_line           BOOLEAN       NOT NULL DEFAULT false,
  red_line_note      TEXT,
  weights_used       JSONB,                         -- {manager,mgmt?,peer}（domain-core mergeSoft 留痕）
  mgmt_raters        JSONB,                         -- {rule, excludedIds, raterIds, scores:[{raterId,raterName,soft}]}
  status             VARCHAR(16)   NOT NULL DEFAULT 'draft',  -- draft|published|closed
  published_at       TIMESTAMPTZ,
  appeal_deadline_at TIMESTAMPTZ,                   -- 公示 + 3 个工作日
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_result_uid       ON quarter_result (result_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_result_task      ON quarter_result (task_uid);
CREATE INDEX        IF NOT EXISTS idx_quarter_result_cycle      ON quarter_result (cycle_uid);
CREATE INDEX        IF NOT EXISTS idx_quarter_result_ratee      ON quarter_result (ratee_user_id);

-- quarter_result_revision ----------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_result_revision (
  id            BIGSERIAL     PRIMARY KEY,
  revision_uid  VARCHAR(64)   NOT NULL,        -- qrr_<hex>
  result_uid    VARCHAR(64)   NOT NULL,
  field         VARCHAR(32)   NOT NULL,        -- goal_score|soft_merged|total|grade
  before        TEXT,
  after         TEXT,
  reason        TEXT          NOT NULL,        -- 评分会改分必填
  revised_by    VARCHAR(128),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_result_revision_uid ON quarter_result_revision (revision_uid);
CREATE INDEX        IF NOT EXISTS idx_quarter_result_revision_res  ON quarter_result_revision (result_uid);

-- quarter_appeal -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarter_appeal (
  id            BIGSERIAL     PRIMARY KEY,
  appeal_uid    VARCHAR(64)   NOT NULL,        -- qap_<hex>
  result_uid    VARCHAR(64)   NOT NULL,
  ratee_user_id VARCHAR(128)  NOT NULL,
  content       TEXT,
  status        VARCHAR(16)   NOT NULL DEFAULT 'open',  -- open|resolved|rejected
  handler       VARCHAR(128),
  resolution    TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_appeal_uid   ON quarter_appeal (appeal_uid);
CREATE INDEX        IF NOT EXISTS idx_quarter_appeal_result ON quarter_appeal (result_uid);
CREATE INDEX        IF NOT EXISTS idx_quarter_appeal_ratee  ON quarter_appeal (ratee_user_id);
-- 每个 result 至多一条 open 申诉（DB 级兜底，与 service 校验一致）。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_quarter_appeal_open_per_result
  ON quarter_appeal (result_uid) WHERE status = 'open';
