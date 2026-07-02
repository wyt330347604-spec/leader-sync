-- 组织架构：manager 字段来源标记 + 审计（2026-07-02 spec: monthly-score-org-sync）
-- manager_user_id 保持唯一有效值（effective manager），消费方（月结 Step 6 打分 rater）零改动。
-- manager_source: 'feishu' = 通讯录同步写入（默认）| 'manual' = 组织架构图人工调整。
-- 飞书同步跳过 manual 行（人工 override 优先，重复同步不覆盖）。
-- 新增列均带默认/可空，存量行安全。
ALTER TABLE org_cache
  ADD COLUMN IF NOT EXISTS manager_source varchar(16) NOT NULL DEFAULT 'feishu';

ALTER TABLE org_cache
  ADD COLUMN IF NOT EXISTS manager_updated_at timestamptz;

ALTER TABLE org_cache
  ADD COLUMN IF NOT EXISTS manager_updated_by varchar(128);
