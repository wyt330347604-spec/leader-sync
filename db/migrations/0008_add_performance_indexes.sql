-- db/migrations/0008_add_performance_indexes.sql
-- 看板模块所需性能索引：idx_task_created_at + idx_task_month_bucket（已存在则跳过）
-- 依据：task-completion-dashboard.md §5.1（Q2 已确认，选项 A）
-- 不修改任何表结构，只建索引

-- 周度看板 GET /dashboard/leader/weekly 使用 created_at >= thisMonday 过滤
-- 现有 idx_task_due_at 不覆盖 created_at，需单独索引
CREATE INDEX IF NOT EXISTS idx_task_created_at
  ON task (created_at);

-- 月份桶索引：多个看板端点按 month_bucket 过滤（现有 task 表建表时未显式加此索引）
-- IF NOT EXISTS 保证幂等，防止重复执行 migration 报错
CREATE INDEX IF NOT EXISTS idx_task_month_bucket
  ON task (month_bucket);
