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
