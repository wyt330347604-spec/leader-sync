-- 每用户的任务手动排序偏好（个人视图）。任务为共享实体，排序按用户隔离，不影响他人。
-- 无记录的任务回落到服务端默认排序。新增表，不改动既有数据，安全。
CREATE TABLE IF NOT EXISTS task_user_order (
  id          bigserial PRIMARY KEY,
  user_id     varchar(128) NOT NULL,
  task_uid    varchar(64)  NOT NULL,
  position    double precision NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- 一个用户对同一任务只能有一条排序记录（upsert 依据）。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_user_order_user_task
  ON task_user_order (user_id, task_uid);

-- 按用户拉取排序映射的常见查询。
CREATE INDEX IF NOT EXISTS idx_task_user_order_user
  ON task_user_order (user_id);
