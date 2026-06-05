-- 项目驱动 V1d：项目 PIC（负责人，真实用户 open_id/user_id，可过滤/追责）。
-- ownerName 仍保留为自由文本展示名。新增可空列，安全。
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS pic_user_id varchar(128);

CREATE INDEX IF NOT EXISTS idx_project_pic ON project (pic_user_id);
