-- 项目驱动 V2a：事故关联项目（问责闭环）。null=未关联项目。
-- 关联了任务的事故，回填该任务的项目；项目级事故可直接填 related_project_uid。
ALTER TABLE incident
  ADD COLUMN IF NOT EXISTS related_project_uid varchar(64);

CREATE INDEX IF NOT EXISTS idx_incident_project ON incident (related_project_uid);

-- 一次性回填：存量"关联了任务"的事故，带出该任务的项目。
UPDATE incident i
SET related_project_uid = t.project_uid
FROM task t
WHERE i.related_task_uid IS NOT NULL
  AND i.related_project_uid IS NULL
  AND t.task_uid = i.related_task_uid
  AND t.project_uid IS NOT NULL;
