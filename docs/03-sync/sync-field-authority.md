# 同步字段主权规则

## 1. 目标

本文件定义各字段在多维表格、飞书任务、飞书日历、卡片交互、网页应用之间的主权归属，避免双向同步时发生循环写回与口径冲突。

> 字段名以 field-dictionary.md 为准。

## 2. 核心原则

1. 对外表现是双向同步
2. 对内必须有"中心主档"
3. 不是所有字段都允许任意入口修改
4. 每个字段必须定义：
   - 主权来源
   - 允许修改入口
   - 冲突处理方式

## 3. 字段主权分类

### 3.1 A 类：系统主权字段

仅允许中心系统写入，其他来源变更一律忽略或回滚。

- task_uid
- days_to_due
- is_overdue
- month_bucket
- source_month
- is_carried_over
- carried_from_task_uid
- carry_over_count
- monthly_close_locked
- version
- sync_version
- sync_status
- conflict_flag

规则：
- 多维表格中如暴露此类字段，应仅作展示
- 不允许用户直接手改
- 所有值由服务端计算或写回

### 3.2 B 类：业务结构字段

允许通过系统主入口或多维表格编辑，但最终以系统校验结果为准。

- title
- detail
- task_type
- priority
- assignee_user_id
- leader_user_id
- issuer_user_id
- assigner_user_id
- assignment_type
- collaborators
- monthly_commitment_flag

规则：
- 优先入口：网页应用 / 多维表格
- 飞书任务侧不作为此类字段的修改入口（负责人不从飞书任务侧回写，任务中心仅做镜像展示）
- 如果外部来源试图更新，应转为只读或忽略

### 3.3 C 类：执行状态字段

允许双向更新，但必须通过同步引擎合并。

- status
- progress_percent
- latest_progress
- completed_at
- blocked_reason
- delay_reason

规则：
- 合法入口：多维表格、网页应用、飞书任务、卡片
- 每次更新必须写进展日志
- 冲突时按"最后合法写入 + 字段规则"处理

### 3.4 D 类：时间承诺字段

允许双向更新，日历侧对已绑定日历事件的任务具有较高主权。

- start_at
- due_at

规则：
- 日历事件调整时间时，可回写中心主档（前提：任务已绑定日历事件）
- 未绑定日历的任务不接受日历回写
- 如老板 / leader 在系统侧锁定时间，日历侧不能覆盖
- 必须有版本号和更新时间判断

### 3.5 E 类：管理标记字段

仅限老板/PMO 编辑，不属于普通业务结构字段。

- boss_attention_flag

规则：
- 仅老板和 PMO（受托）可编辑
- 多维表格、飞书任务、卡片侧均为只读
- 不走普通 B 类业务字段的同步规则

## 4. 字段主权矩阵

| 字段类别 | 中心系统 | 多维表格 | 飞书任务 | 飞书日历 | 卡片 |
|---|---|---|---|---|---|
| A 系统主权字段 | 写 | 读 | 读 | 读 | 读 |
| B 业务结构字段 | 写 | 写 | 读 | 读 | 读/少量 |
| C 执行状态字段 | 写 | 写 | 写 | 读 | 写 |
| D 时间承诺字段 | 写 | 写 | 写 | 写（已绑定） | 读 |
| E 管理标记字段 | 写 | 读 | 读 | 读 | 读 |

## 5. 具体字段示例

### 5.1 `is_overdue`
- 主权：system
- 来源：系统定时计算
- 外部修改：不允许
- 说明：不能由多维表格公式直接驱动同步

### 5.2 `status`
- 主权：dual
- 来源：bitable / web / task / card
- 冲突策略：若一个来源将任务改为 `done`，另一个来源同时改为 `in_progress`，则按更新时间和来源上下文判定

### 5.3 `due_at`
- 主权：dual with calendar preference
- 来源：bitable / web / task / calendar
- 冲突策略：若日历事件明确改期，且无系统锁定，则以最新版本为准

### 5.4 `assignee_user_id`
- 主权：system / bitable
- 来源：仅 web / bitable
- 飞书任务侧：只读镜像，不回写中心主档
- 冲突策略：仅接受合法入口的修改

## 6. 不可回写字段

以下字段即使外部系统存在类似概念，也不回写中心主档：

- 飞书 UI 层临时展示态
- 外部系统自身统计值
- 多维表格公式临时计算结果

## 7. 扩展原则

新增字段时必须回答以下问题：

1. 是否属于业务事实，还是派生结果？
2. 谁是最终口径来源？
3. 哪些入口允许编辑？
4. 编辑后是否需要同步到其他系统？
5. 冲突时如何裁决？
