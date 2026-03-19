# 模块边界说明

## 1. 目标

定义系统模块的职责边界，避免代码层出现跨层耦合和绕过 sync-engine 的写操作。

## 2. 模块列表

- `apps/web`：前端页面与飞书工作台网页应用
- `apps/api`：HTTP API 与飞书回调入口
- `apps/worker`：定时任务、异步任务、补偿任务
- `packages/domain-core`：领域对象、业务规则、状态机
- `packages/sync-engine`：同步规则、字段主权、冲突处理
- `packages/feishu-sdk-wrapper`：飞书 API 封装
- `packages/shared-types`：DTO、枚举、常量、事件定义
- `db`：schema、migration、seed

## 3. 允许依赖关系

```text
web -> api
api -> domain-core, sync-engine, feishu-sdk-wrapper, shared-types
worker -> domain-core, sync-engine, feishu-sdk-wrapper, shared-types
sync-engine -> domain-core, shared-types
feishu-sdk-wrapper -> shared-types
shared-types -> 无
```

## 4. 禁止事项

- `web` 禁止直接访问数据库
- `web` 禁止直接调用飞书外部 API
- `api` 禁止跳过 `sync-engine` 直接写多个外部系统
- `worker` 禁止实现独立于 `domain-core` 的业务规则副本
- `feishu-sdk-wrapper` 禁止承载业务判断

## 5. 模块职责

### 5.1 domain-core
负责：
- Task 聚合根
- 状态机
- 月结规则
- 提醒规则
- 权限规则

### 5.2 sync-engine
负责：
- 外部字段映射
- 同步方向判定
- 字段主权判断
- 幂等校验
- 冲突检测
- 回写调度

### 5.3 feishu-sdk-wrapper
负责：
- 飞书 token 获取与刷新
- 多维表格读写
- 飞书任务读写
- 日历读写
- 卡片消息发送

## 6. 代码审查基线

每次 PR 至少检查：
- 是否有绕过 sync-engine 的写操作
- 是否新增了业务字段但未更新文档
- 是否新增了外部映射但未写审计日志
- 是否对幂等逻辑做了回归测试
