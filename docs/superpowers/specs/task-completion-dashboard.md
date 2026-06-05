# 月度/周度任务完成看板 设计文档

- **日期**: 2026-05-24
- **状态**: Confirmed（待确认清单已全部确认，可进入阶段 2）
- **范围**: 新增 API 端点 + 扩展前端 /dashboard 页；不修改任何现有 task 数据结构和现有端点
- **参考文档**:
  - `docs/AI-HANDOFF.md` §5 / §6 / §7 / §8
  - `apps/api/src/modules/dashboard/dashboard.service.ts`（现有 boss dashboard 逻辑）
  - `db/src/schema/task.ts`（task 表 schema，只读）

---

## 1. 问题诊断

### 1.1 现状

现有 `/dashboard` 页（boss 视角）已支持：

- 全公司 `leaderSummary`：按 Leader 汇总 total / done / overdue / carryOver / riskCount / weeklyNewCount / doneRate
- 全公司 `personSummary`：按员工汇总同类指标 + 任务明细列表
- `projectSummary`：按项目汇总
- 月份 / 季度切换
- Gantt 图

现有 `GET /api/v1/dashboard/boss` 已返回足够细粒度的数据，但：

1. **Leader 视角缺失**：Leader 想看"我名下各员工本月完成情况"，目前 boss dashboard 包含全员，Leader 没有专属过滤入口。
2. **员工自视角缺失**：员工在任务列表页看不到"自己本月完成了多少条 / 完成率多少"的一屏汇总。
3. **周报缺完成率数据**：`runWeeklyReminder` 发送逾期数，但不发送当周新增数和完成数/完成率，Leader 收到的飞书卡片信息不足。
4. **Boss 全员概览需要按 Leader 分组下钻**：现有 boss dashboard 已有 `leaderSummary`，但前端还没有专属的"全员概览 tab"入口，也没有按 Leader 分组 → 点击展开成员明细的交互。

### 1.2 核心约束（来自 CLAUDE.md）

- **不修改现有 task 数据结构**：所有新功能仅做只读 SELECT，不新增字段、不改 schema。
- **不修改现有端点**：现有 `GET /dashboard/boss` / `GET /dashboard/gantt` 行为不变。
- **新端点只读**：不写 task / task_leader / org_cache 等业务表。
- **Document-first**：本文档确认后才能进入编码阶段。

---

## 2. 新增 API 端点

> 所有端点挂在现有 `DashboardController` 下，路径前缀 `/api/v1/dashboard`。
> 所有端点：只读 SELECT，无副作用，无需 DB 事务。
> Auth：复用全局 `AuthGuard`（JWT cookie）。
> 响应格式：统一封装 `{code: 0, message: "ok", trace_id: "tr_xxx", data: {...}}`。

### 2.1 GET /dashboard/leader/monthly

**用途**：Leader 月度看板 — 查询登录 Leader 名下所有员工某月的完成汇总。

**Query Params**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `month` | `string` (`YYYY-MM`) | 否 | 默认当月 |

**数据来源**：
- 从 `task` 表中查询 `month_bucket = :month AND deleted_at IS NULL`。
- Leader 身份判断：`task.leader_user_id = :currentUserId` UNION `task_leader.leader_user_id = :currentUserId`（复用现有 `getLeaderIdsForTask` 逻辑）。
- `done` 统计：`status = 'done'`（完成率分子只算 done 状态，已确认；shelved/closed 不计入分子）。
- `overdue` 统计：`is_overdue = true AND status NOT IN ('done','shelved','closed')`。
- `completion_rate`：`done_only / total * 100`（整数，四舍五入）。

**Response `data` Shape**：

```typescript
{
  month: string;                  // 'YYYY-MM'
  leaderId: string;
  leaderName: string;
  total: number;                  // 名下全员当月任务总数
  done: number;
  overdue: number;
  completionRate: number;         // 0-100 整数
  members: Array<{
    userId: string;
    name: string;
    total: number;
    done: number;
    overdue: number;
    completionRate: number;
  }>;
}
```

---

### 2.2 GET /dashboard/leader/monthly/:member_user_id/tasks

**用途**：Leader 下钻 — 查询某员工在指定月份的任务明细。

**Path Params**：`member_user_id` — 目标员工的 user_id。

**Query Params**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `month` | `string` (`YYYY-MM`) | 否 | 默认当月 |

**鉴权约束**：`member_user_id` 对应的 `task.leader_user_id` 或 `task_leader.leader_user_id` 中至少有一条等于当前登录用户，否则返回 `1002 NO_PERMISSION`。

**数据来源**：同上，过滤 `assignee_user_id = :member_user_id`。

**Response `data` Shape**：

```typescript
{
  month: string;
  userId: string;
  userName: string;
  summary: {
    total: number;
    done: number;
    overdue: number;
    completionRate: number;
  };
  tasks: Array<{
    taskUid: string;
    title: string;
    status: string;
    priority: string;
    dueAt: string | null;         // ISO string
    completedAt: string | null;
    isOverdue: boolean;
    progressPercent: number;
    bossAttentionFlag: boolean;
    delayCount: number;
    carryOverCount: number;
  }>;
}
```

---

### 2.3 GET /dashboard/leader/weekly

**用途**：Leader 周度看板 — 当周每个成员的任务进展（新增 / 完成 / 逾期）。

**Query Params**：无（固定返回"本周"，本周一 00:00 到本周日 23:59:59 Asia/Shanghai）。

**数据来源**：
- 新增：`created_at >= thisMonday AND deleted_at IS NULL` 且属于该 Leader 的任务
- 完成：`completed_at >= thisMonday AND status = 'done'`
- 逾期：`is_overdue = true AND status NOT IN ('done','shelved','closed')`
- 完成率：完成数 / (完成数 + 未完成数) * 100（本周截至统计时刻）

**Response `data` Shape**：

```typescript
{
  weekStart: string;              // 本周一 ISO string（Asia/Shanghai 00:00）
  weekEnd: string;                // 本周日 ISO string
  leaderId: string;
  leaderName: string;
  members: Array<{
    userId: string;
    name: string;
    newCount: number;             // 本周新增
    doneCount: number;            // 本周完成
    overdueCount: number;         // 当前逾期
    completionRate: number;       // 本周完成率（0-100）
  }>;
  teamSummary: {
    newCount: number;
    doneCount: number;
    overdueCount: number;
    completionRate: number;
  };
}
```

---

### 2.4 GET /dashboard/me/monthly

**用途**：员工自视角 — 当前登录员工在指定月份的完成汇总（单人）。

**Query Params**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `month` | `string` (`YYYY-MM`) | 否 | 默认当月 |

**数据来源**：`assignee_user_id = :currentUserId AND month_bucket = :month AND deleted_at IS NULL`。

**Response `data` Shape**：

```typescript
{
  month: string;
  userId: string;
  userName: string;
  total: number;
  done: number;
  inProgress: number;            // status = 'in_progress'
  overdue: number;
  completionRate: number;
  carriedOver: number;           // carry_over_count >= 1
  delayTotal: number;            // sum(delay_count) across all tasks
}
```

---

### 2.5 端点汇总（增量）

| 方法 | 路径 | 视角 | 说明 |
|---|---|---|---|
| GET | `/api/v1/dashboard/leader/monthly` | Leader | 月度团队完成汇总 |
| GET | `/api/v1/dashboard/leader/monthly/:member_user_id/tasks` | Leader | 成员任务下钻 |
| GET | `/api/v1/dashboard/leader/weekly` | Leader | 周度团队进展 |
| GET | `/api/v1/dashboard/me/monthly` | 员工 | 本人月度完成自查 |

现有端点（不修改）：

| 方法 | 路径 | 视角 |
|---|---|---|
| GET | `/api/v1/dashboard/boss` | Boss / 全员 |
| GET | `/api/v1/dashboard/gantt` | Boss / Gantt |

---

## 3. 前端路由和组件设计

### 3.1 入口策略

复用现有 `/dashboard` 页面，通过新增 Tab 扩展，而非新增顶级路由。理由：

- 现有顶部导航已有"Dashboard"入口，不增加导航复杂度。
- 数据源一致（task 表），同一页管理一个时间维度选择器可以复用。

### 3.2 Tab 架构（扩展现有 /dashboard/page.tsx）

现有页面没有显式 Tab 结构，所有内容是 boss 视角。本次改造在页面顶部新增 Tab Bar，原有内容成为 "Boss 全员" Tab。

```
/dashboard
├── Tab A: Boss 全员概览   (现有内容 + 按 Leader 分组下钻交互升级)
├── Tab B: 我的团队         (Leader 月度/周度看板，非 Leader 登录时灰显/隐藏)
└── Tab C: 我的完成情况     (员工自视角月度汇总，所有登录用户可见)
```

**Tab 显示规则（已确认）**：
- 默认激活 Tab：全员默认打开 Tab C「我的完成情况」；Leader/Boss 可切换到 Tab B（我的团队）或 Tab A（Boss 全员概览）。
- Tab A：所有角色均可见（员工也可浏览全员概览，符合现有逻辑）。
- Tab B：仅当当前用户作为 Leader 存在至少一条任务时显示（懒判断：首次加载 `GET /dashboard/leader/monthly` 返回 `total > 0` 则显示；否则折叠不显）。
- Tab C：所有角色均可见，且为全员默认落地 Tab。

### 3.3 新增 / 扩展组件清单

#### 新增组件（apps/web/src/components/）

| 组件文件 | 用途 |
|---|---|
| `dashboard-tab-bar.tsx` | 通用 Tab Bar，接收 `tabs: {key, label, disabled}[]` + `activeKey` + `onChange` |
| `leader-monthly-card.tsx` | Leader 月度汇总卡片：团队总数 / 完成数 / 完成率 / 逾期数，可展开成员列表 |
| `leader-member-row.tsx` | 成员行：头像 + 姓名 + 完成率进度条 + 逾期数，点击打开任务明细抽屉 |
| `member-task-drawer.tsx` | 侧滑抽屉：展示某成员指定月份任务明细（调 `GET /dashboard/leader/monthly/:uid/tasks`） |
| `leader-weekly-panel.tsx` | 周度进展面板：成员行 × (新增 / 完成 / 逾期 / 完成率) 四列数据表 |
| `my-monthly-summary-card.tsx` | 员工自视角月度卡片：总数 / 完成 / 在途 / 逾期 / 完成率 |

#### 扩展现有组件

| 组件文件 | 变更内容 |
|---|---|
| `apps/web/src/app/dashboard/page.tsx` | 新增 Tab Bar + 三个 Tab 面板；原有 boss dashboard 内容挪入 Tab A；Tab A 的 Leader 分组列表新增"点击展开成员行"交互（当前 `leaderSummary` 只展示汇总行） |

#### 新增 SWR Hooks（apps/web/src/hooks/）

| Hook 文件 | 对应端点 |
|---|---|
| `use-leader-monthly.ts` | `GET /dashboard/leader/monthly?month=` |
| `use-leader-member-tasks.ts` | `GET /dashboard/leader/monthly/:uid/tasks?month=` |
| `use-leader-weekly.ts` | `GET /dashboard/leader/weekly` |
| `use-my-monthly.ts` | `GET /dashboard/me/monthly?month=` |

### 3.4 月份切换器复用

现有 `/dashboard` 页面已有月份/季度选择器（`buildMonthSelectOptions` + `useState<DashboardPeriod>`）。新增的 Tab B / Tab C 共享同一个月份选择器状态（`month` 参数），以实现"切换月份 → 三个 Tab 同步刷新"体验。

---

## 4. 完整用户旅程图

### 4.1 员工旅程

```
员工打开 /dashboard
  └─ 默认落在 Tab C「我的完成情况」（全员默认，已确认）
       ├─ 看到当月：总任务数 / 已完成 / 进行中 / 逾期 / 完成率（分子只算 done）
       ├─ 月份选择器切换 → 刷新当月数据（支持中文格式：2026年5月）
       └─ 无需下钻，一屏完整
```

员工也可切到 Tab A 浏览全公司概览（只读，不涉及敏感员工数据，现有逻辑本就全员可见）。

### 4.2 Leader 旅程

```
Leader 打开 /dashboard
  └─ 默认落在 Tab C「我的完成情况」；可切换到 Tab B「我的团队」
       ├─ 月度视图（默认）
       │    ├─ 顶部卡片：团队总数 / 完成数 / 完成率 / 逾期数
       │    ├─ 成员列表（按完成率升序排列，逾期优先高亮）
       │    │    每行：姓名 | 总数 | 完成 | 完成率进度条 | 逾期数 | [下钻按钮]
       │    ├─ 点击任意成员行 → 打开右侧任务明细抽屉
       │    │    抽屉内：任务标题 / 状态 / 截止日期 / 进度 / 是否逾期
       │    └─ 月份选择器切换 → 刷新
       └─ 周度视图（切换）
            ├─ 固定本周区间（Mon-Sun）
            ├─ 每成员一行：新增 / 完成 / 逾期 / 本周完成率
            └─ 团队汇总行置顶
```

### 4.3 Boss 旅程

```
Boss 打开 /dashboard
  └─ 默认落在 Tab C「我的完成情况」；可切换到 Tab A「Boss 全员概览」
       ├─ 全局统计卡片（total / done / overdue / carryOver / riskCount）
       ├─ Leader 分组列表
       │    每个 Leader 行：姓名 | 总数 | 完成 | 完成率 | 逾期 | 风险数
       │    └─ 点击 → 侧边展开（不跳转新页面，已确认选项 B）该 Leader 名下成员列表
       │         每成员行：姓名 | 总数 | 完成 | 逾期
       │         默认只显示直属下属，可展开查看间接下属（已确认选项 B）
       ├─ 风险任务列表（已有）
       ├─ 月份 / 季度切换（中文格式：2026年5月，已确认选项 B）
       └─ （可选）Gantt 图 Tab（现有）
```

---

## 5. 隔离方案（只读，不影响现有数据）

### 5.1 数据库层

- 所有新查询使用 `SELECT ... WHERE deleted_at IS NULL`，不执行任何 INSERT / UPDATE / DELETE。
- 新端点不引入 DB 事务，不触碰 OCC 逻辑（`version` 字段），不写 `sync_log`。
- 查询只涉及已有索引：`idx_task_month_bucket`、`idx_task_assignee_status`、`idx_task_leader_user_id`（详见 `db/src/schema/task.ts`），无需新建索引。
- 周度看板涉及 `created_at >= thisMonday`，`idx_task_due_at` 不覆盖该列；本次同期加 `idx_task_created_at` 索引（已确认，选项 A）。
- 月份索引：本次同期加 `idx_task_month_bucket`（已确认，选项 A）。

### 5.2 API 层

- 新端点只在 `DashboardController` 新增方法，不修改 `getBossDashboard` / `getGanttData` 的方法签名或行为。
- 新 `DashboardService` 方法不调用任何写操作。
- 鉴权复用全局 `AuthGuard`；下钻端点在 service 层做 Leader 归属校验（非全局 guard，只在该端点内执行），返回标准 `1002 NO_PERMISSION`。

### 5.3 前端层

- 三个 Tab 各自独立的 SWR key，互不影响。
- 现有 `useDashboard` / `useGantt` Hook 不修改，Tab A 继续调用原有 Hook。
- 新增 Hook 发生错误时，只影响对应 Tab 的展示，不影响其他 Tab 或页面导航。
- `member-task-drawer.tsx` 使用 Radix `Sheet` 或现有 `dialog.tsx` 实现侧滑抽屉，不引入新 UI 库依赖。

### 5.4 Worker 层

- `runWeeklyReminder` 升级：在现有逾期提醒卡片基础上，新增团队完成率数据（已确认，选项 A：升级为包含团队完成率数据）。修改现有卡片 `buildLeaderWeeklyOverdueDigest`，追加"本周完成数 / 完成率"列，不新增独立卡片。

---

## 6. 已确认决策清单

以下问题已与项目负责人（Harvey）逐条确认。

| # | 问题 | 决策结果 |
|---|---|---|
| Q1 | Tab 默认激活规则 | **已确认**：全员默认 Tab C「我的完成情况」；Leader/Boss 可切换到 Tab B / Tab A |
| Q2 | `created_at` 索引 | **已确认，选项 A**：本次同期添加 `idx_task_created_at` 索引；月份索引 `idx_task_month_bucket` 同期加 |
| Q3 | Tab B 团队范围 | **已确认，选项 B**：默认只显示直属下属，可展开查看间接下属 |
| Q4 | 飞书周报升级 | **已确认，选项 A**：升级为包含团队完成率数据（修改现有卡片，追加列，不新增独立卡片） |
| Q5 | Boss 下钻交互 | **已确认，选项 B**：侧边展开（不跳转新页面），复用 `member-task-drawer.tsx` 抽屉风格 |
| Q6 | 月份格式 | **已确认，选项 B**：中文格式（2026年5月） |
| Q7 | 完成率分子 | **已确认**：只算 `done` 状态（`completionRate = done_only / total * 100`） |

---

## 7. 文件变更预览（阶段 2 确认后展开）

> 本节仅列出文件名，供 review 范围确认。具体代码待阶段 2 详细设计文档给出。

**后端（apps/api）**：
- `src/modules/dashboard/dashboard.service.ts` — 新增 4 个 service 方法
- `src/modules/dashboard/dashboard.controller.ts` — 新增 4 个路由 handler

**前端（apps/web/src）**：
- `app/dashboard/page.tsx` — 扩展：新增 Tab Bar + 三个 Tab 面板
- `hooks/use-leader-monthly.ts` — 新增
- `hooks/use-leader-member-tasks.ts` — 新增
- `hooks/use-leader-weekly.ts` — 新增
- `hooks/use-my-monthly.ts` — 新增
- `components/dashboard-tab-bar.tsx` — 新增
- `components/leader-monthly-card.tsx` — 新增
- `components/leader-member-row.tsx` — 新增
- `components/member-task-drawer.tsx` — 新增
- `components/leader-weekly-panel.tsx` — 新增
- `components/my-monthly-summary-card.tsx` — 新增

**DB（已确认需要）**：
- `db/migrations/0004_add_task_created_at_index.sql` — 新增 `idx_task_created_at` 和 `idx_task_month_bucket` 索引

**Worker（已确认需要）**：
- `apps/worker/src/jobs/weekly-reminder.ts` — 扩展飞书卡片内容（追加完成率列）
- `apps/worker/src/services/message-builder.ts` — 扩展 `buildLeaderWeeklyOverdueDigest`

---

## 8. 设计原则

**单页信息接收合理量原则**：默认展示最相关的核心信息，次级信息需要主动展开。

- 看板总览页：默认展示当月汇总数据（完成数、完成率、逾期数）；任务明细通过侧边抽屉展开，不跳转新页面。
- Leader 团队视图：默认只显示直属下属，间接下属需主动展开；月份选择器中文显示（2026年5月）。
- Boss 下钻：点击 Leader 行侧边展开成员列表，而非跳转页面，保持上下文连续性。

---

*End of spec. §6 已全部确认，可进入阶段 2 详细设计。*
