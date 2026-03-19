# API 契约草案

> 外部接口主权文档。字段名以 field-dictionary.md 为准。

## 1. 目标

定义前后端与外部集成使用的主要 API 契约。当前为初稿，后续可转为 OpenAPI。

## 2. 通用约定

- Base Path：`/api/v1`
- 所有响应统一包含：`trace_id`
- 时间统一使用 ISO 8601
- 认证方式：飞书登录态 + 服务端 session / JWT

## 3. 通用响应格式

```json
{
  "code": 0,
  "message": "ok",
  "trace_id": "tr_123",
  "data": {}
}
```

## 4. 任务接口

### 4.1 创建任务
`POST /api/v1/tasks`

请求体（用户提交必填字段标 *）：
```json
{
  "title": "完成 4 月经营分析",        // * A 必填
  "detail": "输出经营分析和风险复盘",
  "task_type": "report",               // * A 必填
  "priority": "p1",                    // * A 必填
  "assignee_user_id": "ou_xxx",        // * A 必填
  "due_at": "2026-04-08T18:00:00+08:00", // * A 必填
  "assignment_type": "boss_assign",
  "boss_attention_flag": true
}
```

系统自动填充：`task_uid`、`issuer_user_id`、`assigner_user_id`、`leader_user_id`、`month_bucket`、`status`、`version`、`created_at`、`created_by`

### 4.2 获取任务详情
`GET /api/v1/tasks/{task_uid}`

### 4.3 更新任务
`PATCH /api/v1/tasks/{task_uid}`

请求体必须包含 `version` 用于乐观锁校验：
```json
{
  "version": 3,
  "title": "...",
  "status": "in_progress",
  "progress_percent": 50,
  "latest_progress": "已完成初稿",
  "due_at": "2026-04-10T18:00:00+08:00"
}
```

允许字段：
- `title`
- `detail`
- `status`
- `progress_percent`
- `latest_progress`
- `due_at`
- `completed_at`
- `blocked_reason`
- `delay_reason`
- `version`（必填，乐观锁）

规则：
- `version` 不一致返回 `409 Conflict`
- 响应体附当前最新版本

### 4.4 指派任务
`POST /api/v1/tasks/{task_uid}/assign`

```json
{
  "assignee_user_id": "ou_new",
  "assignment_type": "manager_assign",
  "reason": "调整负责人"
}
```

### 4.5 提交完成
`POST /api/v1/tasks/{task_uid}/complete`

```json
{
  "latest_progress": "已完成并提交验收",
  "completed_at": "2026-04-07T20:30:00+08:00"
}
```

### 4.6 延期申请
`POST /api/v1/tasks/{task_uid}/delay`

```json
{
  "new_due_at": "2026-04-12T18:00:00+08:00",
  "delay_reason": "依赖数据未到齐"
}
```

## 5. 列表接口

### 5.1 我的任务
`GET /api/v1/me/tasks`

Query：
- `status`
- `bucket`
- `priority`
- `page`
- `page_size`

### 5.2 Leader 团队任务
`GET /api/v1/leader/tasks`

### 5.3 老板驾驶舱
`GET /api/v1/dashboard/boss`

## 6. 月结接口

### 6.1 月结 dry-run
`POST /api/v1/monthly-close/dry-run`

### 6.2 执行月结
`POST /api/v1/monthly-close/execute`

### 6.3 获取月报
`GET /api/v1/monthly-close/{month}`

## 7. 同步管理接口

### 7.1 手工重试同步
`POST /api/v1/sync/tasks/{task_uid}/retry`

### 7.2 获取同步日志
`GET /api/v1/sync/logs`

### 7.3 标记冲突已处理
`POST /api/v1/sync/conflicts/{conflict_id}/resolve`

## 8. 鉴权与权限

- 员工仅访问与自己相关的任务
- leader 仅访问自己团队的聚合视图与明细
- 老板与 PMO 可访问全局视图
- 所有写接口必须做角色检查

## 9. 错误码建议

- `1001` 参数非法
- `1002` 无权限
- `1003` 任务不存在
- `1004` 状态流转非法
- `1005` 同步冲突
- `1006` 外部系统调用失败
- `1007` 月结已锁定
- `1009` 版本冲突（409）
