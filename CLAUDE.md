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

## Local Dev（本地开发环境，QC Protocol 的物质基础）

### 架构

```
┌─ 本地 Mac ─────────────┐         ┌─ 服务器 47.84.35.154 ──────┐
│ pnpm api dev :3001     │         │ leader-sync (生产)         │
│ pnpm web dev :3000     │         │   postgres :5432           │
│                        │         │   redis    :6379           │
│ DB connection:         │  SSH    │                            │
│ localhost:5432 ────────┼─tunnel→ │ leader-sync-dev (新加)     │
│ localhost:6379 ────────┼─tunnel→ │   postgres-dev :5433       │
│                        │         │   redis-dev    :6380       │
│ playwright + screenshot│         │                            │
└────────────────────────┘         └────────────────────────────┘
```

**所有 docker 容器都在服务器上运行**。本地通过 SSH 端口转发把服务器上的 dev DB 当成本地 DB 用。生产 DB（5432）和 dev DB（5433）端口不同，互不干扰。

### 一次性：服务器上起 dev 容器

```bash
pnpm server:dev:up       # rsync docker-compose.dev.yml + docker compose up -d
```

会在服务器创建 `/opt/leader-sync-dev/` 目录，启动 `leader-sync-dev-postgres-dev-1` 和 `redis-dev` 容器，绑定 127.0.0.1:5433/6380（不对外）。

### 日常：本地开发流程

```bash
# 1. 起 SSH 隧道（后台）
pnpm dev:tunnel           # localhost:5432→server:5433, localhost:6379→server:6380

# 2. 应用 schema + 灌 seed 数据（也包括确认隧道在）
pnpm dev:up

# 3. 两个终端起 API/Web
NODE_ENV=development DATABASE_URL='postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' \
  pnpm --filter @leader-sync/api dev      # T1
pnpm --filter @leader-sync/web dev         # T2

# 4. 跑截图
cd apps/web && pnpm e2e:screenshot         # → screenshots/{timestamp}/*.png
```

### 进入应用（dev-login 绕过飞书 OAuth）

打开 `http://localhost:3000`，浏览器控制台执行：
```js
fetch('/api/v1/auth/dev-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: 'ou_dev_harvey' }),
}).then(() => location.reload());
```

dev-login 端点仅在 `NODE_ENV=development` 下注册路由，生产返回 404。

### 关闭/重置

```bash
pnpm dev:tunnel:down       # 关 SSH 隧道
pnpm dev:tunnel:status     # 查隧道状态
pnpm dev:reset             # 服务器上清空 volume + 重启容器 + 重新 seed
pnpm dev:seed              # 仅重新 seed（保留 schema/容器）
```

### Fixtures 内容

- 5 个用户：`ou_dev_harvey`(Harvey/admin)、`ou_dev_boss`(Tobi/boss)、`ou_dev_alice/bob/carol`
- 3 个项目：公司建设(默认) / 印尼电商 / 印度金融
- 20 个任务：覆盖所有 status × priority × delay_count × is_carried_over × boss_attention_flag 的视觉态

### 同步生产日志

```bash
pnpm logs:pull              # 全同步到 logs/prod/
pnpm logs:pull --tail 200   # tail 最近 200 行
```

## QC Protocol（质量控制协议 — 铁律，与交付流程同级）

**这三条是铁律。每条都必须严格执行；做不到要明确告知用户而不是装作做了。**

### 1. 先证伪，后修复（Red-Light-First）

遇到任何 bug、回归、行为偏差，**必须先写一个能稳定复现错误的测试用例**：
- **后端**：vitest 单测（`apps/api`），mock service / repository 复现错误路径。
- **前端**：vitest + React Testing Library（`apps/web`，已配置）；UI 行为级 bug 用 playwright e2e。
- **流程**：`pnpm test`（或 `pnpm vitest <path>`）看到 RED → 改代码 → 再看 GREEN。**严禁在没有看到 RED 之前修改任何业务逻辑代码**（lint/格式不算）。
- 修复 commit 必须连同测试一起提交，作为回归保护。

### 2. UI 改动必须运行时审计（Screenshot Audit）

涉及 UI 的任何改动（布局、组件、样式、交互），交付前**必须**：

1. 启动本地 dev（`pnpm --filter @leader-sync/web dev:tee`，写入 `logs/web-dev.log`）。
2. 运行截图脚本：`cd apps/web && pnpm e2e:screenshot`（依赖 `NODE_ENV=development` 启动的本地 API + 本地数据库连接）。
3. 截图输出到 `screenshots/{timestamp}/<page>.png`。
4. **主动 Read 截图**确认每个改动页面的实际渲染。
5. 在交付报告中写明：**"我已通过 `screenshots/<timestamp>/` 下的截图确认 UI 表现符合预期"**。

> 截图脚本通过后端 `POST /api/v1/auth/dev-login`（仅 `NODE_ENV=development` 启用）注入 JWT cookie 绕过飞书 OAuth。生产环境此端点不存在。

### 3. 排查问题必须先读日志（Log-First Diagnosis）

排查任何故障、500 错误、性能异常前：

1. **先同步生产日志**：`scripts/pull-logs.sh`（rsync 生产 `/var/log/leader-{api,web,worker}.log` 到本地 `logs/prod/`）。
2. **必读** `logs/prod/leader-api.log` 和相关日志的最近 200-500 行（`tail -n 500 logs/prod/leader-api.log`）。
3. 找到具体错误堆栈、trace_id、SQL 错误后再开始改代码。
4. **严禁基于猜测修改代码**——必须能在日志里指认根因。

### 违反后果
- 没看到 RED 就改逻辑 → 回退改动，先补测试。
- UI 改动没截图就交付 → 视为未完成，必须补截图。
- 没读日志就改代码 → 报告无效，重新走流程。

## Forbidden

- 禁止把“剩余天数”“是否延期”只做成多维表格公式而不落库
- 禁止把月结统计直接从飞书任务/日历实时拼出来
- 禁止没有 event_id / version / source 的写回
- 禁止不写文档直接改字段语义


<!-- BASELINE-SYNC:START (由 personal-copy/scripts/sync-claude-baseline.sh 维护，勿手改此块) -->
## 个人协作偏好基线（通用）

> 语言：中文 ｜ 不用 emoji ｜ 简洁直接，结论先行，不要废话。

**A. 先确认后动手**
1. 需求有模糊点：先列 Clarifying Questions（≤5 条，按对结果影响度排序）等回答，不猜着干。
2. 大任务（多步 / 架构调整 / 新模块）：先给方案或大纲，打印 `[等待 Harvey 确认]` 再动手。
3. 例外："直接来 / 开始 / 就这样"、纯查询、小改动可跳过确认。

**B. 不编造**：不确定就说不确定；三态标注【已知】/【推测】/【待核实】；会变的事实（版本 / 命令 / 依赖 / API / 定价）web 查证，不靠记忆。

**C. 来源与引用**：关键结论标出处，外部链接登记 `refs/sources.md`；分清答案来自项目知识库还是通用知识。

**D. 自检再交付**：绝不让 Harvey 当校对。交付前自查（对不对 / 通不通 / 答没答所问 / 有无遗漏）；声明"完成"前复述核对清单，并给验证证据（跑了什么、看到什么）。

**E. 指令审核（重大先审）**
1. 触发（任一即审）：新项目 / 新模块、架构或口径变更、对外承诺 / 花钱、预估 > 1 天工作量、与既有决策冲突。→ 先审指令合理性（商业逻辑 / 成熟方案对照 / 与既定目标是否冲突），**一轮讨论收敛**出评估 + 推荐，Harvey 拍板后再落方案。
2. 琐事（小修 / 查询）或明示"直接来"：直接干，不启动审核。
3. 执行型任务（按已定 spec 实施）降档：不审商业逻辑；但**发现指令与 spec / DoD 冲突必须停下提出，不闷头执行**。

**F. 方案完整性三问**（方案定稿前 + 交付验收前各过一遍）
1. 链路闭环？（输入 → 处理 → 输出无断点）
2. 用户旅程走通？（每类用户从进入到完成，无死路）
3. 与初衷 / DoD 冲突？初衷锚点默认＝项目 CLAUDE.md 的定位句 / DoD（项目可另行指定）。发现冲突**显式回报，不静默改**——纠正权在 Harvey。结论落 `docs/decisions.md`。

**G. 阶段复盘（事件驱动）**
1. 触发：里程碑 / 阶段收口、重大事故后、Harvey 点名"复盘"。
2. 内容：对照初衷锚点 / DoD / decisions.md，找问题与偏航。
3. 产出必须落盘（`docs/decisions.md` 或复盘文档），行动项有 owner；**下次复盘先核上次行动项是否闭环**——不落盘不算复盘。

**Response Style · 金字塔**：结论先行（TL;DR 1 句 → 2-4 要点 → 细节按需）；MECE 不重不漏；提选项必排序并推荐一个；删掉能删的字。

**全局编码规范**（`~/.claude/rules/common/*.md` 自动加载，各项目继承）：不可变数据（不原地改，返回新副本）· 多小文件优于大文件（单文件 <800 行）· 错误显式处理不吞 · 系统边界校验输入 · TDD（先测后码、≥80% 覆盖）· 安全（无硬编码密钥 / 校验输入 / 不泄敏感信息）· commit 用 `<type>: <desc>` 规范。
<!-- BASELINE-SYNC:END -->
