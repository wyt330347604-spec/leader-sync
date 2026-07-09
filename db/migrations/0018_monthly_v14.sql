-- db/migrations/0018_monthly_v14.sql
-- 月度绩效 V1.4 升级（spec 2026-07-08 performance-review-module §3.2 §4 §10）：
--   单一系数 0–1 → 多维系数制（每维度手写系数×权重，总分=Σ，可 >100，红线一票否决）。
--   monthly_score        加派生汇总列 + 模板盖章 + 红线
--   monthly_score_detail 每维度明细（权重打分时快照，防规则后改影响历史）
-- 完全隔离：旧列 score 保留不动（历史只读，Harvey 已批 §10.5）；无 DB 外键（软引用）。
-- 幂等：全部 IF NOT EXISTS，可重复执行。照 0017 风格。
--
-- 编号接续：现有迁移已推进至 0017，故本次为 0018。

-- monthly_score 新列 ---------------------------------------------------------
-- template_uid：开窗时按被评人 perf_role.is_leader 盖章（monthly_leader/monthly_employee）；
--               NULL = 旧行（单系数历史），前端渲染单值只读、后端拒绝多维提交。
-- total_score/composite/grade：服务端用 domain-core 计算后回写（派生字段）。
-- red_line/red_line_note：红线一票否决（强制 D + 必填说明）。
ALTER TABLE monthly_score
  ADD COLUMN IF NOT EXISTS template_uid   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS total_score    NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS composite      NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS grade          VARCHAR(2),
  ADD COLUMN IF NOT EXISTS red_line       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS red_line_note  TEXT;

CREATE INDEX IF NOT EXISTS idx_ms_template_uid ON monthly_score (template_uid);

-- monthly_score_detail 每维度明细 --------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_score_detail (
  id                BIGSERIAL     PRIMARY KEY,
  detail_uid        VARCHAR(64)   NOT NULL,           -- 业务主键（msd_<...>）
  score_uid         VARCHAR(64)   NOT NULL,           -- 软引用 monthly_score.score_uid
  dimension_code    VARCHAR(32)   NOT NULL,           -- 维度 code（对应模板维度）
  dimension_name    VARCHAR(128),                     -- 维度名快照（展示用）
  weight            NUMERIC(5,2)  NOT NULL,           -- 权重快照（打分时锁定，防规则后改影响历史）
  coefficient       NUMERIC(4,2)  NOT NULL,           -- 手写系数（>0，1.0 以上不封顶，上限防手滑）
  weighted          NUMERIC(6,2)  NOT NULL,           -- = coefficient × weight
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_msd_detail_uid ON monthly_score_detail (detail_uid);
-- (score_uid, dimension_code) 唯一：一行打分每维度只有一条；score_uid 为最左前缀，
-- 同时满足「按打分行查明细」的索引需求。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_msd_score_dimension
  ON monthly_score_detail (score_uid, dimension_code);
