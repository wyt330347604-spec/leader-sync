# 数据库 Schema

> 物理落库主权文档。字段业务语义以 field-dictionary.md 为准，本文件定义可直接建表的完整结构。

## 1. 目标

定义中心主档数据库的完整表结构，用于研发建表、写 migration 和测试数据。

## 2. 核心表

### 2.1 task

主任务表。

```
id                          bigserial       PRIMARY KEY
task_uid                    varchar(64)     NOT NULL UNIQUE
title                       varchar(500)    NOT NULL
title_copy                  varchar(500)
detail                      text
task_type                   varchar(32)     NOT NULL  -- enum: task_type
priority                    varchar(8)      NOT NULL  -- enum: priority
status                      varchar(32)     NOT NULL DEFAULT 'draft'  -- enum: status
progress_percent            int             DEFAULT 0 CHECK (0 <= progress_percent AND progress_percent <= 100)
latest_progress             text

assignee_user_id            varchar(128)    NOT NULL
assignee_name               varchar(128)    NOT NULL
assignee_manager_user_id    varchar(128)
assignee_manager_name       varchar(128)
assignee_dept_id            varchar(128)
assignee_dept_name          varchar(128)
leader_user_id              varchar(128)    NOT NULL
leader_name                 varchar(128)
issuer_user_id              varchar(128)    NOT NULL
issuer_name                 varchar(128)
assigner_user_id            varchar(128)    NOT NULL
assigner_name               varchar(128)
assignment_type             varchar(32)     NOT NULL  -- enum: assignment_type
collaborators               jsonb

start_at                    timestamptz
due_at                      timestamptz     NOT NULL
completed_at                timestamptz
blocked_reason              text
delay_reason                text

days_to_due                 int             -- 服务端计算回写
is_overdue                  bool            DEFAULT false  -- 服务端计算回写
month_bucket                varchar(7)      NOT NULL  -- YYYY-MM
source_month                varchar(7)
is_carried_over             bool            DEFAULT false
carried_from_task_uid       varchar(64)     REFERENCES task(task_uid)
carry_over_count            int             DEFAULT 0       -- 月结递增（与延期解耦）
delay_count                 int             NOT NULL DEFAULT 0  -- 延期次数（每次 POST /delay +1）

monthly_commitment_flag     bool            DEFAULT false
boss_attention_flag         bool            DEFAULT false
monthly_close_locked        bool            DEFAULT false

version                     int             NOT NULL DEFAULT 1 CHECK (version >= 0)
created_at                  timestamptz     NOT NULL DEFAULT now()
updated_at                  timestamptz     NOT NULL DEFAULT now()
created_by                  varchar(128)    NOT NULL
updated_by                  varchar(128)
deleted_at                  timestamptz     -- 软删除
```

### 2.2 task_progress_log

记录每一次状态/进展变化。

```
id                  bigserial       PRIMARY KEY
log_uid             varchar(64)     NOT NULL UNIQUE
task_uid            varchar(64)     NOT NULL REFERENCES task(task_uid)
source_type         varchar(32)     NOT NULL  -- enum: source_type
source_event_id     varchar(256)
operator_user_id    varchar(128)
operator_name       varchar(128)
old_status          varchar(32)
new_status          varchar(32)
progress_delta      int
log_text            text
created_at          timestamptz     NOT NULL DEFAULT now()
```

### 2.3 external_mapping

归一化外部映射表，一个任务对应多行。

```
id                  bigserial       PRIMARY KEY
task_uid            varchar(64)     NOT NULL REFERENCES task(task_uid)
source_type         varchar(32)     NOT NULL  -- bitable / task / calendar
external_object_id  varchar(256)    NOT NULL  -- record_id / task_id / event_id
external_parent_id  varchar(256)              -- app_token+table_id / calendar_id
sync_version        int             NOT NULL DEFAULT 1
last_sync_hash      varchar(128)
last_sync_at        timestamptz
last_sync_source    varchar(32)
sync_status         varchar(32)     NOT NULL DEFAULT 'pending'  -- enum: sync_status
conflict_flag       bool            DEFAULT false
archived_flag       bool            DEFAULT false

UNIQUE (task_uid, source_type)
```

### 2.4 inbound_event

记录所有外部回调事件。

```
id                  bigserial       PRIMARY KEY
source_type         varchar(32)     NOT NULL
source_event_id     varchar(256)    NOT NULL UNIQUE
source_object_id    varchar(256)
occurred_at         timestamptz
trace_id            varchar(128)
payload             jsonb
process_status      varchar(32)     NOT NULL DEFAULT 'pending'
process_result      text
retry_count         int             DEFAULT 0
created_at          timestamptz     NOT NULL DEFAULT now()
```

### 2.5 sync_log

记录所有外部写操作。

```
id                  bigserial       PRIMARY KEY
task_uid            varchar(64)     NOT NULL
source_type         varchar(32)     NOT NULL
direction           varchar(16)     NOT NULL  -- inbound / outbound
sync_status         varchar(32)     NOT NULL
sync_version        int
error_message       text
trace_id            varchar(128)
created_at          timestamptz     NOT NULL DEFAULT now()
```

### 2.6 sync_conflict

记录同步冲突。

```
id                  bigserial       PRIMARY KEY
task_uid            varchar(64)     NOT NULL
field_name          varchar(64)     NOT NULL
local_value         text
remote_value        text
source_type         varchar(32)     NOT NULL
source_event_id     varchar(256)
local_version       int
remote_version      int
resolution_status   varchar(64)     DEFAULT 'unresolved_pending_review'  -- enum: conflict_resolution_status
resolved_by         varchar(128)
resolved_at         timestamptz
resolution_reason   text
created_at          timestamptz     NOT NULL DEFAULT now()
```

### 2.7 monthly_snapshot

按月、按人、按 leader 的统计快照。

```
id                      bigserial       PRIMARY KEY
snapshot_uid            varchar(64)     NOT NULL UNIQUE
snapshot_run_id         varchar(64)     NOT NULL
snapshot_version        int             NOT NULL DEFAULT 1
is_latest               bool            NOT NULL DEFAULT true
snapshot_month          varchar(7)      NOT NULL  -- YYYY-MM
role_scope              varchar(16)     NOT NULL  -- enum: role_scope
owner_user_id           varchar(128)
owner_name              varchar(128)
month_open_count        int             NOT NULL
month_new_count         int             NOT NULL
month_due_count         int             NOT NULL
month_done_count        int             NOT NULL
month_overdue_count     int             NOT NULL
month_carry_over_count  int             NOT NULL
done_rate               decimal(5,4)    NOT NULL
overdue_rate            decimal(5,4)    NOT NULL
generated_at            timestamptz     NOT NULL
created_at              timestamptz     NOT NULL DEFAULT now()
```

### 2.8 user_role_binding

记录用户角色。

```
id                  bigserial       PRIMARY KEY
user_id             varchar(128)    NOT NULL
role                varchar(32)     NOT NULL
created_at          timestamptz     NOT NULL DEFAULT now()
```

### 2.9 org_cache

缓存人员、部门、直属上级等组织信息。

```
id                  bigserial       PRIMARY KEY
user_id             varchar(128)    NOT NULL UNIQUE
user_name           varchar(128)
dept_id             varchar(128)
dept_name           varchar(128)
manager_user_id     varchar(128)
manager_name        varchar(128)
synced_at           timestamptz     NOT NULL DEFAULT now()
```

### 2.10 user_notification_preference

每用户的飞书消息推送偏好。无记录视为默认（全部开启）。

```
id                       bigserial      PRIMARY KEY
user_id                  varchar(128)   NOT NULL UNIQUE
daily_overdue_enabled    boolean        NOT NULL DEFAULT false  -- 每日 10:00 延期任务提醒（默认关闭，需用户主动开启）
weekly_summary_enabled   boolean        NOT NULL DEFAULT true   -- 每周一 9:00 周报（默认开启）
created_at               timestamptz    NOT NULL DEFAULT now()
updated_at               timestamptz    NOT NULL DEFAULT now()
```

> Leader 周报（下属延期数量统计）属于履职信息，不在用户开关范围内，每周一 9:00 强制推送。

## 3. 建议索引

### task
- `uniq_task_uid` ON (task_uid)
- `idx_task_assignee_status` ON (assignee_user_id, status)
- `idx_task_due_at` ON (due_at)
- `idx_task_month_bucket` ON (month_bucket)
- `idx_task_leader_user_id` ON (leader_user_id)
- `idx_task_boss_attention_flag` ON (boss_attention_flag) WHERE boss_attention_flag = true

### external_mapping
- `uniq_task_source` ON (task_uid, source_type)
- `idx_external_object` ON (source_type, external_object_id)

### inbound_event
- `uniq_source_event_id` ON (source_event_id)
- `idx_source_type_occurred_at` ON (source_type, occurred_at)

### sync_log
- `idx_task_uid_created_at` ON (task_uid, created_at)
- `idx_sync_status` ON (sync_status)

### monthly_snapshot
- `idx_snapshot_month_scope` ON (snapshot_month, role_scope)
- `idx_snapshot_latest` ON (snapshot_month, role_scope, owner_user_id) WHERE is_latest = true

## 4. 约束建议

- `task_uid` 唯一
- `version` 非负
- `progress_percent` 范围 0-100
- `month_bucket` 格式固定为 `YYYY-MM`
- `assignment_type` 必须在枚举内

## 5. Migration 原则

- 禁止直接改线上表结构而不写 migration
- 需要数据回填的 schema 变更必须附带 backfill 脚本
- 破坏性变更必须先灰度、再切换、再删除旧字段
