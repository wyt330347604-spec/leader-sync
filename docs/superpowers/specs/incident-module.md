# 事故记录模块 设计文档

- **日期**: 2026-05-24
- **状态**: Confirmed（待确认清单已全部确认，可进入执行阶段）
- **范围**: 新增 `incident` 模块（DB + API + 前端），完全隔离，不修改任何现有表和路由
- **参考**: 精益画布 MVP 需求、`AI-HANDOFF.md §5-§7`、`docs/05-permissions/permission-matrix.md`

---

## 1. 问题诊断

### 1.1 为什么要做这个模块

当前系统只记录任务（Task）的执行进展，缺少对员工**违规行为、事故责任**的结构化留存渠道。主要痛点：

1. **管理盲区**：Leader 和 PMO 在飞书群里口头记录事故，无法统计、无法追溯。
2. **月度打分断层**：月结（`monthly-close`）快照只汇聚任务数据，若员工当月有重大事故，打分人无法自动感知，只能靠记忆补填。
3. **透明性缺失**：员工不知道针对自己存在什么记录，在申诉/绩效复盘时产生信息不对称。
4. **严重级别失控**：P0/P1 事故若没有"二次确认"机制，一人可随意生效，存在被滥用风险。

### 1.2 解决方案定位

- 新建独立的 `incident`（事故）模块，**不修改任何现有表**（`task`、`project`、`org_cache` 等）。
- 通过**软外键**引用 `task_uid`（可选关联），保持引用关系但不加数据库级外键约束，避免事故模块依赖 task 模块的生命周期。
- 月度打分视图增加"本月事故"聚合展示入口，作为非强制性的辅助信息层。

---

## 2. DB Schema

### 2.1 新增表：`incident`

```sql
CREATE TABLE incident (
  id            BIGSERIAL     PRIMARY KEY,
  incident_uid  VARCHAR(64)   NOT NULL,
  title         VARCHAR(500)  NOT NULL,
  description   TEXT,

  -- 严重程度：P0 / P1 / P2 / P3
  severity      VARCHAR(8)    NOT NULL,

  -- 记录人（发起人）
  reporter_user_id   VARCHAR(128) NOT NULL,
  reporter_name      VARCHAR(128) NOT NULL,

  -- 关联任务（可选，软引用 task.task_uid）
  related_task_uid   VARCHAR(64),

  -- 公司/组织 ID（预留多租户扩展）
  company_id         VARCHAR(64)  NOT NULL,

  -- P0/P1 二次确认机制
  -- pending_confirm = 待 PMO/Boss 确认
  -- confirmed       = 已确认生效
  -- rejected        = 被驳回（永不生效）
  confirm_status     VARCHAR(32)  NOT NULL DEFAULT 'confirmed',
  confirmed_by       VARCHAR(128),
  confirmed_at       TIMESTAMPTZ,
  reject_reason      TEXT,

  -- 事故发生日期（区别于 created_at 记录时间，支持跨月记录）
  incident_date DATE,

  -- 审计字段
  version      INTEGER      NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by   VARCHAR(128) NOT NULL,
  updated_by   VARCHAR(128),
  deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX uniq_incident_uid ON incident (incident_uid);
CREATE INDEX idx_incident_company_id ON incident (company_id);
CREATE INDEX idx_incident_severity ON incident (severity);
CREATE INDEX idx_incident_confirm_status ON incident (confirm_status);
CREATE INDEX idx_incident_created_at ON incident (created_at);
```

**字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `incident_uid` | varchar(64) | 业务主键，格式与 `task_uid` 一致（由 `domain-core` UID 生成器产生） |
| `severity` | varchar(8) | `P0` / `P1` / `P2` / `P3` |
| `reporter_user_id` | varchar(128) | 记录人 Feishu `open_id`，与 `org_cache.user_id` 对应 |
| `related_task_uid` | varchar(64) | 软引用，`task.task_uid`，可为空；不设 FK，task 删除不级联 |
| `company_id` | varchar(64) | 当前版本固定单租户，预留扩展 |
| `confirm_status` | varchar(32) | P2/P3 默认 `confirmed`；P0/P1 创建时强制为 `pending_confirm` |
| `confirmed_by` | varchar(128) | PMO 或 Boss 的 `user_id` |
| `confirmed_at` | timestamptz | 确认时间 |
| `incident_date` | date | 事故发生日期（可选），用于跨月记录场景；为空时以 `created_at` 月份作为归属月 |

### 2.2 新增表：`incident_user`（事故关联员工）

```sql
CREATE TABLE incident_user (
  id            BIGSERIAL    PRIMARY KEY,
  incident_uid  VARCHAR(64)  NOT NULL,
  user_id       VARCHAR(128) NOT NULL,
  user_name     VARCHAR(128) NOT NULL,

  -- 说明该员工在此事故中的角色
  -- involved = 涉及（默认）
  -- primary  = 主要责任人
  involvement   VARCHAR(32)  NOT NULL DEFAULT 'involved',

  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incident_user_incident_uid ON incident_user (incident_uid);
CREATE INDEX idx_incident_user_user_id ON incident_user (user_id);
-- 同一员工在同一事故中只能有一条记录
CREATE UNIQUE INDEX uniq_incident_user ON incident_user (incident_uid, user_id);
```

**字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `incident_uid` | varchar(64) | 外键引用 `incident.incident_uid`（逻辑 FK，不设数据库约束） |
| `user_id` | varchar(128) | 被涉及员工的 Feishu `open_id` |
| `involvement` | varchar(32) | `involved`（普通涉及）/ `primary`（主要责任人）|

### 2.3 隔离说明

- **不修改任何现有表**：`task`、`project`、`org_cache`、`task_leader`、`monthly_snapshot` 等均不变动。
- **不添加外键约束**：所有跨表引用（`related_task_uid`、`user_id`）均为软引用，防止事故模块与现有数据的生命周期耦合。
- **迁移文件命名**：`db/migrations/0004_add_incident_module.sql`，遵循现有手写 SQL 惯例。
- **Drizzle Schema 文件**：新建 `db/src/schema/incident.ts`，不修改 `task.ts`。

### 2.4 新增枚举（需登记到 `docs/02-data/enum-dictionary.md`）

| 枚举名 | 值 | 说明 |
|---|---|---|
| `IncidentSeverity` | `P0` / `P1` / `P2` / `P3` | P0=生产崩溃/重大财务损失；P1=严重违规（显著影响团队协作或业务进展）；P2=一般违规（需整改但不紧急）；P3=轻微问题（记录备案，不影响正常运营）|
| `IncidentConfirmStatus` | `pending_confirm` / `confirmed` / `rejected` | P0/P1 二次确认流程状态 |
| `IncidentInvolvement` | `involved` / `primary` | 员工在事故中的角色 |

> 枚举业务定义已确认（见上表）。

### 2.5 新增字段（需登记到 `docs/02-data/field-dictionary.md`）

| 字段名 | 所在表 | 含义 |
|---|---|---|
| `incident_uid` | `incident` | 事故业务主键 |
| `severity` | `incident` | 严重程度枚举 |
| `confirm_status` | `incident` | P0/P1 二次确认状态 |
| `related_task_uid` | `incident` | 关联任务软引用 |
| `incident_date` | `incident` | 事故发生日期，支持跨月记录（区别于 `created_at` 记录时间） |
| `involvement` | `incident_user` | 员工涉及程度（`primary` / `involved`） |

---

## 3. API 端点设计

### 3.1 基础规范

- **路由前缀**：`/api/v1/incidents`（全新前缀，与现有 `/tasks`、`/projects` 完全隔离）
- **认证**：全局 `AuthGuard`（复用现有 JWT cookie 机制）
- **响应格式**：复用现有 `{code, message, trace_id, data}` 信封
- **错误码扩展**：事故模块使用 1010-1012 区间（已确认）：`1010 INCIDENT_NOT_FOUND`、`1011 INCIDENT_ALREADY_CONFIRMED`（对已确认/驳回事故执行确认/驳回操作）、`1012 INCIDENT_PERMISSION_DENIED`（非 PMO/Boss 执行确认操作）

### 3.2 端点清单

#### POST `/api/v1/incidents` — 创建事故

**权限**：`UserRole.leader` 或 `UserRole.pmo`（基于 `user_role_binding` 表查询）

**Request Body**：
```json
{
  "title": "string (required)",
  "description": "string (optional)",
  "severity": "P0 | P1 | P2 | P3",
  "involved_user_ids": ["user_id_1", "user_id_2"],
  "related_task_uid": "string (optional)",
  "incident_date": "string (optional, YYYY-MM-DD)"
}
```

**服务端逻辑**：
1. 验证 `severity` 枚举值。
2. 验证 `involved_user_ids` 中每个 `user_id` 存在于 `org_cache`（防止悬空引用）。
3. 若 `related_task_uid` 不为空，验证该 task 存在且未软删除（`deleted_at IS NULL`）。
4. 生成 `incident_uid`（复用 `domain-core` UID 生成器，前缀 `inc_`）。
5. `company_id` 使用硬编码固定值（MVP 阶段单租户，JWT 中无此字段）。
6. 若 `severity` 为 `P0` 或 `P1`，强制设置 `confirm_status = 'pending_confirm'`；否则 `confirm_status = 'confirmed'`。
7. 若请求包含 `incident_date`，写入该字段；否则 `incident_date` 为 NULL，月份归属以 `created_at` 为准。
8. 写入 `incident` 表，再批量写入 `incident_user` 关联表。
9. 若 P0/P1 创建，异步发送飞书通知给 PMO（通知待确认）。
10. 返回完整事故对象（含 `confirm_status`）。

**Response `data`**：
```json
{
  "incident_uid": "inc_xxx",
  "title": "...",
  "severity": "P0",
  "confirm_status": "pending_confirm",
  "reporter_user_id": "ou_xxx",
  "reporter_name": "Harvey",
  "involved_users": [
    { "user_id": "ou_yyy", "user_name": "张三", "involvement": "involved" }
  ],
  "related_task_uid": null,
  "created_at": "2026-05-24T10:00:00+08:00"
}
```

---

#### GET `/api/v1/incidents` — 查询事故列表

**权限规则**（行级过滤）：

| 角色 | 可见范围 |
|---|---|
| `employee` | 仅查看 `incident_user.user_id = me` 的事故（与自己有关的记录） |
| `leader` | 自己记录的（`reporter_user_id = me`）+ 自己团队成员涉及的 |
| `pmo` / `boss` / `admin` | 全公司范围 |

**Query Parameters**：
```
severity        string   可选，过滤严重程度（P0/P1/P2/P3）
confirm_status  string   可选，过滤确认状态
month           string   可选，按月过滤（格式 YYYY-MM，对应 created_at 月份）
user_id         string   可选（pmo/boss），查看指定用户涉及的事故
page            number   默认 1
page_size       number   默认 20，最大 100
```

**Response `data`**：
```json
{
  "total": 42,
  "page": 1,
  "page_size": 20,
  "items": [ /* IncidentDto[] */ ]
}
```

---

#### GET `/api/v1/incidents/:incident_uid` — 查看事故详情

**权限**：遵循 GET list 同样的行级规则（有权限查看 list 中该条记录才可访问详情）。

**Response `data`**：完整 `IncidentDto`，含 `involved_users[]`。

---

#### PATCH `/api/v1/incidents/:incident_uid` — 编辑事故

**权限**：
- `reporter_user_id = me`（记录人本人）
- 或 `pmo` / `boss` 角色

**限制**：
- `confirm_status = 'confirmed'` 或 `'rejected'` 的事故，**不允许修改**（需新建或驳回后新建）。
- 不允许修改 `severity`（严重程度一旦确认不得降级，见待确认清单 §6.2）。

**Request Body**（可选字段）：
```json
{
  "title": "string",
  "description": "string",
  "involved_user_ids": ["..."],
  "related_task_uid": "string | null"
}
```

---

#### POST `/api/v1/incidents/:incident_uid/confirm` — 确认 P0/P1 事故生效

**权限**：`UserRole.pmo` 或 `UserRole.boss`

**前置条件**：`confirm_status = 'pending_confirm'`

**服务端逻辑**：
1. 验证 `confirm_status == 'pending_confirm'`，否则返回 `1011 INCIDENT_ALREADY_CONFIRMED`。
2. 更新 `confirm_status = 'confirmed'`，写入 `confirmed_by`、`confirmed_at`。
3. 异步发送飞书通知给涉及员工（通知 P0/P1 已确认生效）。
4. 返回更新后的 `IncidentDto`。

---

#### POST `/api/v1/incidents/:incident_uid/reject` — 驳回 P0/P1 事故

**权限**：`UserRole.pmo` 或 `UserRole.boss`

**Request Body**：
```json
{
  "reject_reason": "string (required)"
}
```

**服务端逻辑**：
1. 验证 `confirm_status == 'pending_confirm'`。
2. 更新 `confirm_status = 'rejected'`，写入 `reject_reason`。
3. 返回更新后的 `IncidentDto`。

---

#### DELETE `/api/v1/incidents/:incident_uid` — 软删除事故

**权限**：`reporter_user_id = me` 且 `confirm_status = 'pending_confirm'`；或 `pmo` / `boss` 任意状态可删。

**逻辑**：设置 `deleted_at = NOW()`，不物理删除。

---

#### GET `/api/v1/me/incidents` — 查看"我被记录的"事故

**权限**：任意登录用户

**说明**：透明性保护端点。员工可通过此接口查看所有涉及自己的事故（不论 `confirm_status`，以便及时了解 pending 状态的 P0/P1）。

**Query Parameters**：
```
month      string   可选，YYYY-MM
severity   string   可选
page / page_size
```

---

#### GET `/api/v1/users/:user_id/incidents/monthly-summary` — 月度事故聚合（月度打分辅助）

**权限**：`leader`（仅本团队员工）、`pmo`、`boss`

**Query Parameters**：
```
month   string   必填，YYYY-MM
```

**Response `data`**：
```json
{
  "user_id": "ou_xxx",
  "user_name": "张三",
  "month": "2026-05",
  "total": 3,
  "by_severity": {
    "P0": 0, "P1": 1, "P2": 2, "P3": 0
  },
  "incidents": [ /* IncidentDto[] */ ]
}
```

---

### 3.3 NestJS 模块结构（新增，不修改现有模块）

```
apps/api/src/modules/incident/
├── incident.module.ts
├── incident.controller.ts
├── incident.service.ts
├── incident.repository.ts
├── dto/
│   ├── create-incident.dto.ts
│   ├── update-incident.dto.ts
│   ├── confirm-incident.dto.ts
│   └── reject-incident.dto.ts
└── incident.service.spec.ts
```

---

## 4. 前端路由和页面

### 4.1 新增路由（`apps/web/src/app/`）

| 路由 | 文件 | 说明 |
|---|---|---|
| `/incidents` | `incidents/page.tsx` | 事故列表（Leader/PMO/Boss 管理视图） |
| `/incidents/create` | `incidents/create/page.tsx` | 新建事故表单 |
| `/incidents/[incident_uid]` | `incidents/[incident_uid]/page.tsx` | 事故详情 + 确认/驳回操作 |
| `/me/incidents` | `me/incidents/page.tsx` | 员工自查视图（"我的事故记录"） |

### 4.2 入口位置

- **顶部导航（`top-nav.tsx`）**：在 Leader/PMO/Boss 角色下，导航栏增加"事故"入口（`/incidents`）；employee 角色导航栏增加"我的记录"入口（`/me/incidents`）。
- **员工详情页**（未来月度打分场景）：在打分界面内嵌调用 `/api/v1/users/:user_id/incidents/monthly-summary`，作为辅助信息 panel 展示，不破坏现有任务视图。

### 4.3 页面说明

#### `/incidents`（事故列表）

- 筛选栏：严重程度（P0～P3 多选）/ 确认状态 / 月份选择器
- 列表字段：标题 / 严重程度 badge / 涉及员工（头像组）/ 记录人 / 确认状态 / 创建时间
- P0/P1 且 `pending_confirm` 的记录高亮提示（PMO/Boss 需要及时处理）
- 点击行进入详情页

#### `/incidents/create`（新建事故）

- 表单字段：标题（必填）/ 描述 / 严重程度（必填，下拉）/ 涉及员工（多选 Combobox，复用现有 `combobox.tsx`）/ 关联任务（可选，Combobox 检索 `task_uid`）
- P0/P1 提交时展示警示提示："此事故将进入待确认状态，需 PMO 或 Boss 确认后生效"
- 提交成功后跳转详情页

#### `/incidents/[incident_uid]`（事故详情）

- 展示完整事故信息
- 若 `confirm_status = 'pending_confirm'`：PMO/Boss 角色显示「确认生效」和「驳回」按钮
- 若 `confirm_status = 'rejected'`：展示驳回理由（只读）
- 记录人或 PMO 可进入编辑态（严重程度字段置灰不可改）

#### `/me/incidents`（员工自查）

- 员工视角：仅展示自己涉及的事故列表
- 按月分组展示，可筛选月份
- 告知员工"如对记录有异议，请联系直属 Leader 或 PMO"（静态文案，线下处理，系统不设申诉流程）

### 4.4 新增组件

```
apps/web/src/components/
├── incident-severity-badge.tsx   # P0/P1/P2/P3 颜色 badge（仿 status-badge.tsx）
└── incident-confirm-dialog.tsx   # 确认/驳回操作 modal（复用 alert-dialog.tsx）
```

---

## 5. 隔离方案

### 5.1 数据库层隔离

| 隔离措施 | 具体做法 |
|---|---|
| 新建独立表 | `incident`、`incident_user` 为全新表，不修改现有表结构 |
| 软引用（无 FK 约束） | `related_task_uid` 和 `incident_user.user_id` 不设数据库外键，避免 task 软删除影响事故记录完整性 |
| 独立迁移文件 | `db/migrations/0004_add_incident_module.sql`，可独立回滚（DROP TABLE 即可） |
| 独立 Drizzle Schema | `db/src/schema/incident.ts`，不修改 `task.ts` |

### 5.2 API 层隔离

| 隔离措施 | 具体做法 |
|---|---|
| 独立路由前缀 | `/api/v1/incidents`，与 `/tasks`、`/projects` 无交集 |
| 独立 NestJS 模块 | `IncidentModule` 不 import 现有 `TaskModule` 或 `ProjectModule` |
| 只读引用 task 数据 | 创建事故时验证 `related_task_uid`，只执行 `SELECT`，不写入 `task` 表 |
| 独立 Repository | `IncidentRepository` 仅操作 `incident`、`incident_user` 两张表 |

### 5.3 前端层隔离

| 隔离措施 | 具体做法 |
|---|---|
| 独立路由组 | `/incidents/*` 和 `/me/incidents` 不复用任务页面的状态或数据 |
| 独立 API 调用 | 只调用 `/api/v1/incidents/*` 端点 |
| 顶部导航改动最小化 | 仅在 `top-nav.tsx` 增加条件渲染的导航项，不改变现有导航项顺序和逻辑 |

### 5.4 月结/Worker 层隔离

- **当前阶段**：月度事故聚合通过 API 端点 `GET /api/v1/users/:user_id/incidents/monthly-summary` 按需拉取，**不修改 `monthly-close` worker**。
- **后续阶段**（如需将事故数据冻结进 `monthly_snapshot`）：作为独立需求单独设计，本文档不包含此演进。
- **绩效评分数据**：事故模块不同步数据回 Bitable，绩效评分数据也不同步回 Bitable。

### 5.5 飞书通知（MVP 已确认需要）

以下事件触发飞书通知（异步发送，不影响 API 响应）：

| 事件 | 通知对象 | 通知内容 |
|---|---|---|
| P0/P1 事故创建 | PMO 角色全员 | 「新 P0/P1 事故待确认」+事故标题+记录人+[前往确认]按钮 |
| P0/P1 事故被确认生效 | 涉及员工（`incident_user` 全部） | 「事故记录已确认」+事故标题+严重程度 |

**实现方式**：在 `IncidentService` 的 `createIncident` 和 `confirmIncident` 方法完成数据库写入后，调用 `FeishuNotificationService`（复用现有飞书卡片发送能力）异步推送，失败时只记录 warn 日志，不影响主流程。

---

## 5.6 设计原则

**单页信息接收合理量原则**：默认展示最相关的核心信息，次级信息需要主动展开。

- 事故列表页：默认展示标题、严重程度、涉及员工（头像组）、确认状态；详细描述、驳回理由等次级信息在详情页展示。
- 员工自查页：按月分组，默认折叠历史月份，只展开当月。

---

## 6. 已确认决策清单

以下事项已与项目负责人（Harvey）确认，文档状态更新为 Confirmed。

| # | 问题 | 决策结果 |
|---|---|---|
| 6.1 | P0/P1/P2/P3 严重程度定义 | **已确认**：P0=生产崩溃/重大财损；P1=严重违规；P2=一般违规；P3=轻微（见 §2.4 枚举） |
| 6.2 | `severity` 字段是否允许修改 | **已确认，选项 B**：一经创建不可修改（只能删除重建） |
| 6.3 | `involvement` 字段是否必要 | **已确认，选项 A**：保留 `primary` / `involved` 区分 |
| 6.4 | 员工申诉机制 | **已确认，选项 A**：只用静态文案"如有异议请联系 Leader 或 PMO"，线下处理，不建系统申诉流程 |
| 6.5 | `pending_confirm` 对员工是否可见 | **已确认，选项 A**：全程可见（透明度优先） |
| 6.6 | 错误码扩展约定 | **已确认**：使用 1010-1012 区间（`INCIDENT_NOT_FOUND` / `INCIDENT_ALREADY_CONFIRMED` / `INCIDENT_PERMISSION_DENIED`） |
| 6.7 | `company_id` 实际值 | **已确认**：JWT 无此字段，MVP 阶段硬编码固定值 |
| 6.8 | 飞书通知机制 | **已确认，需要**：P0/P1 创建时通知 PMO；P0/P1 确认后通知涉及员工（见 §5.5） |
| 6.9 | 跨月记录归属 | **已确认**：新增 `incident_date` 字段（事故发生日期），为空时以 `created_at` 月份归属 |
| — | HR 角色 | **已确认**：用 PMO 角色代替，不新增 HR 角色 |
| — | Bitable 同步 | **已确认**：绩效评分数据不同步回 Bitable |

---

*文档状态：Confirmed — 可进入阶段 2（实施计划）。*
