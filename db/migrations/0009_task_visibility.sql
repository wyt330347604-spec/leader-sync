-- 任务可见性：public=公司共享（计入统计/同步多维表格）；private=个人仅创建者可见（不计入统计/不同步）
-- 存量任务回填 public（默认行为不变）。
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS visibility varchar(16) NOT NULL DEFAULT 'public';

-- 部分索引：私有任务按创建者过滤的常见查询（个人 to-do 视图）
CREATE INDEX IF NOT EXISTS idx_task_visibility_created_by
  ON task (created_by)
  WHERE visibility = 'private';
