-- 0024: org_cache 离职来源，区分人工/自动，防手动标记被通讯录同步复活
-- left_source: 'manual'=管理员手动标记（永不自动复活）| 'feishu'=同步自动判定（可复活）| NULL=历史行(视同 feishu)
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS left_source varchar(16);
