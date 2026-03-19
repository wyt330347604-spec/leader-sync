# 状态机与流程

> 状态枚举值以 enum-dictionary.md 为准。

## 1. 任务生命周期状态机

```mermaid
stateDiagram-v2
    [*] --> draft: 创建
    draft --> assigned: 指派
    assigned --> in_progress: 开始执行
    assigned --> cancelled: 取消
    in_progress --> blocked: 发生阻塞
    blocked --> in_progress: 解除阻塞
    in_progress --> pending_review: 提交完成
    pending_review --> done: 验收通过
    pending_review --> in_progress: 验收退回
    in_progress --> done: 直接完成
    done --> reopened: 重新打开
    reopened --> in_progress: 继续执行
    done --> closed: 月结归档
    cancelled --> closed: 归档
```

## 2. 生命周期状态说明

| 状态 | 中文 | 说明 |
|---|---|---|
| draft | 草稿 | 已创建但未正式派发 |
| assigned | 已指派 | 已有负责人，待开始 |
| in_progress | 进行中 | 正在处理 |
| blocked | 阻塞 | 有阻塞因素 |
| pending_review | 待验收 | 已提交，待确认 |
| done | 已完成 | 业务完成 |
| reopened | 重新打开 | 已完成后重新处理 |
| cancelled | 已取消 | 终止 |
| closed | 已归档 | 历史归档状态 |

## 3. 状态流转规则

### 3.1 创建后
- 默认进入 `draft`
- 若创建时已明确负责人并立即生效，可直接进入 `assigned`

### 3.2 开始执行
- `assigned -> in_progress`
- 触发条件：负责人确认开始或第一次更新进展

### 3.3 阻塞
- `in_progress -> blocked`
- 要求：必须填写阻塞原因

### 3.4 提交完成
- `in_progress -> pending_review`
- 适用于需要 leader / 发起人验收的任务

### 3.5 完成
- `pending_review -> done`
- 或 `in_progress -> done`

### 3.6 重新打开
- `done -> reopened`
- 要求：必须记录重新打开原因

### 3.7 归档
- `done -> closed`
- `cancelled -> closed`
- 由月结或归档任务触发

## 4. 月度周期状态机

```mermaid
stateDiagram-v2
    [*] --> current_month_new: 本月新增
    current_month_new --> current_month_active: 进入执行
    current_month_active --> due_this_week: 本周应完成
    due_this_week --> overdue_warning: 临近延期
    overdue_warning --> overdue: 到期未完成
    current_month_active --> completed_in_month: 本月完成
    overdue --> carry_over_pending: 月结待结转
    carry_over_pending --> carried_to_next_month: 继承到下月
    completed_in_month --> monthly_archived: 上月快照归档
    carried_to_next_month --> monthly_archived: 上月快照归档
```

## 5. 同步状态机

> 枚举值以 enum-dictionary.md `sync_status` 为准。

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> syncing: 开始同步
    syncing --> success: 成功
    syncing --> failed: 失败
    failed --> retrying: 自动重试
    retrying --> success: 重试成功
    retrying --> failed: 重试仍失败（超出上限）
    syncing --> conflict: 冲突
    retrying --> conflict: 重试后冲突
    conflict --> manual_review: 进入人工处理
    manual_review --> success: 修复完成
    pending --> skipped: 规则判定跳过
```

## 6. 指派流程

```mermaid
flowchart TD
    A[创建任务] --> B{是否立即指派}
    B -- 否 --> C[保存为 draft]
    B -- 是 --> D[记录发起人/指派人/负责人]
    D --> E[写入中心主档]
    E --> F[同步多维表格]
    E --> G[同步飞书任务]
    E --> H{是否需要同步日历}
    H -- 是 --> I[创建/更新日程]
    H -- 否 --> J[结束]
    I --> J
```

## 7. 月结流程

```mermaid
flowchart TD
    A[月结开始] --> B[统计口径按月末 24:00 冻结]
    B --> C[抽取上月任务]
    C --> D[计算个人统计]
    D --> E[计算 leader 统计]
    E --> F[计算公司统计]
    F --> G[生成 monthly_snapshot]
    G --> H[判定继承任务]
    H --> I[新建继承任务记录]
    I --> J[发送月报]
    J --> K[月结完成]
```
