-- 项目驱动 R1：需求轴。需求 = 提出人发起、PM 收口、拆成任务执行的最小价值单元。
-- 挂业务线(顶级 project) 或 app(子 project)；任务从需求拆出。事故独立(不算需求)。

CREATE TABLE IF NOT EXISTS requirement (
  id                    bigserial PRIMARY KEY,
  requirement_uid       varchar(64) NOT NULL,
  title                 varchar(500) NOT NULL,
  value                 text,
  description           text,
  business_line_uid     varchar(64) NOT NULL,
  app_project_uid       varchar(64),
  source                varchar(16) NOT NULL DEFAULT 'biz',
  priority              varchar(8)  NOT NULL DEFAULT 'P2',
  status                varchar(32) NOT NULL DEFAULT 'collected',
  target_version        varchar(32),
  reporter_user_id      varchar(128) NOT NULL,
  reporter_name         varchar(128) NOT NULL,
  pm_user_id            varchar(128),
  pm_name               varchar(128),
  acceptor_user_id      varchar(128),
  acceptor_name         varchar(128),
  expected_release_date date,
  est_effort_days       numeric(5,1),
  company_id            varchar(64) NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            varchar(128) NOT NULL,
  updated_by            varchar(128),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_requirement_uid ON requirement (requirement_uid);
CREATE INDEX IF NOT EXISTS idx_requirement_business_line ON requirement (business_line_uid);
CREATE INDEX IF NOT EXISTS idx_requirement_app ON requirement (app_project_uid);
CREATE INDEX IF NOT EXISTS idx_requirement_status ON requirement (status);
CREATE INDEX IF NOT EXISTS idx_requirement_pm ON requirement (pm_user_id);

CREATE TABLE IF NOT EXISTS requirement_artifact (
  id               bigserial PRIMARY KEY,
  requirement_uid  varchar(64) NOT NULL,
  type             varchar(32) NOT NULL,
  title            varchar(256) NOT NULL,
  url              varchar(1024),
  created_by       varchar(128) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_req_artifact_req ON requirement_artifact (requirement_uid);

-- 任务挂需求 + 工时/投入度（R2 容量用）
ALTER TABLE task ADD COLUMN IF NOT EXISTS requirement_uid varchar(64);
ALTER TABLE task ADD COLUMN IF NOT EXISTS est_effort_days numeric(5,1);
ALTER TABLE task ADD COLUMN IF NOT EXISTS allocation_pct integer;
CREATE INDEX IF NOT EXISTS idx_task_requirement ON task (requirement_uid);
