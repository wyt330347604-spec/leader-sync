# 事件订阅设计

## 1. 目标

通过飞书事件机制接收外部变更，驱动双向同步与提醒逻辑。

## 2. 订阅方式

建议统一通过服务端接收：

- 事件回调
- 卡片交互回调
- 可选长连接消费

## 3. 推荐订阅事件

### 3.1 多维表格事件
- 记录新增
- 记录更新
- 记录删除（如需要）

用途：
- 捕捉表格侧用户编辑
- 回写中心主档
- 触发外部同步

### 3.2 卡片交互事件
用途：
- 更新状态
- 填写进展
- 申请延期
- 打开详情页

### 3.3 日历相关事件
用途：
- 感知日程时间变更
- 回写 due_at / start_at
- 触发改期同步

### 3.4 飞书任务侧双向策略

> 当前飞书开放平台的任务变更回调能力尚待确认。标准事件订阅总览中，任务侧可查到的是 tasklist activity subscription 相关 API，属于"动态通知订阅"能力，不能直接等同于"开发者服务器回调事件流"。

在未确认当前租户和接口能力下存在可用的任务变更回调前，任务侧双向同步采用以下策略：

- **准实时双向**：通过 API 写入 + 周期性对账补偿（reconciliation）实现
- **对账频率**：每 15 分钟（见 sync-idempotency-policy.md）
- **待评估项**：`task_reconciliation_job`（定时拉取任务变更）、`task_change_polling_or_activity_subscription_assessment`（评估是否可使用原生回调）

确认原生回调可用后，可升级为事件驱动模式。

### 3.5 系统内部事件
虽然不是飞书事件，也建议统一建模：

- task.created
- task.updated
- task.assigned
- task.completed
- task.delayed
- monthly_close.started
- monthly_close.completed

## 4. 事件消费规则

1. 所有事件必须有 `source_type`
2. 所有事件必须有 `source_event_id`
3. 所有事件必须可幂等处理
4. 所有事件必须记录处理结果
5. 所有事件必须支持失败重试

## 5. 幂等设计

### 幂等键建议
`idempotency_key = source_type + source_event_id`

### 处理原则
- 首次处理：正常执行
- 重复处理：直接返回已处理结果
- 半成功：允许补偿重试

## 6. 事件处理通用流程

1. 接收事件
2. 验签 / 校验来源
3. 解析事件类型
4. 查重（幂等）
5. 拉取必要详情
6. 执行业务处理
7. 触发下游同步
8. 写入日志
9. 返回处理结果

## 7. 回调路径建议

业务 API 和飞书回调分域名：

- 业务 API：`https://api.example.com/api/v1/...`
- 飞书事件回调：`https://callback.example.com/feishu/events`
- 卡片回调：`https://callback.example.com/feishu/cards`
- 日历回调：`https://callback.example.com/feishu/calendar/events`
- 内部事件：`https://api.example.com/api/internal/events`

## 8. 异常处理

### 8.1 验签失败
- 拒绝请求
- 记录安全日志

### 8.2 业务异常
- 记录错误日志
- 写入重试队列

### 8.3 外部系统不可用
- 降级为中心主档先落库
- 稍后执行补偿同步

## 9. 监控指标

- 每分钟事件量
- 处理成功率
- 重复事件命中率
- 失败重试次数
- 超时数量
- 冲突数量
