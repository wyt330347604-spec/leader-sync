-- 0023: org_cache 成员生命周期（离职/隐藏），不物理删除
-- left_at: 飞书同步自动判定离职（NULL=在职）
-- hidden_at / hidden_by: 管理员手动隐藏（在职但不入目录，如豁免/双账号）
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS hidden_by varchar(128);

-- 在册查询高频（组织树/人员搜索/花名册）：部分索引覆盖在册行
CREATE INDEX IF NOT EXISTS idx_org_cache_active
  ON org_cache (id) WHERE left_at IS NULL AND hidden_at IS NULL;
