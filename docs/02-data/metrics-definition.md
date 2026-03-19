# 指标口径定义

## 1. 目标

定义驾驶舱、月报和团队看板中使用的核心统计指标，避免各页面口径不一致。

## 2. 指标列表

### 2.1 本月新增任务数
统计口径：`month_bucket = 当前月份` 且创建时间在本月的任务数。

### 2.2 本月完成任务数
统计口径：`completed_at` 落在本月的任务数。

### 2.3 本月应完成任务数
统计口径：`due_at` 落在本月，且状态不为 cancelled 的任务数。

### 2.4 本月完成率
公式：`本月完成任务数 / 本月应完成任务数`（即 `month_done_count / month_due_count`）

### 2.5 延期任务数
统计口径：截止时间已到且未完成，`is_overdue = true`。

### 2.6 延期率
公式：`本月延期未完成任务数 / 本月应完成任务数`（即 `month_overdue_count / month_due_count`）

### 2.7 继承任务数
统计口径：`is_carried_over = true` 且 `month_bucket = 当前月份`。

### 2.8 老板关注任务数
统计口径：`boss_attention_flag = true`。

## 3. 统计注意事项

- 月报以 monthly_snapshot 为准
- 实时页面可用 task 实时统计
- 月结后不得再改上月快照口径
- 完成率和延期率的分母统一为 `month_due_count`
