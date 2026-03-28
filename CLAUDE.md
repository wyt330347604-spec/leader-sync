# CLAUDE.md

## Project Purpose

这是一个基于飞书开放平台的“领导月度督办系统”，目标是在飞书内完成任务收集、指派、执行、提醒、月结和复盘，并支持多维表格、飞书任务、飞书日历的双向同步。

## Primary Principles

1. PostgreSQL 是中心主档
2. 多维表格 / 飞书任务 / 飞书日历 都是外部投影与交互入口
3. 所有跨系统写操作必须经过 sync-engine
4. 所有事件处理必须幂等
5. 所有关键业务口径必须文档先行

## Governance Principles（四条总原则）

### 1. 命名主权
- `_at` = 带时分秒的时间戳（datetime / timestamptz）
- `_date` = 纯日期（date）
- 同一业务语义只能保留一个 canonical 字段名，禁止多文档各自起名

### 2. 模型主权
- `field-dictionary.md` + `enum-dictionary.md` = 业务语义主权
- `db-schema.md` = 物理落库主权
- `api-contracts.md` = 外部接口主权
- `milestone-plan.md` = 唯一里程碑主权
- 其他文档只能引用，不再各自重复定义

### 3. 同步主权
- "双向同步"不等于"各端都能改所有字段"
- 必须坚持"字段级主权 + 冲突策略 + 幂等 + 对账"

### 4. 月结主权
- 月报统计的逻辑截止时点和执行作业时间必须分开定义
- 逻辑冻结时点：上月最后一刻（月末 24:00:00）
- 作业执行时间：次月 1 日 08:00

## Architecture Rules

- 禁止任何模块绕过 `sync-engine` 直接把业务字段写入多个外部系统
- 禁止直接以多维表格公式字段作为同步判断依据
- 所有派生字段必须由服务端计算并回写
- 月结逻辑必须可以重复执行且结果稳定
- 所有外部实体必须保留映射 ID

## Documentation Rules

任何改动都必须同步修改文档：

- 字段变更：更新 `docs/02-data/field-dictionary.md`
- 枚举变更：更新 `docs/02-data/enum-dictionary.md`
- 状态变更：更新 `docs/04-process/state-machine.md`
- 权限变更：更新 `docs/05-permissions/permission-matrix.md`
- 同步规则变更：更新 `docs/03-sync/*`
- 飞书能力、权限、事件变更：更新 `docs/06-feishu/*`

## Coding Rules

- 所有 handler 必须记录 trace_id
- 所有 callback 必须记录 source_event_id
- 所有同步写操作必须写 `sync_log`
- 所有同步冲突必须可审计
- 所有定时任务必须支持 dry-run
- 所有数据库 schema 变更必须通过 migration

## Naming Rules

- 文档用 kebab-case
- 数据表用 snake_case
- 领域对象统一使用英文 key + 中文说明
- 时间字段统一后缀：
  - `_at`：时间戳
  - `_date`：日期
- 布尔字段统一前缀：
  - `is_`
  - `has_`
  - `should_`

## Testing Rules

- sync-engine 改动必须补 integration test
- 月结逻辑改动必须补 regression test
- 权限逻辑改动必须补 permission test
- 回调逻辑改动必须补 idempotency test
- 任何严重 bug 修复必须补回归用例

## Collaboration Rules

- 遇到文档间不一致、口径模糊、设计可左可右的问题，必须先向项目负责人确认，不得自行判断后直接修改
- 禁止在未经确认的情况下替用户做业务决策（如字段命名选型、表结构选型、继承策略选型等）
- 所有涉及多文档联动的变更，必须先列出影响范围和可选方案，等待决策后再执行

## Delivery Protocol（交付流程 — 强制执行）

任何功能变更、bug 修复、架构调整都必须严格遵循以下流程，不得跳步：

### 阶段 1：文档先行
- 先输出变更说明文档（目标、影响范围、可选方案）
- 列出所有模糊设计点，逐条与项目负责人确认
- 禁止在有未确认的模糊点时进入下一阶段

### 阶段 2：设计方案
- 所有模糊点确认完毕后，才输出完整设计方案
- 设计方案必须包含：变更文件清单、关键代码逻辑、测试计划
- 等待项目负责人首肯后才能进入执行

### 阶段 3：执行 + 自测
- 按设计方案执行代码变更
- **交付前必须自行完成全部测试**：
  - 单元测试全部通过
  - 涉及的 API 端点必须用 curl 或等效方式验证
  - 涉及的页面必须验证 HTTP 状态码
  - 涉及部署的必须验证服务存活（healthz / readyz）
- 测试不通过不得交付，必须先修复再报告

### 违反后果
- 跳过文档直接写代码 → 回退代码，重新走流程
- 跳过确认直接执行 → 回退变更，重新确认
- 未自测就交付 → 视为未完成

## Forbidden

- 禁止把“剩余天数”“是否延期”只做成多维表格公式而不落库
- 禁止把月结统计直接从飞书任务/日历实时拼出来
- 禁止没有 event_id / version / source 的写回
- 禁止不写文档直接改字段语义
