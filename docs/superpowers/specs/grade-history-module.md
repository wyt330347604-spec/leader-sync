# 历史档案 + 职级展示模块 设计文档

- **日期**: 2026-05-24
- **状态**: Confirmed（待确认清单已全部确认，可进入执行阶段）
- **范围**: 职级管理体系 + 员工历史档案时间线（DB schema + API + 前端路由 + 权限）
- **参考**: AI-HANDOFF.md §5（域模型）、CLAUDE.md（治理规则）、`docs/05-permissions/permission-matrix.md`

---

## 1. 问题诊断

### 1.1 现状

当前系统缺少两类核心数据能力：

**职级维度缺失**

- `org_cache` 表只存储飞书同步来的组织结构字段（`user_id` / `open_id` / `user_name` / `dept_id` / `manager_user_id` 等），没有职级字段。
- 没有职级变更的审计链路，无法追溯"谁在何时、因什么原因被调级"。
- 员工、Leader、Boss 对职级的可见范围没有规则约束。

**历史档案缺失**

- 员工没有个人维度的纵向成长视图：入职以来每个月的任务完成情况、月度绩效分、关联事故都散落在各表，无法聚合呈现。
- `monthly_snapshot` 表目前只支持 `leader` / `company` 两个 `role_scope`，尚无 `employee` 维度的月结快照。
- 查档行为本身没有日志记录，导致精益画布 M2 指标（Boss 每周打开仪表盘 ≥ 1 次）无法量化。

### 1.2 目标

1. 建立 20 级职级体系（T4.0 → T8.3），支持职级变更审计链路。
2. 建立员工个人历史档案时间线，聚合月度任务 + 绩效分 + 事故数据。
3. 对查档行为进行结构化日志记录，为 M2 指标提供数据基础。
4. **强隔离原则**：所有新功能通过新增字段 / 新建表实现；不修改现有 `task`、`project`、`external_mapping` 等表的任何已有字段；`org_cache` 只新增字段，不修改现有字段。

---

## 2. 设计决策点（待确认）

下列决策点涉及业务语义，必须在进入执行阶段前由项目负责人确认。

| # | 决策点 | 备选方案 A | 备选方案 B | 当前倾向 |
|---|---|---|---|---|
| D1 | `changed_by` 记录谁操作职级变更 | 只记录 `user_id`（查字典时再 JOIN） | 同时冗余 `changed_by_name` | A（保持规范化） |
| D2 | `score_snapshot` 字段类型 | `jsonb`（灵活，可存多维评分） | `decimal` 单值（简单） | A（jsonb，为后续多维评分留空间） |
| D3 | `monthly_score` 的绩效分来源 | 纯手动录入（PMO/Boss 填写） | 系统自动计算（任务完成率 × 权重） | **A（手动录入，MVP 阶段）** |
| D4 | `incident` 表的事故类型枚举 | 只定义 `type` varchar，后续再加枚举 | 立即定义枚举（延期/事故/违规等） | **事故模块独立设计（见 incident-module.md）** |
| D5 | 员工个人页路由 | `/employees/:user_id` 独立路由 | `/dashboard/employee/:user_id` 挂在 dashboard 下 | **A（独立路由）** |
| D6 | 查档日志的保留期 | 永久保留 | 滚动保留 180 天 | **A（永久保留，用于 M2 指标验证）** |
| D7 | 职级是否允许降级 | 允许，`trigger_type` 记录降级原因 | 禁止降级（只允许升级 + 冻结） | **A（允许，三种触发类型：初始录入/半年度晋升/手动调整）** |
| D8 | `org_cache.current_grade` 初始值 | NULL（未设置过的员工无职级） | 系统默认填 `T4.0` | **A（NULL，上线前 Harvey/PMO 手动录入）** |

> **状态**：上表所有决策点已全部确认，可进入阶段 2（详细设计 + 实施计划）。

---

## 3. DB Schema

### 3.1 隔离原则（org_cache 新增字段）

`org_cache` 表新增一个字段。所有已有字段、索引、唯一约束**不变**，不影响 `sync-engine` 的飞书同步逻辑。

```sql
-- Migration: 0004_add_grade_to_org_cache.sql
ALTER TABLE org_cache
  ADD COLUMN current_grade VARCHAR(8);
-- 可为 NULL，表示该员工尚未分配职级
-- 格式约束: T4.0 / T4.1 / T4.2 / T4.3 / T5.0 ... T8.3
-- 约束由应用层校验（见 §5.2），不在 DB 层加 CHECK（枚举更新无需 migration）
```

**隔离保证**：
- `sync-engine` 的 `runSyncInbound` / `runSyncOutbound` 只写 `org_cache` 的已有字段（`user_id` / `open_id` / `user_name` / `dept_id` / `dept_name` / `manager_user_id` / `manager_name` / `synced_at`），不会碰 `current_grade`。
- 飞书通讯录 API 不同步职级，故不存在双向写冲突。

**Drizzle schema 变更**（`db/src/schema/org-cache.ts`）：

```typescript
// 仅在现有 orgCache 定义末尾追加一个字段
currentGrade: varchar('current_grade', { length: 8 }),
```

---

### 3.2 新表：grade_history（职级变更历史）

```sql
-- Migration: 0004_add_grade_to_org_cache.sql（同一个 migration 文件）
CREATE TABLE grade_history (
  id            BIGSERIAL PRIMARY KEY,
  record_uid    VARCHAR(64)  NOT NULL UNIQUE,          -- 业务主键，格式 gh_<nanoid>
  user_id       VARCHAR(128) NOT NULL,                 -- FK → org_cache.user_id（逻辑，不加 DB 外键）
  grade         VARCHAR(8)   NOT NULL,                 -- 变更后的职级，如 "T5.2"
  prev_grade    VARCHAR(8),                            -- 变更前职级（首次设定时为 NULL）
  changed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  changed_by    VARCHAR(128) NOT NULL,                 -- 操作人 user_id（Leader / Boss / PMO）
  trigger_type  VARCHAR(32)  NOT NULL,                 -- 见枚举 grade_trigger_type
  score_snapshot JSONB,                                -- 可选：触发变更时的绩效快照
  note          TEXT,                                  -- 可选备注
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grade_history_user_id     ON grade_history (user_id);
CREATE INDEX idx_grade_history_changed_at  ON grade_history (changed_at);
CREATE UNIQUE INDEX uniq_grade_history_uid ON grade_history (record_uid);
```

**枚举：`grade_trigger_type`**（在 `packages/shared-types/src/enums.ts` 新增）

MVP 阶段已确认三种触发类型：

```typescript
// 触发职级变更的原因类型（已确认：初始录入 / 半年度晋升 / 手动调整）
GradeTriggerType:
  initial_entry        // 初始录入（上线前 Harvey/PMO 手动填入存量员工职级）
  biannual_promotion   // 半年度晋升（常规晋升周期）
  manual_adjustment    // 手动调整（降级、纠错、特殊情况，需填写 note）
```

---

### 3.3 新表：monthly_score（月度绩效分）

此表专为历史档案的员工维度绩效分数而设，**与现有 `monthly_snapshot` 表平行，互不覆盖**。`monthly_snapshot` 聚合的是任务维度统计（leader / company scope）；`monthly_score` 聚合的是员工个人绩效评分（可由 PMO/Boss 手工录入或未来由系统计算）。

```sql
-- Migration: 0005_add_monthly_score_incident.sql
CREATE TABLE monthly_score (
  id           BIGSERIAL PRIMARY KEY,
  score_uid    VARCHAR(64)  NOT NULL UNIQUE,           -- 业务主键，格式 ms_<nanoid>
  user_id      VARCHAR(128) NOT NULL,
  score_month  VARCHAR(7)   NOT NULL,                  -- 'YYYY-MM'，与 task.month_bucket 对齐
  score        DECIMAL(5,2) NOT NULL,                  -- 0.00 – 100.00
  score_detail JSONB,                                  -- 可选，多维拆分（任务分/行为分/协作分等）
  graded_by    VARCHAR(128) NOT NULL,                  -- 录入人 user_id
  graded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  note         TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, score_month)                        -- 同一员工同一月只有一条评分
);

CREATE INDEX idx_monthly_score_user_month ON monthly_score (user_id, score_month);
```

---

### 3.4 新表：incident（关联事故 / 重大事件）

记录员工个人维度的事故或重大事件记录，用于历史档案时间线中的负向事件标记。

```sql
-- Migration: 0005_add_monthly_score_incident.sql（续）
CREATE TABLE incident (
  id            BIGSERIAL PRIMARY KEY,
  incident_uid  VARCHAR(64)  NOT NULL UNIQUE,          -- 业务主键，格式 inc_<nanoid>
  user_id       VARCHAR(128) NOT NULL,                 -- 涉及员工
  occurred_at   TIMESTAMPTZ  NOT NULL,                 -- 事故发生时间
  incident_type VARCHAR(32)  NOT NULL,                 -- 见枚举 incident_type（待 D4 确认后完善）
  title         VARCHAR(256) NOT NULL,
  detail        TEXT,
  severity      VARCHAR(16)  NOT NULL DEFAULT 'medium', -- low / medium / high / critical
  recorded_by   VARCHAR(128) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ                            -- 软删除
);

CREATE INDEX idx_incident_user_id     ON incident (user_id);
CREATE INDEX idx_incident_occurred_at ON incident (occurred_at);
```

---

### 3.5 新表：audit_access_log（查档行为日志）

记录"谁查看了谁的历史档案"，为 M2 指标（Boss 每周打开仪表盘 ≥ 1 次）提供数据基础。

```sql
-- Migration: 0006_add_audit_access_log.sql
CREATE TABLE audit_access_log (
  id           BIGSERIAL PRIMARY KEY,
  log_uid      VARCHAR(64)  NOT NULL UNIQUE,
  accessor_id  VARCHAR(128) NOT NULL,                  -- 查阅人 user_id
  target_id    VARCHAR(128) NOT NULL,                  -- 被查阅员工 user_id（查自己也记录）
  access_type  VARCHAR(32)  NOT NULL,                  -- employee_profile / grade_history / dashboard_boss
  accessed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip_address   VARCHAR(64),                            -- 可选，用于审计
  user_agent   TEXT                                    -- 可选
);

CREATE INDEX idx_audit_access_log_accessor  ON audit_access_log (accessor_id, accessed_at);
CREATE INDEX idx_audit_access_log_target    ON audit_access_log (target_id, accessed_at);
```

---

### 3.6 Schema 依赖关系（逻辑 FK，不加 DB 外键约束）

```
org_cache.user_id ──（被引用）──▶ grade_history.user_id
                               ▶ monthly_score.user_id
                               ▶ incident.user_id
                               ▶ audit_access_log.accessor_id
                               ▶ audit_access_log.target_id

task.assignee_user_id ──（聚合查询）──▶ 历史档案时间线（不建 FK，用 JOIN）
task_progress_log ──────────────────▶ 历史档案时间线（不建 FK，用 JOIN）
```

不建 DB 层外键的原因：与项目现有惯例一致（`org_cache` 也未被其他表以 FK 引用），避免 DDL 复杂度和跨表级联风险。

---

## 4. 历史档案数据聚合 API 设计

### 4.1 员工历史档案接口

#### `GET /api/v1/employees/:user_id/profile`

返回员工的完整历史档案数据，供前端时间线渲染使用。

**路径参数**：`user_id` — 目标员工的 `org_cache.user_id`

**权限**（见 §6）：
- 员工本人：可以访问自己
- Leader：可访问名下直属员工（`org_cache.manager_user_id = req.user.user_id`）
- Boss / PMO / Admin：可访问全员

**查询参数**：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `from_month` | `YYYY-MM` | 系统上线月（已确认：从上线日开始，不迁移历史数据） | 时间线起点 |
| `to_month` | `YYYY-MM` | 当前月 | 时间线终点 |

**响应体**（`data` 字段）：

```typescript
{
  user: {
    user_id: string;
    user_name: string;
    dept_name: string;
    manager_user_id: string;
    manager_name: string;
    current_grade: string | null;      // org_cache.current_grade
  };
  grade_history: Array<{
    record_uid: string;
    grade: string;
    prev_grade: string | null;
    changed_at: string;                // ISO 8601
    trigger_type: string;
    note: string | null;
  }>;
  monthly_timeline: Array<{
    month: string;                     // 'YYYY-MM'
    task_summary: {
      total: number;
      done: number;
      overdue: number;
      carry_over: number;
      done_rate: number;               // 0.0000 – 1.0000
    };
    score: number | null;              // monthly_score.score，未录入时为 null
    incidents: Array<{
      incident_uid: string;
      title: string;
      severity: string;
      occurred_at: string;
    }>;
  }>;
}
```

**task_summary 的聚合逻辑**（SQL 伪代码）：

```sql
SELECT
  month_bucket                                            AS month,
  COUNT(*)                                                AS total,
  COUNT(*) FILTER (WHERE status IN ('done','closed'))     AS done,
  COUNT(*) FILTER (WHERE is_overdue = true)               AS overdue,
  COUNT(*) FILTER (WHERE is_carried_over = true)          AS carry_over
FROM task
WHERE assignee_user_id = :user_id
  AND month_bucket BETWEEN :from_month AND :to_month
  AND deleted_at IS NULL
GROUP BY month_bucket
ORDER BY month_bucket ASC;
```

**副作用**：请求成功后，异步写入 `audit_access_log`（`access_type = 'employee_profile'`），不影响响应延迟。

---

#### `GET /api/v1/employees/:user_id/grade-history`

单独返回职级变更历史，供 Leader / Boss 做职级管理时使用（不含月度任务聚合，轻量）。

**响应体**：

```typescript
Array<{
  record_uid: string;
  grade: string;
  prev_grade: string | null;
  changed_at: string;
  changed_by: string;
  trigger_type: string;
  score_snapshot: Record<string, unknown> | null;
  note: string | null;
}>
```

---

#### `POST /api/v1/employees/:user_id/grade`

录入一条新的职级变更记录。同时更新 `org_cache.current_grade`（两步操作在同一数据库事务内）。

**权限**：仅 Boss / PMO / Admin（员工和 Leader 不可写）

**请求体**：

```typescript
{
  grade: string;                // 必填，格式 T{n}.{0-3}，如 "T5.2"
  trigger_type: GradeTriggerType;
  score_snapshot?: Record<string, unknown>;
  note?: string;
}
```

**响应**：新建的 `grade_history` 记录 + 更新后的 `org_cache.current_grade`

**格式校验**（应用层，正则）：`/^T[4-8]\.[0-3]$/`（T4.0-T8.3，共 20 级，已确认）

**`company_id`**：MVP 阶段硬编码固定值（JWT 无此字段）。

---

#### `POST /api/v1/employees/:user_id/monthly-score`

录入员工某月绩效分（UPSERT 语义，同一月允许覆盖）。

**权限**：仅 Boss / PMO（Leader 不可录入）

**请求体**：

```typescript
{
  score_month: string;          // 'YYYY-MM'，必须 <= 当前月
  score: number;                // 0 – 100
  score_detail?: Record<string, unknown>;
  note?: string;
}
```

---

#### `GET /api/v1/employees`

返回员工列表，用于 Leader/Boss 档案入口。

**权限**：
- Leader：返回自己名下直属员工（`manager_user_id = req.user.user_id`）
- Boss / PMO / Admin：返回全员

**查询参数**：`dept_id?`，`q?`（模糊搜索 `user_name`）

**响应**：

```typescript
Array<{
  user_id: string;
  user_name: string;
  dept_name: string;
  current_grade: string | null;
  manager_name: string;
}>
```

---

### 4.2 Boss 仪表盘访问日志接口

#### `POST /api/v1/audit/dashboard-access`

Boss 每次打开仪表盘页面时，前端主动调用此接口记录访问行为（用于 M2 指标）。

**请求体**：无（`accessor_id` 来自 JWT，`access_type = 'dashboard_boss'`，`target_id = accessor_id`）

**响应**：`{ logged: true }`

---

### 4.3 API 路由总览

```
GET    /api/v1/employees                              员工列表（Leader/Boss/PMO）
GET    /api/v1/employees/:user_id/profile             员工历史档案时间线
GET    /api/v1/employees/:user_id/grade-history       职级变更历史
POST   /api/v1/employees/:user_id/grade               录入职级变更（Boss/PMO/Admin）
POST   /api/v1/employees/:user_id/monthly-score       录入月度绩效分（Boss/PMO）
POST   /api/v1/audit/dashboard-access                 仪表盘访问日志
```

---

## 5. 前端路由

### 5.1 新增路由

| 路由 | 文件（待决策点 D5 确认） | 用途 |
|---|---|---|
| `/employees` | `apps/web/src/app/employees/page.tsx` | 员工列表入口（Leader 看下属 / Boss 看全员） |
| `/employees/[user_id]` | `apps/web/src/app/employees/[user_id]/page.tsx` | 员工个人历史档案页 |

> 备选方案 B（挂在 `/dashboard/employee/:user_id`）：路由结构与现有 `/dashboard` 页面共享导航，但耦合了 dashboard 的 boss-only 权限逻辑，需要额外处理 Leader 的访问场景，增加复杂度。倾向方案 A（独立路由）。

### 5.2 员工个人页面结构（`/employees/[user_id]`）

```
┌──────────────────────────────────────────────────────────┐
│  ← 返回    张三  T5.2   ·  研发部  ·  直属上级：Harvey    │  ← 顶部信息栏
│                                                          │
│  [职级历史]  2024-03 → T4.2  ···  2025-10 → T5.0 → T5.2  │  ← 职级时间轴
│                                                          │
│  [月度时间线]                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 2026-04  任务 12 完成 10  延期 1  绩效分 88         │  │
│  │          ■■■■■■■■■■░░  83.3%                        │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 2026-03  任务 9  完成 9   延期 0  绩效分 94          │  │
│  │          ■■■■■■■■■■■  100%                          │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 2026-02  任务 11 完成 8   延期 2  绩效分 79  ⚠ 事故 1│  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  [职级变更]（仅 Boss/PMO 显示录入按钮）                   │
└──────────────────────────────────────────────────────────┘
```

### 5.3 职级展示位置

除个人档案页外，职级在以下位置复用展示：

| 位置 | 展示形式 | 权限 |
|---|---|---|
| `/employees/[user_id]` 顶部 | `T5.2` chip（高亮色） | 本人 / Leader / Boss / PMO |
| `/employees` 列表行 | `current_grade` 列，可为空 | Leader / Boss / PMO |
| 任务详情页 `/tasks/[task_uid]` 负责人区域 | 小 badge（灰色，非主要信息） | 任何已登录用户 |

> 任务详情页的职级 badge 为只读展示，不需要额外权限判断（显示对所有登录用户可见）。职级信息通过 `/api/v1/auth/me` 或任务详情 API 的 `assignee` 字段扩展返回，避免额外请求。

---

## 6. 权限矩阵

### 6.1 职级相关权限

| 操作 | 员工（本人） | 员工（他人） | Leader（下属） | Leader（非下属） | Boss/PMO/Admin |
|---|---|---|---|---|---|
| 查看自己的 `current_grade` | ✅ | — | — | — | — |
| 查看下属 `current_grade` | — | ❌ | ✅ | ❌ | ✅ |
| 查看任意员工 `current_grade` | — | ❌ | ❌ | ❌ | ✅ |
| 查看自己的职级变更历史 | ✅ | — | — | — | — |
| 查看下属职级变更历史 | — | ❌ | ✅ | ❌ | ✅ |
| 录入职级变更（写操作） | ❌ | ❌ | ❌ | ❌ | ✅ |

### 6.2 历史档案权限

> 已确认：员工只能看自己（不可互看）；Leader 可看直属下属完整历史。

| 操作 | 员工（本人） | 员工（他人） | Leader（直属下属） | Leader（非下属） | Boss/PMO |
|---|---|---|---|---|---|
| 查看自己的历史档案 | ✅ | — | — | — | ✅ |
| 查看他人历史档案 | — | ❌ | ✅ | ❌ | ✅ |
| 查看任意员工历史档案 | — | ❌ | ❌ | ❌ | ✅ |
| 录入月度绩效分 | ❌ | ❌ | ❌ | ❌ | ✅（Boss/PMO only） |
| 录入事故记录 | ❌ | ❌ | ❌ | ❌ | ✅ |

### 6.3 "下属"判定规则

```
isSubordinate(targetUserId, requesterId) =
  org_cache WHERE user_id = targetUserId AND manager_user_id = requesterId
```

实现时直接 JOIN `org_cache`，不引入额外表。Leader 角色通过 `user_role_binding.role = 'leader'` 确认，再叠加 `manager_user_id` 判断层级。

### 6.4 API 层权限 Guard 逻辑

```
GET /employees/:user_id/profile：
  - 允许：req.user.user_id === user_id（本人）
  - 允许：org_cache[user_id].manager_user_id === req.user.user_id（直属 Leader）
  - 允许：req.user.role in ['boss', 'pmo', 'admin']
  - 其余：403

POST /employees/:user_id/grade：
  - 允许：req.user.role in ['boss', 'pmo', 'admin']
  - 其余：403

POST /employees/:user_id/monthly-score：
  - 允许：req.user.role in ['boss', 'pmo']
  - 其余：403
```

---

## 7. 隔离方案

### 7.1 org_cache 字段新增不破坏现有查询

**风险点**：`sync-engine` 的 `runSyncInbound` 和 `runSyncOutbound` 会 SELECT / UPDATE `org_cache`。新增列会影响以下场景：

| 场景 | 影响分析 | 结论 |
|---|---|---|
| `SELECT *` 查询 | 返回结果多一列 `current_grade` | 安全（额外列不破坏解构赋值，Drizzle 类型自动扩展） |
| `INSERT ... ON CONFLICT UPDATE` | 仅 UPDATE 已有字段 | 安全（`current_grade` 不在 UPDATE SET 列表中） |
| `UPDATE org_cache SET ... WHERE user_id = ?` | 需确认代码只写枚举字段 | **需人工检查 `sync-engine.ts` 的 UPDATE 语句** |
| Drizzle `orgCache` schema 对象 | 新增 `currentGrade` 属性 | 安全（纯新增，不改现有属性） |

**检查清单**（执行阶段前须验证）：
- [ ] `apps/worker/src/services/sync-engine.ts`：确认 `org_cache` 的 UPDATE 语句不包含 `current_grade`
- [ ] `apps/api`：全局搜索 `org_cache` 写操作，确认无意外写入 `current_grade`
- [ ] 新增 `current_grade` 列为 `NULL`，不加 `NOT NULL` 约束，保证现有行无需 backfill 即可通过迁移

### 7.2 新表与现有数据完全隔离

- `grade_history` / `monthly_score` / `incident` / `audit_access_log` 均为全新表，不与现有表建立 DB 外键。
- 新模块的 NestJS Module（`GradeModule` / `EmployeeModule`）独立于现有 `TaskModule` / `ProjectModule` / `DashboardModule`，不导入、不被导入。
- 新 API 路由前缀 `/employees` 和 `/audit` 与现有 `/tasks`、`/projects`、`/dashboard` 完全分离，不触发现有 Guard 或 Interceptor 变更。

### 7.3 monthly_score 与 monthly_snapshot 并存

| 表 | 用途 | 聚合维度 | 写入方 |
|---|---|---|---|
| `monthly_snapshot` | 现有月结快照，任务统计 | `leader` / `company` scope | `monthly-close` cron job |
| `monthly_score` | 员工个人绩效评分 | `employee` scope | Boss / PMO 手工录入（MVP） |

两表共存，互不影响。未来如需系统自动计算绩效分，可在 `monthly-close` job 中新增一个步骤，基于 `monthly_snapshot` 的 `doneRate` 等字段派生 `monthly_score`，但这属于 M2+ 范畴，当前 MVP 不实现。

---

## 8. Drizzle Schema 文件变更清单

| 文件 | 变更类型 | 内容 |
|---|---|---|
| `db/src/schema/org-cache.ts` | 新增字段 | `currentGrade: varchar('current_grade', { length: 8 })` |
| `db/src/schema/grade-history.ts` | 新建 | `gradeHistory` 表定义（见 §3.2） |
| `db/src/schema/monthly-score.ts` | 新建 | `monthlyScore` 表定义（见 §3.3） |
| `db/src/schema/incident.ts` | 新建 | `incident` 表定义（见 §3.4） |
| `db/src/schema/audit-access-log.ts` | 新建 | `auditAccessLog` 表定义（见 §3.5） |
| `db/src/schema/index.ts` | 新增 export | 导出上述 4 个新表 |
| `packages/shared-types/src/enums.ts` | 新增枚举 | `GradeTriggerType`、`IncidentType`（D4 确认后）、`IncidentSeverity`、`AccessType` |

---

## 9. 字典登记（CLAUDE.md 强制 — 执行阶段同步更新）

### 9.1 `field-dictionary.md` 新增条目

| 字段名 | 数据库表.列 | 类型 | 含义 | 来源 |
|---|---|---|---|---|
| `currentGrade` | `org_cache.current_grade` | string（T格式） | 员工当前职级，如 "T5.2" | Boss/PMO 手工录入 |
| `grade` | `grade_history.grade` | string | 职级变更后的级别 | 录入 |
| `prevGrade` | `grade_history.prev_grade` | string nullable | 变更前的职级 | 系统计算 |
| `triggerType` | `grade_history.trigger_type` | enum | 职级变更触发原因 | 录入 |
| `scoreSnapshot` | `grade_history.score_snapshot` | jsonb | 变更时的绩效快照 | 可选录入 |
| `scoreMonth` | `monthly_score.score_month` | string（YYYY-MM） | 绩效评分所属月 | 录入 |
| `score` | `monthly_score.score` | decimal(5,2) | 月度绩效分（0-100） | Boss/PMO 录入 |
| `occurredAt` | `incident.occurred_at` | timestamptz | 事故发生时间 | 录入 |
| `severity` | `incident.severity` | enum | 事故严重程度 | 录入 |
| `accessorId` | `audit_access_log.accessor_id` | string | 查阅操作人 user_id | 系统自动 |
| `targetId` | `audit_access_log.target_id` | string | 被查阅员工 user_id | 系统自动 |
| `accessType` | `audit_access_log.access_type` | enum | 查档类型 | 系统自动 |

### 9.2 `enum-dictionary.md` 新增枚举

```yaml
grade_trigger_type:
  initial_entry:       初始录入（上线前手动填入）
  biannual_promotion:  半年度晋升
  manual_adjustment:   手动调整（含降级/纠错/特殊情况）

incident_severity:
  low:      轻微
  medium:   一般
  high:     严重
  critical: 重大

audit_access_type:
  employee_profile:  查看员工历史档案
  grade_history:     查看职级变更历史
  dashboard_boss:    Boss 打开仪表盘

# incident_type: 待 D4 确认后补充
```

---

## 10. 测试计划（QC Protocol Red-Light-First 强制）

### 10.1 后端单测（Vitest）

`apps/api/src/modules/employee/employee.service.spec.ts`：
- [ ] `getProfile`：本人访问 → 200 + 正确聚合
- [ ] `getProfile`：Leader 访问直属下属 → 200
- [ ] `getProfile`：Leader 访问非下属 → 403
- [ ] `getProfile`：员工访问他人 → 403
- [ ] `createGradeChange`：格式 `T5.2` → 通过校验
- [ ] `createGradeChange`：格式 `T9.0` → 校验失败（超出 T4-T8 范围）
- [ ] `createGradeChange`：格式 `S5.2` → 校验失败
- [ ] `createGradeChange`：同步更新 `org_cache.current_grade`（事务）
- [ ] `createMonthlyScore`：同月 UPSERT → 覆盖旧值
- [ ] `createMonthlyScore`：score > 100 → 校验失败

### 10.2 后端 API 集成测试

`apps/api/src/modules/employee/employee.controller.e2e.ts`：
- [ ] `GET /employees/:user_id/profile`：boss 身份 → 200
- [ ] `POST /employees/:user_id/grade`：employee 身份 → 403
- [ ] 职级变更后 `GET /employees` 列表返回最新 `current_grade`

### 10.3 迁移回归测试

- [ ] `0004_add_grade_to_org_cache.sql` 可重复执行（`IF NOT EXISTS` 或 `ADD COLUMN IF NOT EXISTS`）
- [ ] 迁移后现有 `org_cache` 行的已有字段数据不变
- [ ] `sync-engine` 跑一次完整 `runSyncInbound` 后 `current_grade` 不被意外清空

### 10.4 前端单测（Vitest + RTL）

`apps/web/src/__tests__/employee-profile.test.tsx`：
- [ ] 月度时间线按 `month` 降序渲染（最新月在最上）
- [ ] `score = null` 时显示"未录入"而非 0
- [ ] 有事故的月份显示 ⚠ 图标
- [ ] 职级 chip 的颜色格式符合 T 格式（T4.x 用低阶色，T8.x 用高阶色）

### 10.5 权限矩阵回归测试

`apps/api/src/modules/employee/employee-permission.spec.ts`：
- [ ] 员工 A 不能查员工 B 的档案
- [ ] Leader（非直属）不能查无关员工的档案
- [ ] Boss 可以查任何员工的档案
- [ ] 只有 Boss/PMO 能录入职级变更
- [ ] 只有 Boss/PMO 能录入月度绩效分

---

## 11. 实施步骤（高层）

> 本节仅为高层计划，详细任务分解由 `writing-plans` skill 在 spec 通过 review 后生成。

1. **决策点 D1–D8 已全部确认**（见 §2 和 §13）— 可进入执行阶段
2. **DB migration 0004**：`org_cache` 新增 `current_grade` + `grade_history` 表
3. **DB migration 0005**：`monthly_score` + `incident` 表
4. **DB migration 0006**：`audit_access_log` 表
5. **更新字典文档**：`field-dictionary.md` + `enum-dictionary.md`（先于代码）
6. **后端 EmployeeModule**：Repository + Service + Controller + Guard + 单测
7. **后端 AuditModule**：`audit_access_log` 写入 Service
8. **前端 `/employees` 列表页** + 单测
9. **前端 `/employees/[user_id]` 档案页** + 单测
10. **Playwright e2e + Screenshot Audit**（CLAUDE.md 强制）
11. **dev DB 走通** → 准备生产迁移脚本
12. **生产部署**：先备份 DB → 顺序执行 migration 0004–0006 → rsync 部署

---

## 12. 风险与回滚

| 风险 | 缓解方案 |
|---|---|
| `org_cache` 字段新增触发 sync-engine 意外写入 | 执行阶段先审查 sync-engine.ts 所有 UPDATE 语句；新增 migration 回归测试 |
| `grade_history` 的 `changed_by` 录错操作人 | API 层从 JWT 解析 `req.user.user_id`，不接受客户端传入 `changed_by` |
| 职级格式校验旁路（直接 SQL 写入） | DB 层未加 CHECK 约束（等 D4 决策后可补），应用层正则为主要防线；PMO 录入权限隔离 |
| `monthly_score` 与 `monthly_snapshot` 混淆 | 两表用途注释清晰；`monthly_score` 无 `role_scope` 字段，结构上无法与 `monthly_snapshot` 混用 |
| `audit_access_log` 写入失败影响主路径 | 日志写入用 `try/catch` 包裹，失败只记录 warn 日志，不影响 API 响应 |
| 生产迁移顺序依赖 | migration 文件编号有序（0004 → 0005 → 0006），每次单独执行并验证 |

**回滚预案**：
- `ALTER TABLE org_cache DROP COLUMN current_grade`（列为 nullable，无数据依赖风险）
- `DROP TABLE grade_history / monthly_score / incident / audit_access_log`（新表，无外部依赖）
- 前端：`git revert` 新增路由的 commit

---

## 13. 已确认决策清单

以下问题已与项目负责人（Harvey）逐条确认，文档状态更新为 Confirmed。

| # | 问题 | 决策结果 |
|---|---|---|
| Q1 | `monthly_score.score` 录入方式 | **已确认**：MVP 阶段纯手工录入（Boss/PMO 填），不自动计算 |
| Q2 | `incident.incident_type` 枚举 | **已确认**：事故模块独立设计（见 incident-module.md），不在本模块定义 |
| Q3 | 员工个人页路由 | **已确认，选项 A**：`/employees/:user_id` 独立路由 |
| Q4 | `audit_access_log` 保留期 | **已确认，选项 A**：永久保留（用于 M2 指标验证） |
| Q5 | 职级是否允许降级 | **已确认**：允许；触发类型确认为三种：`initial_entry` / `biannual_promotion` / `manual_adjustment`（含降级场景） |
| Q6 | 存量员工 `current_grade` 初始值 | **已确认，选项 A**：上线前人工录入（Harvey/PMO 手动填入），初始为 NULL |
| Q7 | M2 指标记录粒度 | **已确认**：记录"打开员工档案"（`access_type = 'employee_profile'`），已在 §3.5 `audit_access_log` 表和 §4.1 API 副作用中实现 |
| Q8 | `changed_by` 冗余 | **已确认，选项 A**：只记 `user_id`，查字典时 JOIN `org_cache` |
| — | 员工互看 | **已确认**：只能看自己（不可互看他人档案） |
| — | Leader 查下属 | **已确认**：可查直属下属完整历史 |
| — | 历史追溯起点 | **已确认**：从系统上线日开始，不迁移历史数据 |
| — | 职级格式 | **已确认**：T4.0-T8.3，共 20 级 |
| — | company_id | **已确认**：JWT 无此字段，MVP 阶段硬编码固定值 |

---

## 14. 设计原则

**单页信息接收合理量原则**：默认展示最相关的核心信息，次级信息需要主动展开。

- 员工列表页（`/employees`）：默认展示姓名、部门、当前职级、直属上级；历史档案时间线在详情页展示。
- 员工档案页（`/employees/[user_id]`）：职级时间轴默认折叠旧记录，只展开最近 3 条；月度时间线默认展示最近 6 个月，更早历史需主动展开。
