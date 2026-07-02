-- 绩效豁免标记（2026-07-02 用户决策：Albern@China / 陈明 / 李星 不参与绩效评分；
-- DFW曙条 为独立子公司，无任务快照自然不参与，不需标记）。
-- score-window 生成打分草稿时跳过 score_exempt=true 的被评人。
ALTER TABLE org_cache
  ADD COLUMN IF NOT EXISTS score_exempt boolean NOT NULL DEFAULT false;
