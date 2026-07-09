# 字段字典

## 1. 说明

本项目采用"中心主档 + 外部投影"设计。
字段字典定义以下内容：

- 字段唯一 key
- 中文名
- 类型
- 是否必填（分为用户提交必填 / 系统落库必填）
- 主权来源
- 可编辑入口
- 与现有多维表格字段映射
- 字段说明

### 必填分层说明

- **A. 用户提交必填**：创建任务时用户必须提供
- **B. 系统落库必填**：系统自动填充或推导，落库时不可为空

## 2. 任务主表 `task`

| key | 中文名 | 现有表字段 | 类型 | 必填 | 主权来源 | 可编辑入口 | 说明 |
|---|---|---|---|---|---|---|---|
| task_uid | 任务唯一ID | 新增 | string | B | system | system | 全局唯一主键 |
| title | 任务标题 | A-待办事项 | string | A | system/bitable | bitable/web | 任务主标题 |
| title_copy | 标题副本 | A=待办事项副本 | string | 否 | system | system | 兼容旧表，后续可废弃 |
| detail | 任务详情 | AE任务详情 | text | 否 | system/bitable | bitable/web/card | 长文本详情 |
| task_type | 任务类型 | 任务类型 | enum | A | system | bitable/web | strategy/operation/project/report/meeting/collaboration/follow_up/other |
| priority | 重要紧急程度 | 重要紧急程度 | enum | A | system | bitable/web | p0/p1/p2/p3 |
| assignee_user_id | 负责人ID | 任务负责人 | string | A | system | bitable/web | 飞书 user_id/open_id |
| assignee_name | 负责人姓名 | 任务负责人 | string | B | system | system | 展示字段 |
| assignee_manager_user_id | 直属上级ID | 任务负责人.直属上级 | string | 否 | system | system | 组织关系映射 |
| assignee_manager_name | 直属上级 | 任务负责人.直属上级 | string | 否 | system | system | 展示字段 |
| assignee_dept_id | 部门ID | 任务负责人.部门 | string | 否 | system | system | 组织关系映射 |
| assignee_dept_name | 部门 | 任务负责人.部门 | string | 否 | system | system | 展示字段 |
| leader_user_id | 归属Leader ID | 新增 | string | B | system | system | 用于老板视角汇总 |
| leader_name | 归属Leader | 新增 | string | 否 | system | system | 展示字段 |
| issuer_user_id | 发起人ID | 新增 | string | B | system | bitable/web | 谁提出任务 |
| issuer_name | 发起人姓名 | 新增 | string | 否 | system | system | 展示字段 |
| assigner_user_id | 指派人ID | 新增 | string | B | system | bitable/web | 当前负责人由谁分配 |
| assigner_name | 指派人姓名 | 新增 | string | 否 | system | system | 展示字段 |
| assignment_type | 指派关系类型 | 新增 | enum | B | system | bitable/web | boss_assign/manager_assign/... |
| collaborators | 协作者 | 新增 | json/list | 否 | system | web | 协同人列表（一期不做外部双向同步） |
| status | 生命周期状态 | 进展 | enum | B | dual | bitable/web/task/card | 任务状态 |
| progress_percent | 进度百分比 | 新增 | int | 否 | dual | bitable/web/task | 0~100 |
| latest_progress | 最新进展 | A-最新进展记录 | text | 否 | dual | bitable/web/card/task | 最新摘要 |
| start_at | 开始时间 | 开始日期 | timestamptz | 否 | dual | bitable/web/task/calendar | 开始时间（绑定日历的任务允许日历侧回写） |
| due_at | 预计完成时间 | 预计完成日期 | timestamptz | A | dual | bitable/web/task/calendar | 计划完成时间 |
| completed_at | 实际完成时间 | 实际完成日期 | timestamptz | 否 | dual | bitable/web/task | 完成时间 |
| blocked_reason | 阻塞原因 | 新增 | text | 否 | dual | web/card | 阻塞时填写 |
| delay_reason | 延期原因 | 新增 | text | 否 | dual | web/card | 延期时填写 |
| days_to_due | 剩余天数 | 剩余天数 | int | 否 | system | system | 服务端计算回写；任务完成/搁置/归档时清空（NULL）；改 due_at / 延期时实时重算；overdue-reminder 作业每日 10:00 兜底 |
| is_overdue | 是否延期 | 是否延期 | bool | 否 | system | system | 服务端计算回写；任务完成/搁置/归档时立即重置为 false；改 due_at / 延期时按新 due_at 实时重算；overdue-reminder 作业每日 10:00 兜底 |
| overdue_notified_leader_at | leader 已通知时间 | 新增 | timestamptz | 否 | system | system | 历史字段（曾用于"首次延期通知 leader"逻辑）。当前 leader 提醒已改为每周一 9:00 聚合周报，此字段不再被新逻辑写入，但保留以备回滚 |
| user_notification_preference.daily_overdue_enabled | 每日延期提醒开关 | 新增 | bool | 否 | user | web | 用户在 /settings/notifications 自助管理；缺失记录视为 false（默认关闭，需用户主动开启） |
| user_notification_preference.weekly_summary_enabled | 周报开关 | 新增 | bool | 否 | user | web | 同上；缺失记录视为 true（默认开启） |
| month_bucket | 当前归属月份 | 新增 | string | B | system | system/web | 格式 YYYY-MM |
| source_month | 来源月份 | 新增 | string | 否 | system | system | 最早来源月份 |
| is_carried_over | 是否继承 | 新增 | bool | 否 | system | system | 月结生成 |
| carried_from_task_uid | 继承来源任务ID | 新增 | string | 否 | system | system | 关联上月任务（继承时新建记录，此字段指向原任务） |
| carry_over_count | 继承次数 | 新增 | int | 否 | system | system | 月结 worker 月初 +1，仅记录"自然月跨越"，与延期无关 |
| delay_count | 延期次数 | 新增 | int | 否 | system | system | 每次调用 POST /tasks/:uid/delay 时 +1，与 carry_over_count 互不干扰；UI ≥3 次显示警示 |
| monthly_commitment_flag | 本月承诺完成 | 新增 | bool | 否 | system | bitable/web | leader 承诺项 |
| boss_attention_flag | 老板关注 | 新增 | bool | 否 | 管理标记 | boss/pmo | 管理标记字段，仅限老板/PMO 编辑，不属于普通业务字段 |
| monthly_close_locked | 月结锁定 | 新增 | bool | 否 | system | system | 上月快照锁定标记 |
| created_at | 创建时间 | 新增 | timestamptz | B | system | system | 审计字段 |
| updated_at | 更新时间 | 新增 | timestamptz | B | system | system | 审计字段 |
| created_by | 创建人 | 新增 | string | B | system | system | 审计字段 |
| updated_by | 更新人 | 新增 | string | 否 | system | system | 审计字段 |
| version | 版本号 | 新增 | int | B | system | system | 乐观锁 |

## 3. 外部映射表 `external_mapping`

采用归一化设计，一个任务对应多行（每个外部系统一行）。

| key | 中文名 | 类型 | 必填 | 主权来源 | 说明 |
|---|---|---|---|---|---|
| id | 主键 | bigint | 是 | system | 自增主键 |
| task_uid | 任务ID | string | 是 | system | 关联任务 |
| source_type | 外部系统类型 | enum | 是 | system | bitable/task/calendar |
| external_object_id | 外部对象ID | string | 是 | system | 如 bitable_record_id / feishu_task_id / calendar_event_id |
| external_parent_id | 外部父级ID | string | 否 | system | 如 bitable_app_token + table_id / calendar_id |
| sync_version | 同步版本号 | int | 是 | system | 用于幂等/回放 |
| last_sync_hash | 同步内容摘要 | string | 否 | system | 防循环 |
| last_sync_at | 最近同步时间 | timestamptz | 否 | system | 审计字段 |
| last_sync_source | 最近同步来源 | enum | 否 | system | 最近一次写入来源 |
| sync_status | 同步状态 | enum | 是 | system | 见 enum-dictionary sync_status |
| conflict_flag | 冲突标记 | bool | 否 | system | 是否冲突 |
| archived_flag | 已归档 | bool | 否 | system | 历史归档 |

## 4. 进展日志表 `task_progress_log`

| key | 中文名 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| log_uid | 日志ID | string | 是 | 主键 |
| task_uid | 任务ID | string | 是 | 外键 |
| source_type | 来源 | enum | 是 | bitable/task/calendar/card/api/system |
| source_event_id | 外部事件ID | string | 否 | 幂等依据 |
| operator_user_id | 操作人ID | string | 否 | 谁改的 |
| operator_name | 操作人姓名 | string | 否 | 展示字段 |
| old_status | 旧状态 | enum | 否 | 状态变化前 |
| new_status | 新状态 | enum | 否 | 状态变化后 |
| progress_delta | 进度变化 | int | 否 | 数值变化 |
| log_text | 进展内容 | text | 否 | 进展文本 |
| created_at | 创建时间 | timestamptz | 是 | 审计字段 |

## 5. 月快照表 `monthly_snapshot`

| key | 中文名 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| snapshot_uid | 快照ID | string | 是 | 主键 |
| snapshot_run_id | 运行批次ID | string | 是 | 区分首次运行和重跑 |
| snapshot_version | 快照版本 | int | 是 | 同一月份重跑时递增 |
| is_latest | 是否最新 | bool | 是 | 最新成功结果标记 |
| snapshot_month | 快照月份 | string | 是 | YYYY-MM |
| role_scope | 统计范围 | enum | 是 | employee/leader/company |
| owner_user_id | 统计主体用户ID | string | 否 | 员工或 leader |
| owner_name | 统计主体姓名 | string | 否 | 展示字段 |
| month_open_count | 月初在手 | int | 是 | 统计 |
| month_new_count | 本月新增 | int | 是 | 统计 |
| month_due_count | 本月应完成 | int | 是 | due_at 落在本月且未取消的任务数 |
| month_done_count | 本月完成 | int | 是 | 统计 |
| month_overdue_count | 本月延期未完成 | int | 是 | 统计 |
| month_carry_over_count | 继承到下月 | int | 是 | 统计 |
| done_rate | 完成率 | decimal | 是 | month_done_count / month_due_count |
| overdue_rate | 延期率 | decimal | 是 | month_overdue_count / month_due_count |
| generated_at | 生成时间 | timestamptz | 是 | 本次运行的实际生成时间 |
| created_at | 创建时间 | timestamptz | 是 | 审计字段 |

## 6. 说明

### 6.1 派生字段
以下字段只允许系统计算和回写：
- days_to_due
- is_overdue
- carry_over_count
- month-related snapshot metrics

### 6.2 双向字段
以下字段允许多入口更新，但必须走同步规则：
- status
- progress_percent
- latest_progress
- due_at
- completed_at
- blocked_reason
- delay_reason

### 6.3 时间承诺字段
以下字段允许双向更新，日历侧对已绑定日历事件的任务具有较高主权：
- start_at
- due_at

### 6.4 管理标记字段
以下字段仅限老板/PMO 编辑，不属于普通业务结构字段：
- boss_attention_flag

## project 表 — 2026-05 新增字段

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `category` | `project.category` | `varchar(8)` enum | 否 | 业务板块（`jt`/`zy`/`fw`/`tz`/`hz`） | 手填 |
| `ownerName` | `project.owner_name` | `varchar(64)` | 否 | 项目负责人显示名（自由文本，未来再升级飞书 user_id 关系） | 手填 |
| `region` | `project.region` | `varchar(32)` enum | 否 | 项目所在国家/地区 | 手填 |
| `subtitle` | `project.subtitle` | `varchar(64)` | 否 | 项目副标签（"NBFC × 2"、"联合负责" 等） | 手填 |

## task_user_order 表 — 2026-06 新增（每用户任务手动排序）

个人视图排序偏好，**按用户隔离**，仅影响该用户自己的「我的任务」列表（任务为共享实体，排序不影响他人）。无记录的任务回落服务端默认排序。Migration `0010_task_user_order.sql`。

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `userId` | `task_user_order.user_id` | `varchar(128)` | 是 | 排序归属用户 | 系统 |
| `taskUid` | `task_user_order.task_uid` | `varchar(64)` | 是 | 任务 UID | 系统 |
| `position` | `task_user_order.position` | `double precision` | 是 | 组内排序位（拖拽落定按下标 0,1,2… upsert） | 拖拽 |
| `updatedAt` | `task_user_order.updated_at` | `timestamptz` | 是 | 最后排序时间 | 系统 |

唯一约束 `uniq_task_user_order_user_task (user_id, task_uid)` 作为 upsert 依据。写入端点：`PUT /api/v1/me/tasks/order { task_uids[] }`。

## org_cache 表 — 2026-07 新增 manager 来源/审计字段

上下级关系（打分 rater 的唯一来源）。`manager_user_id` 是唯一有效值（effective manager），消费方（月结 Step 6 / score-window）只读该字段；`manager_source` 仅供写入侧仲裁：飞书通讯录同步**跳过** `manual` 行，组织架构图人工调整写 `manual`。Migration `0015_org_manager_source.sql`。Spec: `docs/superpowers/specs/2026-07-02-monthly-score-org-sync.md`。

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `managerUserId` | `org_cache.manager_user_id` | `varchar(128)` | 否 | 直属上级（打分 rater），统一存 `ou_` open_id | 通讯录同步 / 组织架构图 |
| `managerName` | `org_cache.manager_name` | `varchar(128)` | 否 | 上级显示名（冗余展示用） | 同上 |
| `managerSource` | `org_cache.manager_source` | `varchar(16)` enum | 是(默认 feishu) | manager 写入来源：`feishu`/`manual` | 系统 |
| `managerUpdatedAt` | `org_cache.manager_updated_at` | `timestamptz` | 否 | manager 最后变更时间（审计） | 系统 |
| `managerUpdatedBy` | `org_cache.manager_updated_by` | `varchar(128)` | 否 | 变更操作人（`system:sync` 或用户 user_id） | 系统 |

org_cache 补充（2026-07-02，migration 0016）：

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `scoreExempt` | `org_cache.score_exempt` | `boolean` | 是(默认 false) | 绩效豁免：true=不参与月度绩效（score-window 不生成其打分草稿）。当前豁免：Albern@China/陈明/李星 | 手动 SQL/后续组织架构页 |

## 绩效模块 P0 — 2026-07-08 新增表（migration 0017_add_perf_foundation）

Spec：`docs/superpowers/specs/2026-07-08-performance-review-module.md`（§2 §3）。四张新表 + `org_cache.joined_at` 新列；均软引用、无 DB 外键。

### perf_role 表（绩效打分身份，来自飞书群同步，非 RBAC）

worker job `sync-perf-roles`（每日 07:10）全量对账：在群→置位，不在群→置 false。`is_leader`/`is_management` 决定用哪版打分表、是否进管理层评分；与 `user_role_binding`（应用 RBAC）两套不混。

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `userId` | `perf_role.user_id` | `varchar(128)` | 是(唯一) | 软引用 org_cache.user_id（一人一行） | 群同步 |
| `openId` | `perf_role.open_id` | `varchar(128)` | 否 | 飞书 open_id（群成员 member_id） | 群同步 |
| `isLeader` | `perf_role.is_leader` | `boolean` | 是(默认 false) | 是否 leader 群成员 | 群同步 |
| `isManagement` | `perf_role.is_management` | `boolean` | 是(默认 false) | 是否管理层群成员 | 群同步 |
| `sourceChatIds` | `perf_role.source_chat_ids` | `jsonb`(string[]) | 否 | 身份来源群 id（留痕） | 群同步 |
| `syncedAt` | `perf_role.synced_at` | `timestamptz` | 是(默认 now) | 最后同步时间 | 系统 |
| `createdAt` | `perf_role.created_at` | `timestamptz` | 是(默认 now) | 审计字段 | 系统 |

唯一约束 `uniq_perf_role_user_id (user_id)` 作群同步 upsert 依据。

### feishu_department 表（飞书组织架构部门树）

worker job `sync-departments`（每日 07:05）递归 upsert。用途：季度管理层评分「关联的一级部门 leader 除外」规则（沿 parent 链走到根的下一层即被评人一级部门，排除其 `leader_user_id`）。

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `deptId` | `feishu_department.dept_id` | `varchar(128)` | 是(主键) | 飞书 open_department_id | 通讯录同步 |
| `parentDeptId` | `feishu_department.parent_dept_id` | `varchar(128)` | 否 | 上级部门 id（根为 `'0'`） | 通讯录同步 |
| `name` | `feishu_department.name` | `varchar(256)` | 否 | 部门名 | 通讯录同步 |
| `leaderUserId` | `feishu_department.leader_user_id` | `varchar(128)` | 否 | 部门负责人 open_id（软引用） | 通讯录同步 |
| `level` | `feishu_department.level` | `integer` | 是(默认 0) | 层级：根=0，根的直接子=1，依次递增 | 系统计算 |
| `syncedAt` | `feishu_department.synced_at` | `timestamptz` | 是(默认 now) | 最后同步时间 | 系统 |

索引 `idx_feishu_department_parent (parent_dept_id)`。

### score_template 表（打分规则模板，规则进库不写死）

四份定稿模板（月度员工/leader、季度员工/leader）。`seed:perf` 幂等灌入（`db/seed/perf-templates.ts` + `perf-template-data.ts`）。

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `templateUid` | `score_template.template_uid` | `varchar(64)` | 是(唯一) | 业务主键（`spt_<code>`） | seed |
| `code` | `score_template.code` | `varchar(32)` enum | 是(唯一) | 见 enum-dictionary `score_template_code` | seed |
| `version` | `score_template.version` | `integer` | 是(默认 1) | 版本号 | seed |
| `active` | `score_template.active` | `boolean` | 是(默认 true) | 是否启用 | seed |
| `gradeBands` | `score_template.grade_bands` | `jsonb` | 是 | 评级档 `[{grade,min,minInclusive,label,display}]`（月度 S>100 / 季度 S≥90，可改数据不改代码） | seed |
| `goalWeight` | `score_template.goal_weight` | `integer` | 否 | 季度目标达成/团队结果分值（员工 45 / leader 40）；月度为 NULL | seed |
| `createdAt` | `score_template.created_at` | `timestamptz` | 是(默认 now) | 审计字段 | 系统 |
| `updatedAt` | `score_template.updated_at` | `timestamptz` | 是(默认 now) | 审计字段 | 系统 |

### score_dimension 表（模板维度 + 档位锚定）

每模板下的打分维度；`anchors` 档位说明为定稿原文照录。月度员工 2 维、月度 leader 3 维、季度员工 4 维、季度 leader 5 维（共 14 维度）。

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `dimensionUid` | `score_dimension.dimension_uid` | `varchar(64)` | 是(唯一) | 业务主键（`spd_<code>_<dim>`） | seed |
| `templateUid` | `score_dimension.template_uid` | `varchar(64)` | 是 | 反向引用 score_template.template_uid（软引用） | seed |
| `code` | `score_dimension.code` | `varchar(32)` | 是 | 维度 code（workload/delivery/expertise/planning…） | seed |
| `name` | `score_dimension.name` | `varchar(128)` | 是 | 维度名（原文） | seed |
| `description` | `score_dimension.description` | `text` | 否 | 维度说明（原文） | seed |
| `weight` | `score_dimension.weight` | `numeric(5,2)` | 是 | 权重（月度合计 100；季度软项合计 员工55/leader60） | seed |
| `sort` | `score_dimension.sort` | `integer` | 是(默认 0) | 展示排序 | seed |
| `scale` | `score_dimension.scale` | `varchar(16)` enum | 是 | 见 enum-dictionary `score_dimension_scale` | seed |
| `anchors` | `score_dimension.anchors` | `jsonb` | 是 | 档位锚定 `[{grade,range,desc}]`（desc 定稿原文，不改写） | seed |
| `createdAt` | `score_dimension.created_at` | `timestamptz` | 是(默认 now) | 审计字段 | 系统 |

唯一约束 `uniq_score_dimension_template_code (template_uid, code)` 作 seed upsert 依据，最左前缀兼作「按模板查维度」索引。

### org_cache 补充（2026-07-08，migration 0017）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `joinedAt` | `org_cache.joined_at` | `timestamptz` | 否 | 入职日期：季度新人规则（周期内 ≥2 完整月才参评）。飞书通讯录 `join_time` 同步（sync-departments），拉不到时 HR 手补。sync-engine 不写此字段 | 通讯录同步 / 手动 |

## 绩效模块 P1 — 月度 V1.4（2026-07-08，migration 0018_monthly_v14）

月度打分从「单一系数 0–1」升级为多维系数制：每维度手写系数 × 权重，总分 = Σ（可 >100），红线一票否决。计分数学一律由 `packages/domain-core/src/perf-scoring.ts`（`monthlyTotal`/`monthlyGrade`）计算并回写。

### monthly_score 新增列

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `templateUid` | `monthly_score.template_uid` | `varchar(64)` | 否 | 打分模板（软引用 score_template.template_uid）。开窗时按被评人 `perf_role.is_leader` 盖章（monthly_leader / monthly_employee 的 active 模板）；**NULL = 旧单系数历史行**（前端只读、后端拒绝多维提交） | 开窗盖章（score-window） |
| `totalScore` | `monthly_score.total_score` | `numeric(5,1)` | 否 | 总分 = Σ(系数×权重)，可 >100。服务端派生 | 服务端计算 |
| `composite` | `monthly_score.composite` | `numeric(4,2)` | 否 | 综合系数 = total_score / 100（挂激励）。服务端派生 | 服务端计算 |
| `grade` | `monthly_score.grade` | `varchar(2)` | 否 | 自动评级 S/A/B/C/D（S>100 / A 90–100 / B 80–89 / C 70–79 / D<70；红线强制 D）。服务端派生 | 服务端计算 |
| `redLine` | `monthly_score.red_line` | `boolean` | 是(默认 false) | 红线一票否决：true → 强制 D + 建议开除 + 通知 boss/hr | 打分人 |
| `redLineNote` | `monthly_score.red_line_note` | `text` | 否 | 红线说明（red_line=true 时必填） | 打分人 |

> 旧列 `score`（`numeric(3,1)`，0–1 单系数）保留不动，冻结为历史只读（Harvey 2026-07-08 §10.5）。无 template_uid 的行继续用此列；有 template_uid 的新行改用 total_score/composite/grade + monthly_score_detail。

### monthly_score_detail 表（每维度明细）

一条打分行（monthly_score）在 V1.4 下按模板维度拆成多条明细。`weight` 为打分时的**权重快照**（防模板规则后改影响历史）。

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `detailUid` | `monthly_score_detail.detail_uid` | `varchar(64)` | 是(唯一) | 业务主键（`msd_<nanoid>`） | 服务端 |
| `scoreUid` | `monthly_score_detail.score_uid` | `varchar(64)` | 是 | 软引用 monthly_score.score_uid | 服务端 |
| `dimensionCode` | `monthly_score_detail.dimension_code` | `varchar(32)` | 是 | 维度 code（对应模板维度） | 打分人 |
| `dimensionName` | `monthly_score_detail.dimension_name` | `varchar(128)` | 否 | 维度名快照（展示用） | 模板快照 |
| `weight` | `monthly_score_detail.weight` | `numeric(5,2)` | 是 | 权重快照（打分时锁定） | 模板快照 |
| `coefficient` | `monthly_score_detail.coefficient` | `numeric(4,2)` | 是 | 手写系数（>0 且 ≤5，上限防手滑；1.0 以上不封顶） | 打分人 |
| `weighted` | `monthly_score_detail.weighted` | `numeric(6,2)` | 是 | = coefficient × weight | 服务端计算 |
| `createdAt` | `monthly_score_detail.created_at` | `timestamptz` | 是(默认 now) | 审计字段 | 系统 |

唯一约束 `uniq_msd_score_dimension (score_uid, dimension_code)`：一行每维度一条；score_uid 最左前缀兼作「按打分行查明细」索引。另 `uniq_msd_detail_uid (detail_uid)`。

## 绩效模块 P2 — 季度考核（2026-07-09，migration 0019_add_quarter_review）

季度考核核心流：一季一周期（`quarter_cycle`），开窗对全员生成任务（`quarter_task`）+ 四类打分表（`quarter_sheet`：self/manager/peer/management），每维度明细进 `quarter_sheet_item`。串行门控见 state-machine.md §8。计分一律由 `packages/domain-core`（`quarterlyDimScore`/`softSum` 等）计算。全部软引用，无 DB 外键。

### quarter_cycle（季度周期）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `cycleUid` | `cycle_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qc_<nanoid>` |
| `quarter` | `quarter` | `varchar(16)` | 是(唯一) | `'YYYY-QN'` |
| `status` | `status` | `varchar(16)` | 是(默认 scoring) | goal_check/scoring/panel/published/closed（enum-dictionary） |
| `openAt` `deadlineAt` `panelAt` `publishedAt` | 同名 | `timestamptz` | 否 | 开窗/总截止/评分会/公示时刻 |
| `createdAt` | `created_at` | `timestamptz` | 是(默认 now) | 审计 |

### quarter_task（某被评人一季一条）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `taskUid` | `task_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qt_<nanoid>` |
| `cycleUid` | `cycle_uid` | `varchar(64)` | 是 | 软引用 quarter_cycle.cycle_uid；`(cycle_uid, ratee_user_id)` 唯一 |
| `rateeUserId` `rateeName` | `ratee_user_id` `ratee_name` | `varchar(128)` | 是/否 | 被评人（规范 ou_）+ 姓名快照 |
| `sheetType` | `sheet_type` | `varchar(16)` | 是 | employee/leader（决定季度模板） |
| `templateUid` | `template_uid` | `varchar(64)` | 否 | 开窗盖章（quarterly_employee/leader active 模板） |
| `mgmtRequired` `mgmtReason` | `mgmt_required` `mgmt_reason` | `boolean`/`text` | 是(默认 false)/否 | 是否进管理层评分（leader 恒 true；员工由直属勾选，理由必填） |
| `enrolled` `skipReason` | `enrolled` `skip_reason` | `boolean`/`text` | 是(默认 true)/否 | 是否参评（新人不足 2 完整月 → false + 原因，不建 sheet） |
| `stage` | `stage` | `varchar(24)` | 是(默认 pending_self) | 串行门控 pending_self/pending_peer_manager/pending_mgmt/scored |
| `selfSkipped` | `self_skipped` | `boolean` | 是(默认 false) | 自评超时自动放行标记 |
| `peerSkipped` | `peer_skipped` | `boolean` | 是(默认 false) | 同事评价超时自动放行标记（硬化3，migration 0021）。门控视同「同事已完成」，worker `advance-peer-timeout` 写入 |
| `stageDeadlines` | `stage_deadlines` | `jsonb` | 否 | `{self, peer_manager, mgmt}` ISO 串（开窗 openAt + 偏移 3/8/12 天） |
| `mgmtTrace` | `mgmt_trace` | `jsonb` | 否 | 管理层排除留痕 `{rule, excludedIds, raterIds}`（rule=first_level_dept\|manager_chain_fallback\|all_excluded_fallback）。`all_excluded_fallback`（硬化2）：排除后管理层评分人为空，raterIds=[]，本任务退化为无 mgmt |
| `createdAt` `updatedAt` | 同名 | `timestamptz` | 是 | 审计 |

### quarter_sheet（单张打分表）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `sheetUid` | `sheet_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qs_<nanoid>` |
| `cycleUid` `taskUid` | `cycle_uid` `task_uid` | `varchar(64)` | 是 | 软引用；`(task_uid, rater_user_id, rater_role)` 唯一 |
| `rateeUserId` | `ratee_user_id` | `varchar(128)` | 是 | 被评人 |
| `raterUserId` `raterName` | `rater_user_id` `rater_name` | `varchar(128)` | 是/否 | 评分人 + 姓名快照 |
| `raterRole` | `rater_role` | `varchar(16)` | 是 | self/manager/peer/management |
| `status` | `status` | `varchar(16)` | 是(默认 draft) | draft/submitted |
| `softTotal` | `soft_total` | `numeric(6,2)` | 否 | 软项合计 = Σ(raw/10×weight)（提交时算） |
| `goalScore` | `goal_score` | `numeric(6,2)` | 否 | 目标达成/团队结果（仅 manager sheet，0–45/0–40） |
| `submittedAt` | `submitted_at` | `timestamptz` | 否 | 提交时刻 |
| `version` | `version` | `integer` | 是(默认 1) | OCC 乐观锁 |

### quarter_sheet_item（每维度明细）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `itemUid` | `item_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qsi_<nanoid>` |
| `sheetUid` | `sheet_uid` | `varchar(64)` | 是 | 软引用；`(sheet_uid, dimension_code)` 唯一 |
| `dimensionCode` `dimensionName` | `dimension_code` `dimension_name` | `varchar` | 是/否 | 维度 code + 名字快照 |
| `weight` | `weight` | `numeric(5,2)` | 是 | 权重快照（提交时锁定，防模板后改影响历史） |
| `raw` | `raw` | `integer` | 是 | 1–10 打分 |
| `weighted` | `weighted` | `numeric(6,2)` | 是 | = raw/10 × weight |

### peer_assignment（同事互评指定）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `assignUid` | `assign_uid` | `varchar(64)` | 是(唯一) | 业务主键 `pa_<nanoid>` |
| `cycleUid` `quarter` | `cycle_uid` `quarter` | `varchar` | 是 | `(cycle_uid, ratee_user_id)` 唯一；`quarter` 供连任历史查询 |
| `rateeUserId` `peerUserId` `peerName` | 同名 | `varchar` | 是/是/否 | 被评人 / 指定同事 / 同事姓名 |
| `assignedBy` | `assigned_by` | `varchar(128)` | 否 | 指定人 |

### quarter_goal / quarter_goal_revision（半年目标 + 调整留痕）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `goalUid` | `goal_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qg_<nanoid>` |
| `half` `rateeUserId` | `half` `ratee_user_id` | `varchar` | 是 | `(half, ratee_user_id)` 唯一；half='YYYY-HN' |
| `content` `setBy` | `content` `set_by` | `text`/`varchar` | 否 | 目标内容 / 设定人（直属） |
| `proposedContent` `proposedBy` `proposedAt` | `proposed_content` `proposed_by` `proposed_at` | `text`/`varchar`/`timestamptz` | 否 | 目标提案流（P4b，migration 0022）：被评人本人发起的待确认调整；直属 confirm(accept) 应用为正式 content + 写 revision + 清空这三列，reject 仅清空并留痕原提案 |
| `revisionUid` | `revision_uid` | `varchar(64)` | 是(唯一) | 调整留痕主键 `qgr_<nanoid>` |
| `before` `after` `reason` `revisedBy` | 同名 | `text`/`varchar` | 否 | 改动前/后/原因/操作人 |

## 绩效模块 P3 — 评分会 + 合成/公示/申诉（2026-07-09，migration 0020_add_quarter_result）

评分会收口：管理层 sheet 全部提交后 `quarter_task.stage → scored`（state-machine.md §8）；compute 从已提交 sheet 合成一条 `quarter_result`（一任务一条，幂等 upsert，draft）；评分会改分写 `quarter_result_revision` 并重算；公示置 published + 申诉期 `publish + 3 个工作日`（domain-core `addWorkingDays`）；本人可对 published 结果发起 `quarter_appeal`。合成一律 import `packages/domain-core`（`mgmtAverage`/`mergeSoft`/`quarterlyTotal`/`quarterlyGrade`）。全部软引用，无 DB 外键。

### quarter_result（季度合成结果，一任务一条）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `resultUid` | `result_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qr_<nanoid>` |
| `cycleUid` `taskUid` | `cycle_uid` `task_uid` | `varchar(64)` | 是 | 软引用；`task_uid` 唯一（一任务一结果，幂等 upsert 键） |
| `rateeUserId` `rateeName` | `ratee_user_id` `ratee_name` | `varchar(128)` | 是/否 | 被评人（规范 ou_）+ 姓名快照 |
| `sheetType` | `sheet_type` | `varchar(16)` | 否 | employee/leader（冗余，panel 展示） |
| `goalScore` | `goal_score` | `numeric(6,2)` | 否 | 目标达成/团队结果（取自 manager sheet） |
| `managerSoft` `peerSoft` | `manager_soft` `peer_soft` | `numeric(6,2)` | 否 | 直属 / 同事软项合计。同事缺席（未指定/未提交/peer_skipped）→ `peer_soft` = NULL（硬化1，区别于「在场且打 0」） |
| `mgmtAvg` | `mgmt_avg` | `numeric(6,2)` | 否 | 管理层软项均值（`mgmtAverage`，无 mgmt / 全排除 → NULL） |
| `softMerged` | `soft_merged` | `numeric(6,2)` | 否 | 三方合成软项（`mergeSoft` 四分支，缺席方权重并入直属） |
| `total` | `total` | `numeric(6,2)` | 否 | = goal_score + soft_merged（`quarterlyTotal`） |
| `grade` | `grade` | `varchar(2)` | 否 | S/A/B/C/D（`quarterlyGrade`，红线→D） |
| `redLine` `redLineNote` | `red_line` `red_line_note` | `boolean`/`text` | 是(默认 false)/否 | 红线一票否决 + 事由（compute 参数传入，默认 false） |
| `weightsUsed` | `weights_used` | `jsonb` | 否 | mergeSoft 实际权重组 `{manager,mgmt?,peer?}`（硬化1 四分支：55/35/10、65/35、90/10、100；缺席方 key 不出现） |
| `mgmtRaters` | `mgmt_raters` | `jsonb` | 否 | 管理层留痕 `{rule, excludedIds, raterIds, scores:[{raterId,raterName,soft}]}`（rule 含 all_excluded_fallback） |
| `status` | `status` | `varchar(16)` | 是(默认 draft) | draft/published/closed（enum-dictionary） |
| `publishedAt` `appealDeadlineAt` | `published_at` `appeal_deadline_at` | `timestamptz` | 否 | 公示时刻 / 申诉截止（公示 + 3 工作日） |
| `createdAt` `updatedAt` | 同名 | `timestamptz` | 是 | 审计 |

### quarter_result_revision（评分会改分留痕）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `revisionUid` | `revision_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qrr_<nanoid>` |
| `resultUid` | `result_uid` | `varchar(64)` | 是 | 软引用 quarter_result.result_uid |
| `field` | `field` | `varchar(32)` | 是 | goal_score/soft_merged（重算 total/grade）\| total/grade（仅记录） |
| `before` `after` | `before` `after` | `text` | 否 | 改动前/后值 |
| `reason` | `reason` | `text` | 是 | 改分原因（必填） |
| `revisedBy` | `revised_by` | `varchar(128)` | 否 | 操作人 |
| `createdAt` | `created_at` | `timestamptz` | 是 | 审计 |

### quarter_appeal（公示后申诉）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `appealUid` | `appeal_uid` | `varchar(64)` | 是(唯一) | 业务主键 `qap_<nanoid>` |
| `resultUid` `rateeUserId` | `result_uid` `ratee_user_id` | `varchar` | 是 | 软引用结果 / 申诉人（本人，规范 ou_） |
| `content` | `content` | `text` | 否 | 申诉内容 |
| `status` | `status` | `varchar(16)` | 是(默认 open) | open/resolved/rejected（enum-dictionary）。partial unique：一 result 至多一条 open |
| `handler` `resolution` | `handler` `resolution` | `varchar`/`text` | 否 | 处理人（hr/admin）/ 处理结论 |
| `createdAt` `resolvedAt` | `created_at` `resolved_at` | `timestamptz` | 是/否 | 提交时刻 / 处理时刻 |

## 绩效模块 P4a — 半年合成 + 定级定岗联动（2026-07-09，migration 0021_add_half_year_and_peer_skipped）

半年合成：对某半年有 published `quarter_result` 的人，用 `halfYearTotal`（前季 40% + 后季 60%；仅一季有分 → single_100）合成一条 `half_year_result`，`quarterlyGrade` 定级（半年不套红线），唯一 `(half, ratee_user_id)` 幂等 upsert。定级定岗联动为只读派生：公示后 `quarter_result` 回填到该人最新 `grade_history.score_snapshot`（`{quarter,total,grade,soft_merged,goal_score}`；无职级记录则跳过），资格由 domain-core 纯函数 `promotionEligible` 判定（当季 S，或连续两季 A 及以上）。全部软引用，无 DB 外键。

### half_year_result（半年合成成绩，一人一半年一条）

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `resultUid` | `result_uid` | `varchar(64)` | 是(唯一) | 业务主键 `hyr_<nanoid>` |
| `half` | `half` | `varchar(16)` | 是 | 'YYYY-HN'；`(half, ratee_user_id)` 唯一（upsert 键） |
| `rateeUserId` `rateeName` | `ratee_user_id` `ratee_name` | `varchar(128)` | 是/否 | 被评人（规范 ou_）+ 姓名快照 |
| `prevQuarter` `currQuarter` | `prev_quarter` `curr_quarter` | `varchar(16)` | 否 | 前季 / 后季 'YYYY-QN'（H1→Q1/Q2，H2→Q3/Q4） |
| `prevTotal` `currTotal` | `prev_total` `curr_total` | `numeric(6,2)` | 否 | 前季 / 后季 `quarter_result.total`（缺 → NULL） |
| `formula` | `formula` | `varchar(16)` | 否 | '40/60'（双季有分）\| 'single_100'（仅一季有分）（enum-dictionary） |
| `total` | `total` | `numeric(6,2)` | 否 | 合成总分（`halfYearTotal`） |
| `grade` | `grade` | `varchar(2)` | 否 | S/A/B/C/D（`quarterlyGrade(total)`，半年不套红线） |
| `synthesizedAt` `createdAt` | `synthesized_at` `created_at` | `timestamptz` | 是 | 合成时刻 / 审计 |

> 定级定岗资格无独立表：读 `quarter_result`(published) 的 (quarter, grade) 序列 + `promotionEligible` 纯函数实时判定；公示快照回填到既有 `grade_history.score_snapshot`（jsonb 扩展位，不新建职级记录）。
