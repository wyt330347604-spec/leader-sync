# ChatGPT 架构设计交接文档

> 本文档面向第一次接触该项目的人，完整描述项目现状、技术架构、已知问题和待解决的架构问题。
> 生成时间：2026-03-23。基于仓库实际文件逐一审查后编写。

---

# 项目概览

## 项目目标

这是一个**飞书领导月度督办系统**（内部代号 leader-sync），运行在飞书企业自建应用内。核心目标：

1. 在飞书内完成领导月度工作事项的**任务收集、指派、执行、提醒、月结和复盘**
2. 以 PostgreSQL 为中心主档，与飞书**多维表格（Bitable）**、**飞书任务**、**飞书日历**实现双向同步
3. 形成**员工 / Leader / 老板**三级视角，支持周提醒、月结统计、继承任务、老板驾驶舱
4. 沉淀为可复用的内部项目标准结构

**不是什么**：不是通用项目管理系统，不是 OKR 工具，不是审批系统，不对飞书组织外开放。

## 当前开发阶段

项目分为 6 个里程碑（M0–M5），MVP 截止到 M4：

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 文档/设计冻结 | ✅ 完成（32 份设计文档） |
| M1 | 基础底座（DB schema + API + Web + 飞书登录） | ⚠️ 代码已写完，**未联调**（无服务器环境） |
| M2 | 多维表格双向同步 | 未开始 |
| M3 | 飞书任务 + 卡片交互 + 周提醒 | 未开始 |
| M4 | 月结 + 老板驾驶舱 + Leader 视图 | 未开始 |
| M5 | 日历同步 + 冲突修复 + 对账台 | 未开始 |

**关键事实**：M1 代码已全部提交（6 个 commit、40+ 文件、40 个单元测试通过），但因服务器和 Docker 环境未就绪，**未执行过 migration、seed、或端到端联调**。

## 主要业务对象 / 核心场景

**6 个业务对象**：
- **Task**（任务）— 核心实体，包含生命周期状态、指派关系、月份归属、双向同步状态
- **Task Progress Log**（进展日志）— 每次状态/进展变更的审计日志
- **External Mapping**（外部映射）— 任务与飞书多维表格 / 任务 / 日历的映射关系
- **Monthly Snapshot**（月快照）— 月结统计结果（完成率、延期率等），支持重跑
- **User / Role**（用户与角色）— 飞书组织架构缓存 + 角色绑定
- **Inbound Event / Sync Log / Sync Conflict**（事件/同步日志/冲突）— 同步引擎基础设施

**8 个核心场景**：
1. 老板创建重点任务 → 指派给 Leader
2. Leader 拆解 → 指派给员工
3. 员工在飞书任务或系统页面更新进展
4. 每周一推送本周应完成任务提醒
5. 系统推送临近延期 / 已延期提醒
6. 月初自动生成上月完成情况 + 继承任务
7. 老板查看各 Leader 本月任务与风险项
8. 多维表格 / 飞书任务 / 日历三方保持双向同步

---

# 技术栈与运行方式

## 语言 / 框架 / 基础设施

| 层 | 技术 | 版本 |
|---|---|---|
| 运行时 | Node.js | 24（.nvmrc 指定） |
| 包管理 | pnpm + Turborepo | pnpm 10.32, turbo 2.8 |
| 后端 | NestJS | 11 |
| 前端 | Next.js (App Router) | 15 |
| ORM | Drizzle ORM | 0.44 |
| 数据库 | PostgreSQL | 15 |
| 缓存 | Redis | 7 |
| 样式 | Tailwind CSS | 4 |
| 请求库 | SWR（前端）/ native fetch（后端） | — |
| 认证 | JWT（httpOnly cookie，8h 过期） | — |
| 飞书 SDK | 飞书开放平台 REST API + JS-SDK | — |

## 启动方式

```bash
# 1. 启动基础设施
docker compose up -d          # PostgreSQL 15 + Redis 7

# 2. 安装依赖
pnpm install

# 3. 生成并执行数据库迁移
pnpm db:generate
pnpm db:migrate

# 4. 插入测试数据
pnpm db:seed

# 5. 启动开发服务
pnpm dev                      # Turborepo 并行启动 api (3001) + web (3000)
```

**实际状态**：步骤 1-4 从未执行过（无 Docker 环境），步骤 5 未验证。

## 构建与测试命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | Turborepo 并行启动所有 dev 服务 |
| `pnpm build` | 构建所有 packages 和 apps |
| `pnpm test` | 运行所有测试（Vitest） |
| `pnpm lint` | TypeScript 类型检查 |
| `pnpm db:generate` | Drizzle Kit 生成 migration SQL |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm db:seed` | 插入开发测试数据 |

## 环境变量与外部依赖

`.env.example` 定义了 12 个环境变量：

| 变量 | 说明 | 必填 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | 是 |
| `REDIS_URL` | Redis 连接串 | 是 |
| `FEISHU_APP_ID` | 飞书自建应用 ID | 是（联调时） |
| `FEISHU_APP_SECRET` | 飞书自建应用密钥 | 是（联调时） |
| `FEISHU_VERIFICATION_TOKEN` | 飞书事件回调验签 token | 待确认 |
| `FEISHU_ENCRYPT_KEY` | 飞书事件加密密钥 | 待确认 |
| `JWT_SECRET` | JWT 签名密钥 | 是 |
| `JWT_EXPIRES_IN` | JWT 有效期（默认 8h） | 否 |
| `API_PORT` | API 监听端口（默认 3001） | 否 |
| `APP_ENV` | 环境标识 | 否 |
| `APP_BASE_URL` | 应用基础 URL | 否 |
| `API_PREFIX` | API 路由前缀 | 否（代码中未使用） |

**外部依赖**：
- **飞书开放平台**：自建应用（需管理员审批权限），包括网页应用、机器人、卡片、多维表格 API、任务 API、日历 API
- **PostgreSQL 15**：中心主档
- **Redis 7**：幂等缓存、分布式锁（M1 代码中已引入 ioredis 但尚未使用）

---

# 仓库结构

## 顶层目录说明

```
leader-sync/
├── apps/
│   ├── api/              ← NestJS 后端（端口 3001）
│   └── web/              ← Next.js 前端（端口 3000）
├── packages/
│   ├── shared-types/     ← 枚举、DTO、API 响应类型（纯类型，无运行时依赖）
│   └── domain-core/      ← 状态机、UID 生成器（核心业务规则）
├── db/
│   ├── src/schema/       ← Drizzle ORM schema（9 张表）
│   ├── seed/             ← 开发测试数据
│   └── drizzle.config.ts
├── docs/                 ← 32 份设计文档 + 2 份实现计划
├── CLAUDE.md             ← 项目总原则（4 条治理原则 + 编码规则）
├── README.md             ← 文档导航
├── docker-compose.yml    ← PG + Redis 本地开发
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**计划中但尚未创建的模块**（M2+）：
- `packages/sync-engine` — 同步引擎（字段主权、冲突处理、幂等、防循环回写）
- `packages/feishu-sdk-wrapper` — 飞书 API 封装（token 管理、多维表格/任务/日历读写）
- `apps/worker` — 定时任务（周提醒、月结、对账补偿）

## 核心模块说明

### `packages/shared-types`
纯 TypeScript 类型包，无运行时依赖。定义了 9 个枚举对象（TaskType、Priority、AssignmentType、TaskStatus、SyncStatus、SourceType、RoleScope、ConflictResolutionStatus、UserRole）、6 个 DTO 接口（CreateTaskDto、UpdateTaskDto 等）、API 响应信封类型、错误码常量。**所有枚举使用 `as const` 对象模式**，不使用 TypeScript enum。

### `packages/domain-core`
核心业务规则包。当前包含：
- **状态机**（`task-state-machine.ts`）：定义 13 条合法状态转换、`canTransition()` 和 `validateTransition()` 函数、自定义异常类 `InvalidTransitionError` 和 `MissingBlockedReasonError`
- **UID 生成器**（`task-uid.ts`）：基于 nanoid，生成 `task_`/`log_`/`snap_` 前缀的 ID
- 28 个单元测试全部通过

### `db`
Drizzle ORM schema 定义包。包含 9 张表的完整 schema（严格对齐 `docs/07-architecture/db-schema.md`），以及 `createDb()` 连接工厂。**尚未生成 migration 文件**（`db/migrations/` 目录不存在）。

### `apps/api`
NestJS 后端，包含：
- **通用中间件**：TraceIdInterceptor（请求级 trace_id）、ResponseInterceptor（统一响应信封）、HttpExceptionFilter（错误码映射）、AuthGuard（cookie JWT 校验）、BusinessException（带业务错误码的异常）
- **Auth 模块**：飞书 JS-SDK 免登 + OAuth 回调，FeishuAuthService（飞书 API 调用）、AuthService（JWT 签发、org_cache upsert）。4 个单元测试通过。
- **Task 模块**：7 个 REST 端点（CRUD + assign/complete/delay + listMyTasks），TaskRepository（Drizzle 查询封装）、TaskService（业务逻辑 + 状态机 + 乐观锁 + 进展日志）。8 个单元测试通过。
- **Health 模块**：`/healthz`（存活检查）、`/readyz`（DB 连接检查）

### `apps/web`
Next.js 15 App Router 前端，包含：
- 4 个页面：登录回调（`/auth/callback`）、任务列表（`/tasks`）、任务详情（`/tasks/[task_uid]`）、新建任务（`/tasks/create`）
- SWR hooks（`useTasks`、`useTask`）、API 客户端（`apiFetch`）、飞书环境检测（`isFeishuEnv`）、认证流程编排（`ensureAuth`）
- 纯 Tailwind CSS 样式（未引入 shadcn/ui）
- Next.js rewrites 将 `/api/*` 代理到后端 3001 端口

## 关键入口文件

| 文件 | 作用 |
|---|---|
| `apps/api/src/main.ts` | NestJS 应用启动入口 |
| `apps/api/src/app.module.ts` | 根模块（注册所有模块和全局中间件） |
| `apps/api/src/database.module.ts` | 全局数据库 Provider（Drizzle 实例） |
| `apps/web/src/app/layout.tsx` | Next.js 根布局 |
| `apps/web/src/app/page.tsx` | 首页（重定向到 /tasks） |
| `db/src/connection.ts` | Drizzle 数据库连接工厂 |
| `db/src/schema/index.ts` | 所有表 schema 的 barrel export |

---

# 当前架构

## 系统分层

```
┌─────────────────────────────────────────────┐
│  飞书生态（外部系统）                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ 多维表格 │ │ 飞书任务 │ │ 飞书日历 │       │
│  └────┬────┘ └────┬────┘ └────┬────┘       │
│       │           │           │             │
│  ┌────┴───────────┴───────────┴────┐        │
│  │       飞书卡片 / 机器人          │        │
│  └──────────────┬──────────────────┘        │
│                 │ 回调 / 事件                │
│  ┌──────────────┴──────────────────┐        │
│  │  飞书工作台网页应用 (H5)         │        │
│  └──────────────┬──────────────────┘        │
└─────────────────┼───────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │      Next.js Web (3000)   │  ← 前端层
    │  (代理 /api/* → 3001)     │
    └─────────────┬─────────────┘
                  │ REST API
    ┌─────────────┼─────────────┐
    │      NestJS API (3001)    │  ← 服务层
    │  ┌───────────────────┐    │
    │  │ Auth Module        │   │  飞书登录 + JWT
    │  │ Task Module        │   │  任务 CRUD + 状态机
    │  │ Health Module      │   │  健康检查
    │  └───────────────────┘    │
    │  ┌───────────────────┐    │
    │  │ Common Middleware  │   │  TraceId / Response / Exception / AuthGuard
    │  └───────────────────┘    │
    └─────────────┬─────────────┘
                  │
    ┌─────────────┼─────────────┐
    │    Packages (共享库)       │  ← 领域层
    │  ┌─────────────────────┐  │
    │  │ domain-core          │ │  状态机 + UID
    │  │ shared-types         │ │  枚举 + DTO
    │  └─────────────────────┘  │
    └─────────────┬─────────────┘
                  │
    ┌─────────────┼─────────────┐
    │     DB (Drizzle ORM)      │  ← 数据层
    │  PostgreSQL 15 + Redis 7  │
    └───────────────────────────┘
```

**尚不存在但文档已设计的层**：
- **Sync Engine**（`packages/sync-engine`）— 字段主权判断、冲突检测、幂等处理、防循环回写
- **Feishu SDK Wrapper**（`packages/feishu-sdk-wrapper`）— 飞书 API 统一封装
- **Worker**（`apps/worker`）— 定时任务（提醒、月结、对账）

## 模块之间的调用关系

```
apps/web ──(REST over HTTP)──▶ apps/api
                                  │
                     ┌────────────┼────────────┐
                     ▼            ▼            ▼
              domain-core    shared-types      db
                  │                            │
                  └──────────▶ shared-types    │
                                               │
                                          PostgreSQL
```

**依赖规则**（来自 `module-boundaries.md`）：
- `web` → 只能调 `api`（通过 HTTP），禁止直接访问 DB 或飞书 API
- `api` → 可调 `domain-core`、`sync-engine`（未创建）、`feishu-sdk-wrapper`（未创建）、`shared-types`、`db`
- `worker`（未创建）→ 同上
- `sync-engine` → 可调 `domain-core`、`shared-types`
- `feishu-sdk-wrapper` → 只可调 `shared-types`
- `shared-types` → 无依赖

## 关键数据流

### 创建任务
```
用户 → Next.js (POST /api/v1/tasks)
     → NestJS TaskController
     → TaskService.createTask()
       ├── generateTaskUid()
       ├── 查 org_cache 获取负责人信息
       ├── 自动填充系统字段（issuer、assigner、month_bucket、version=1）
       ├── INSERT task 表
       └── INSERT task_progress_log（审计日志）
     → 返回 { code: 0, data: task }
```

### 更新任务（带乐观锁）
```
用户 → PATCH /api/v1/tasks/:uid { version: N, status: "done" }
     → TaskService.updateTask()
       ├── 查当前任务
       ├── validateTransition(current_status → "done")  // domain-core 状态机
       ├── UPDATE task SET ... WHERE task_uid = :uid AND version = N
       │   └── 返回 0 行 → 抛 BusinessException(1009, "Version conflict", 409)
       │   └── 返回 1 行 → version 自动 +1
       └── INSERT task_progress_log
```

### 飞书登录
```
飞书工作台 H5:
  前端 JS-SDK → tt.login() → code
  → POST /auth/feishu/jsapi-auth { code }
  → FeishuAuthService.getUserAccessToken(code) → Feishu API
  → FeishuAuthService.getUserInfo(token) → Feishu API
  → UPSERT org_cache
  → 查 user_role_binding（默认 employee）
  → JwtService.signAsync(payload)
  → Set-Cookie: token=<jwt>; httpOnly; secure; sameSite=lax; maxAge=8h

浏览器 OAuth:
  重定向 → Feishu 授权页 → 回调 /auth/feishu/callback?code=xxx
  → 同上流程 → Set-Cookie → 302 重定向到 /tasks
```

### 任务状态机（domain-core）
```
draft → assigned → in_progress → pending_review → done → closed
                 ↘ blocked (需 blocked_reason) ↗     ↘ reopened → in_progress
                 ↘ cancelled → closed
                 ↘ done（直接完成）
```
9 个状态、13 条合法转换路径。`closed` 是终态。

## 数据存储方案

**PostgreSQL 9 张表**（完整 schema 在 `db/src/schema/` 中定义，尚未 migrate 到数据库）：

| 表名 | 用途 | 关键字段 |
|---|---|---|
| `task` | 任务主表（40+ 列） | task_uid (UNIQUE), status, version (乐观锁), month_bucket, deleted_at (软删除) |
| `task_progress_log` | 进展审计日志 | log_uid, task_uid, old_status, new_status, source_type |
| `external_mapping` | 外部系统映射 | task_uid + source_type (UNIQUE), external_object_id, sync_status |
| `inbound_event` | 外部回调事件存储 | source_event_id (UNIQUE, 幂等键), payload (JSONB) |
| `sync_log` | 同步操作日志 | task_uid, direction (inbound/outbound), sync_status |
| `sync_conflict` | 同步冲突记录 | task_uid, field_name, local_value, remote_value, resolution_status |
| `monthly_snapshot` | 月结快照 | snapshot_uid, snapshot_run_id, snapshot_version, is_latest, done_rate |
| `user_role_binding` | 用户角色绑定 | user_id, role |
| `org_cache` | 飞书组织架构缓存 | user_id (UNIQUE), user_name, dept_id, manager_user_id |

## 与第三方系统的集成点

| 集成对象 | 当前状态 | 集成方式 |
|---|---|---|
| 飞书登录（OAuth + JS-SDK） | M1 已实现 | REST API 调用飞书开放平台 |
| 飞书多维表格（Bitable） | M2 计划 | 事件回调 + API 读写 |
| 飞书任务 | M3 计划 | API 写入 + 定时对账（**非实时回调**，因原生任务变更回调能力待确认） |
| 飞书日历 | M5 计划 | 事件回调 + API 读写 |
| 飞书卡片 / 机器人 | M3 计划 | 卡片交互回调 + 消息推送 |

**关键待确认**：飞书任务侧是否支持原生变更回调（事件订阅文档明确标注为"待评估"）。当前方案是 API 轮询 + 15 分钟周期对账。

---

# 现状问题

## 1. FeishuAuthService 的 token 缓存不支持多实例部署

**文件**：`apps/api/src/modules/auth/feishu-auth.service.ts`
**现象**：`appAccessToken` 和 `tokenExpiresAt` 存储在实例内存中。如果部署多个 API 实例（负载均衡），每个实例独立缓存、独立刷新 token，会产生不必要的 API 调用和潜在的 token 竞争。
**建议**：app_access_token 应存入 Redis，共享过期时间。

## 2. Redis 已引入依赖但未使用

**文件**：`apps/api/package.json`（依赖 `ioredis`）、`database.module.ts`（只有 PG provider）
**现象**：`ioredis` 在 package.json 中声明为依赖，但没有任何模块创建 Redis 连接或 Provider。`/readyz` 健康检查只验证了 DB，未验证 Redis。文档规划中 Redis 负责幂等缓存和分布式锁。
**影响**：M2 开始需要 Redis 时，缺少基础设施模块。

## 3. 前端类型安全缺失

**文件**：`apps/web/src/hooks/use-tasks.ts`、`use-task.ts`、所有页面组件
**现象**：SWR hooks 返回 `any` 类型。页面组件中大量使用 `(t: any)` 和双字段名兼容模式（`t.task_uid || t.taskUid`），说明 API 响应的字段命名约定（snake_case vs camelCase）未确定。
**影响**：类型安全完全丧失，编译期无法捕获字段名拼写错误。

## 4. API 响应字段命名未统一

**文件**：`apps/api/src/modules/task/task.repository.ts`
**现象**：Drizzle ORM 返回的字段是 camelCase（如 `taskUid`、`dueAt`），但 DTO 和前端部分代码期望 snake_case（`task_uid`、`due_at`）。当前没有 response serialization 层做转换。前端被迫写 `t.task_uid || t.taskUid` 这样的兼容代码。
**建议**：需要决定 API 对外输出使用 snake_case 还是 camelCase，并在 ResponseInterceptor 或 serializer 层统一处理。

## 5. OAuth 回调存在开放重定向风险

**文件**：`apps/api/src/modules/auth/auth.controller.ts` 第 `oauthCallback` 方法
**现象**：`redirect` query 参数直接用于 `res.redirect(redirect || '/tasks')`，未校验是否为合法的内部路径。攻击者可以构造 `?redirect=https://evil.com` 进行钓鱼。
**修复**：校验 redirect 必须以 `/` 开头且不包含 `//`。

## 6. 布尔字段命名不符合 CLAUDE.md 规范

**文件**：`db/src/schema/task.ts`、`external-mapping.ts`、`monthly-snapshot.ts`
**现象**：CLAUDE.md 规定布尔字段统一使用 `is_`/`has_`/`should_` 前缀。但以下字段违反规范：
- `boss_attention_flag`（应为 `is_boss_attention` 或保持现状但需豁免说明）
- `monthly_commitment_flag`
- `monthly_close_locked`（应为 `is_monthly_close_locked`）
- `conflict_flag`（应为 `is_conflict`）
- `archived_flag`（应为 `is_archived`）
**影响**：命名不一致会在字段主权判断和同步映射时产生混乱。

## 7. user_role_binding 缺少唯一约束

**文件**：`db/src/schema/user-role-binding.ts`
**现象**：没有 `UNIQUE(user_id, role)` 约束。seed 脚本重复执行会插入重复的角色绑定。`AuthService.loginWithCode()` 只取 `roles[0]?.role`，多条记录时结果不确定。
**修复**：添加唯一约束 + upsert 处理。

## 8. seed 脚本不可重复执行

**文件**：`db/seed/index.ts`
**现象**：`orgCache` 的 insert 使用 `onConflictDoNothing`（可重复），但 `userRoleBinding` 和 `task` 的 insert 没有冲突处理。重复执行 seed 会报唯一键冲突错误。
**修复**：要么先 truncate，要么所有 insert 加 `onConflictDoNothing`。

## 9. DB migration 从未生成

**文件**：`db/migrations/`（不存在）
**现象**：schema 定义完整但 `drizzle-kit generate` 和 `drizzle-kit migrate` 从未执行。没有任何 migration 文件。
**影响**：首次部署时需要完整执行，但当前无法验证 schema 是否能正确生成。

## 10. API_PREFIX 环境变量未使用

**文件**：`.env.example` 定义了 `API_PREFIX=/api/v1`，但 `apps/api/src/main.ts` 中没有 `app.setGlobalPrefix()`。控制器中硬编码了 `@Controller('api/v1/...')`。
**影响**：如果需要更改 API 前缀，需要改所有控制器的装饰器。

## 11. sync-engine 模块边界已定义但代码完全空白

**文件**：`docs/07-architecture/module-boundaries.md` 定义了 `packages/sync-engine` 的职责
**现象**：同步引擎是整个系统最复杂的核心模块（字段主权判断、冲突检测、幂等校验、防循环回写），但目前没有任何代码骨架。M2 开始就需要它，且它的设计决策会影响 Task Module 当前的数据写入模式。
**风险**：如果 sync-engine 的接口设计与当前 TaskService 的写入模式不兼容，M2 需要大规模重构。

## 12. ErrorCode 编号跳过了 1008

**文件**：`packages/shared-types/src/api.ts`
**现象**：错误码从 1007 直接跳到 1009，缺少 1008。
**影响**：轻微，但如果有团队规范应该记录原因或补齐。

---

# 架构调整目标

## 未来希望优化什么

1. **sync-engine 模块设计**：这是 M2-M5 的核心，需要在开始编码前完成详细架构设计，包括接口定义、与 TaskService 的交互模式、事件驱动 vs 命令式的选择
2. **API 响应字段命名统一**：确定 snake_case 或 camelCase，并实现自动转换层
3. **前端类型安全**：建立 API 响应类型定义，消除 `any`
4. **Worker 进程架构**：定时任务（提醒、月结、对账）的调度方式、与 API 进程的通信方式
5. **多实例部署能力**：Redis 基础设施模块、共享 token 缓存、分布式锁
6. **飞书任务侧双向同步的实现路径**：确认是否可用原生回调，还是必须走轮询对账

## 哪些约束不能破坏

1. **PostgreSQL 是唯一中心主档**：所有外部系统都是"投影"，不能把业务口径寄托在飞书侧
2. **所有跨系统写操作必须经过 sync-engine**：禁止 TaskService 或 Worker 直接写多个外部系统
3. **所有事件处理必须幂等**：`source_type + source_event_id` 去重
4. **月结逻辑必须可重复执行且结果稳定**：snapshot 支持重跑
5. **字段级主权规则**：不同字段有不同的编辑入口权限，不能全部开放
6. **文档先行原则**：任何字段/枚举/状态/同步规则变更必须先更新对应文档
7. **向后兼容**：M1 已有的 API 端点和数据模型在 M2+ 扩展时应尽量保持兼容
8. **低运维复杂度**：起步阶段单机 Docker Compose 部署，不引入 Kubernetes / 消息队列等重基础设施

---

# 需要 ChatGPT 帮忙的具体问题

## 问题 1：sync-engine 的模块接口应该如何设计？

当前 `TaskService` 直接操作 `TaskRepository` 写数据库。M2 开始，写操作需要经过 sync-engine 做字段主权判断和外部系统分发。需要设计：
- sync-engine 暴露给 api/worker 的接口形态（函数调用？事件发布？命令模式？）
- 它与 TaskService 的关系（TaskService 调 sync-engine，还是 sync-engine 调 TaskService？）
- 入站事件（外部回调）和出站同步（写外部系统）是否共享同一套管道

**参考文档**：`docs/03-sync/sync-field-authority.md`、`docs/07-architecture/module-boundaries.md`

## 问题 2：API 响应是用 snake_case 还是 camelCase？

当前 Drizzle ORM 返回 camelCase，DTO 定义和文档用 snake_case，前端两者都兼容。需要确定一个标准并实现转换层。这个选择会影响：
- 前端类型定义
- API 文档（OpenAPI）
- 外部系统回调数据格式

## 问题 3：Worker 进程应该如何组织？

`apps/worker` 需要承载多种定时任务（周提醒、临期提醒、月结、对账补偿、派生字段计算），需要设计：
- 单进程多 cron 还是多进程隔离？
- 与 API 进程共享哪些代码（domain-core、sync-engine、db）？
- 长时间运行的月结任务如何防止重复执行？
- 是否需要任务队列（BullMQ / 自研）还是简单的 node-cron 就够？

**参考文档**：`docs/01-product/monthly-close-rules.md`、`docs/01-product/notification-rules.md`

## 问题 4：飞书任务侧双向同步应采用什么实现策略？

文档中已明确：飞书任务原生变更回调能力"待确认"。当前计划是 API 写入 + 15 分钟周期对账。需要评估：
- 15 分钟延迟是否可接受？对用户体验的影响？
- 如果未来飞书开放了任务回调，如何平滑切换？
- 对账任务的全量 vs 增量策略？
- 对账时发现不一致，是自动修复还是标记冲突？

**参考文档**：`docs/06-feishu/event-subscriptions.md` 3.4 节、`docs/03-sync/sync-idempotency-policy.md`

## 问题 5：月结继承"新建记录"策略下，如何处理任务的历史追溯？

文档明确：继承到下月时新建一条记录，原记录不修改。这意味着一个长期未完成的任务会产生多条记录（每月一条）。需要设计：
- 老板驾驶舱查看"某件事从哪个月开始、拖了几个月"的查询方式
- `carried_from_task_uid` 链条的深度遍历性能
- 是否需要一个"任务链"或"任务根 ID"概念来简化查询？
- 月快照中继承任务的统计口径：是按原始任务还是按新记录？

**参考文档**：`docs/01-product/business-rules.md` 第 11 节、`docs/01-product/monthly-close-rules.md`

## 问题 6：当前 TaskService 的写入模式是否能平滑演进到 sync-engine？

`TaskService` 目前直接调 `TaskRepository.insert()` / `updateWithVersion()`。M2 之后所有写操作必须经过 sync-engine。需要评估：
- 是否需要在 M1 阶段就引入一个 "write coordinator" 抽象层？
- 还是等 M2 时重构 TaskService 的写入路径？
- 如果重构，影响范围多大？（当前 7 个端点都直接写库）

## 问题 7：前端是否需要引入全局状态管理？

当前前端用 SWR 做数据请求缓存，没有全局 store。随着页面增多（Leader 视图、老板驾驶舱），可能需要：
- 共享用户角色信息（影响按钮显隐）
- 跨页面的任务更新通知
- 是否需要 Zustand / Context？还是 SWR 的 mutate + revalidate 足够？

## 问题 8：权限系统应该在哪个层实现？

文档定义了详细的权限矩阵（5 个角色 × 14 种操作），当前代码中 `AuthGuard` 只做了"是否登录"检查，没有角色/权限验证。需要设计：
- 权限检查放在 Controller 层（装饰器）还是 Service 层？
- 行级可见性过滤（员工只看自己的任务）放在 Repository 层还是 Service 层？
- 是否需要 RBAC 中间件 / 权限守卫？

**参考文档**：`docs/05-permissions/permission-matrix.md`

---

# 附录

## 关键文件路径清单

### 配置文件
| 文件 | 用途 |
|---|---|
| `package.json` | 根工作区 |
| `pnpm-workspace.yaml` | pnpm 工作区定义 |
| `turbo.json` | Turborepo 任务管道 |
| `tsconfig.base.json` | 共享 TypeScript 基础配置 |
| `docker-compose.yml` | 本地 PG + Redis |
| `.env.example` | 环境变量模板 |
| `CLAUDE.md` | 项目总原则和治理规则 |

### 后端核心
| 文件 | 用途 |
|---|---|
| `apps/api/src/main.ts` | 应用入口 |
| `apps/api/src/app.module.ts` | 根模块 |
| `apps/api/src/database.module.ts` | DB Provider |
| `apps/api/src/modules/auth/auth.service.ts` | 认证业务逻辑 |
| `apps/api/src/modules/auth/feishu-auth.service.ts` | 飞书 API 调用 |
| `apps/api/src/modules/task/task.service.ts` | 任务业务逻辑 |
| `apps/api/src/modules/task/task.repository.ts` | 任务数据访问 |

### 前端核心
| 文件 | 用途 |
|---|---|
| `apps/web/src/app/layout.tsx` | 根布局 |
| `apps/web/src/app/tasks/page.tsx` | 任务列表 |
| `apps/web/src/app/tasks/[task_uid]/page.tsx` | 任务详情 |
| `apps/web/src/lib/api-client.ts` | API 请求封装 |
| `apps/web/src/lib/auth.ts` | 认证流程 |

### 数据层核心
| 文件 | 用途 |
|---|---|
| `db/src/schema/task.ts` | 任务表 schema（40+ 列） |
| `db/src/schema/external-mapping.ts` | 外部映射表 |
| `db/src/schema/monthly-snapshot.ts` | 月快照表 |
| `db/src/connection.ts` | Drizzle 连接工厂 |
| `db/seed/index.ts` | 测试数据 |

### 领域核心
| 文件 | 用途 |
|---|---|
| `packages/domain-core/src/task-state-machine.ts` | 状态机（13 条转换） |
| `packages/domain-core/src/task-uid.ts` | UID 生成器 |
| `packages/shared-types/src/enums.ts` | 9 个枚举定义 |
| `packages/shared-types/src/task.ts` | 6 个 DTO 接口 |
| `packages/shared-types/src/api.ts` | API 信封 + 错误码 |

### 设计文档（按主权分类）
| 主权 | 文件 |
|---|---|
| 业务语义 | `docs/02-data/field-dictionary.md` + `enum-dictionary.md` |
| 物理 schema | `docs/07-architecture/db-schema.md` |
| API 契约 | `docs/07-architecture/api-contracts.md` |
| 里程碑 | `docs/09-roadmap/milestone-plan.md` |
| 同步规则 | `docs/03-sync/sync-field-authority.md` |
| 状态机 | `docs/04-process/state-machine.md` |
| 权限 | `docs/05-permissions/permission-matrix.md` |

## 术语表

| 术语 | 含义 |
|---|---|
| 中心主档 | PostgreSQL 数据库，作为所有数据的唯一权威来源 |
| 外部投影 | 飞书多维表格/任务/日历，是中心主档的"镜像"展示和交互入口 |
| sync-engine | 同步引擎，负责中心主档与外部系统之间的双向数据同步 |
| 字段主权 | 每个字段有明确的"谁能改"规则，分为 A（系统只读）、B（业务结构）、C（执行状态）、D（时间承诺）、E（管理标记）5 类 |
| 乐观锁 | 基于 `version` 字段的并发控制，更新时 `WHERE version = N`，不匹配则返回 409 |
| 月结 | 每月初执行的统计作业，冻结上月口径、生成快照、创建继承任务 |
| 继承任务 | 上月未完成的任务在月结时新建一条记录到新月份，原记录不修改 |
| month_bucket | 任务的月份归属标识（格式 YYYY-MM），用于月结范围筛选 |
| 对账补偿 | 定时对比中心主档与外部系统的数据差异，自动修复不一致 |
| 幂等 | 同一操作执行多次结果不变，通过 `source_type + source_event_id` 去重 |
| Bitable | 飞书多维表格（类似 Airtable / Notion Database） |
| task_uid | 任务全局唯一标识，格式 `task_` + 16 位随机字符 |
| trace_id | 请求级追踪标识，格式 `tr_` + 12 位随机字符，贯穿整个请求链路日志 |
| PMO | 项目管理办公室 / 运营角色，负责月结维护、冲突处理、提醒配置 |
| JS-SDK 免登 | 飞书工作台 H5 应用内置的免密登录能力，通过 `tt.login()` 获取 code |
