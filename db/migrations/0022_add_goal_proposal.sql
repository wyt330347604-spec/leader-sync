-- db/migrations/0022_add_goal_proposal.sql
-- 绩效 P4b（spec 2026-07-08 performance-review-module §6 /me/goals、§10.4）：
--   半年目标「双方发起调整、直属确认留痕」最小提案流。
--   员工在 quarter_goal 上挂一条待确认提案（proposed_content/by/at）；
--   直属确认（接受→应用为正式内容并写 quarter_goal_revision / 驳回→关提案并留痕）。
--   pending 提案存在 iff proposed_at IS NOT NULL。
-- 完全隔离：仅加列，不改现有行为；无 DB 外键（软引用）。
-- 幂等：ADD COLUMN IF NOT EXISTS，可重复执行。照 0021 风格。
--
-- 编号接续：现有迁移已推进至 0021，故本次为 0022。

ALTER TABLE quarter_goal
  ADD COLUMN IF NOT EXISTS proposed_content TEXT,
  ADD COLUMN IF NOT EXISTS proposed_by      VARCHAR(128),
  ADD COLUMN IF NOT EXISTS proposed_at      TIMESTAMPTZ;
