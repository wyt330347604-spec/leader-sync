-- 项目驱动 V0：项目自关联（子项目）。null=顶级项目，非空=子项目。限两级（应用层约束）。
-- 新增可空列，不改动存量数据，安全。
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS parent_project_uid varchar(64);

-- 按父项目查子项目的常见查询。
CREATE INDEX IF NOT EXISTS idx_project_parent
  ON project (parent_project_uid);
