# 变更记录

## v0.2（2026-03-18）

### 新增四条总原则（CLAUDE.md）
- 命名主权：`_at` = 时间戳，`_date` = 纯日期
- 模型主权：field-dictionary / enum-dictionary / db-schema / api-contracts / milestone-plan 各司其职
- 同步主权：字段级主权 + 冲突策略 + 幂等 + 对账
- 月结主权：逻辑冻结时点与作业执行时间分开定义

### P0 修复
- 统一时间字段命名：`start_date` → `start_at`，`due_date` → `due_at`，类型 → `timestamptz`
- 废弃 `task_sync` 宽表，统一采用 `external_mapping` 归一化模型
- 幂等保留策略统一为两层：热缓存 7 天 + 持久日志 90 天
- 里程碑以 `milestone-plan.md` 为唯一主权，`project-charter.md` 改为摘要引用
- 月快照补 `month_due_count` 字段，完成率和延期率分母统一为应完成数
- 继承策略明确为"新建记录"，不修改原记录

### P1 修复
- `sync_status` 枚举统一为 8 值：pending/syncing/retrying/success/failed/conflict/manual_review/skipped
- API 契约修正：`leader_assign` → `manager_assign`
- `task_type` 枚举统一为 8 个，字段字典补齐 follow_up / other
- `assignee_user_id` 飞书任务侧改为单向（中心 → 任务），不从任务侧回写
- `start_at` 允许日历侧回写（已绑定日历事件的任务）
- `boss_attention_flag` 从 B 类改为 E 类（管理标记字段），仅限老板/PMO 编辑
- 月结冻结拆分：逻辑冻结时点 = 月末 24:00，作业执行时间 = 次月 1 日 08:00
- `db-schema.md` 改为完整可建表版本，补全所有缺失字段
- 月快照补 `snapshot_run_id`、`snapshot_version`、`is_latest`、`generated_at`
- `PATCH /tasks` 强制带 `version`（乐观锁），版本不一致返回 409
- 必填字段分为 A（用户提交必填）和 B（系统落库必填）
- 飞书任务事件订阅改为"API + 对账补偿"模式，不依赖未确认的原生回调
- 新增 `conflict_resolution_status` 枚举

### P2 修复
- 统一修复 Markdown 标题层级错误（prd / notification-rules / sync-field-authority / sync-conflict-policy / api-permissions / domain-and-ssl / event-subscriptions）
- README 目录树补 `07-architecture/` 和 `09-roadmap/`
- 协作者一期不做外部双向同步
- 回调路径与域名策略对齐：业务 API 走 `api.example.com`，飞书回调走 `callback.example.com`
- `overdue_rate` 公式定义：`month_overdue_count / month_due_count`
- Backlog 增加 `target_milestone` 字段

## v0.1
- 初始化项目文档
- 补充 PRD、字段字典、状态机、权限矩阵
- 补充系统架构、接口契约、数据库设计、多维表格结构、部署与里程碑

## 维护规则
- 每次文档结构调整必须更新本文件
- 每次字段语义变化必须记录版本与原因
- 每次同步规则变化必须记录影响范围
