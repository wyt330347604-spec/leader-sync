# 月度绩效打分 + 质疑权模块 设计文档

- **日期**: 2026-05-24
- **状态**: Confirmed（待确认清单已全部确认，可进入执行阶段）
- **范围**: 新增 `monthly_score` 表 + 评分 API + 前端打分界面 + Worker 月结后推送 + 质疑超时升级
- **隔离原则**: 全部新增，不修改任何现有 task / project 表、路由或 service

---

## 1. 问题诊断

### 1.1 现状

leader-sync 已完成任务收集、月结、月度快照三大环节，但缺少"月度绩效打分"环节：

- 月结 worker 在每月 1 日 08:00 执行，生成 `monthly_snapshot`，并向员工推送当月完成率报告
- 但没有流程让直属 leader 给员工打分，也没有分数状态流转与质疑机制
- 现有权限体系（`user_role_binding`）已有 `employee / leader / boss / pmo / admin` 角色可复用

### 1.2 需求来源

精益画布 MVP 需要：

1. 直属 leader 在月结后的 N 天窗口内完成打分（分数当前为 1 分制占位，保留扩展空间）
2. 被打分员工在分数 locked 前可发起质疑（线下沟通，系统记录结果）
3. PMO / Boss 最终确认，分数 locked 后永久不可改
4. 质疑 48h 无响应 → 飞书通知升级 PMO
5. 打分界面同屏聚合：当月任务完成率 / 关联事故 / 上月分数对比 / 该员工作为 PIC 的项目

### 1.3 设计约束

- PostgreSQL 是主档，飞书卡片是推送通知面，不做双向同步
- 新模块全部隔离：新表、新路由前缀 `/api/v1/scores`，不碰现有 task / project 数据
- 状态机操作必须保证幂等（月结 worker 可重复执行）
- 分数 locked 后任何代码路径不得修改

---

## 2. DB Schema

### 2.1 新增表：`monthly_score`

```sql
CREATE TABLE monthly_score (
  id              BIGSERIAL PRIMARY KEY,
  score_uid       VARCHAR(64)   NOT NULL UNIQUE,          -- 业务主键，格式 sc_<8hex>
  score_month     VARCHAR(7)    NOT NULL,                 -- 'YYYY-MM'，被打分月份
  ratee_user_id   VARCHAR(128)  NOT NULL,                 -- 被打分人 user_id
  ratee_name      VARCHAR(128),                           -- 冗余快照，来自 org_cache
  rater_user_id   VARCHAR(128)  NOT NULL,                 -- 打分人（直属 leader）
  rater_name      VARCHAR(128),                           -- 冗余快照
  score           DECIMAL(3,1),                          -- 0.0-1.0 小数制（已确认）；null = 未打分
  status          VARCHAR(32)   NOT NULL DEFAULT 'draft', -- 状态机见 §2.2
  challenge_note  TEXT,                                   -- 质疑备注（线下沟通摘要）
  challenged_at   TIMESTAMPTZ,                           -- 质疑发起时间
  resolved_at     TIMESTAMPTZ,                           -- leader 响应时间
  locked_at       TIMESTAMPTZ,                           -- 最终 locked 时间
  locked_by       VARCHAR(128),                           -- 执行 lock 的 PMO/Boss user_id
  escalated_at    TIMESTAMPTZ,                           -- 超时升级通知发送时间（idempotency）
  snapshot_ref    VARCHAR(64),                            -- 对应 monthly_snapshot.snapshot_uid（employee scope）
  version         INTEGER       NOT NULL DEFAULT 1,       -- OCC
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(128)  NOT NULL,
  updated_by      VARCHAR(128),
  CONSTRAINT uniq_score_month_ratee UNIQUE (score_month, ratee_user_id)
);

CREATE INDEX idx_ms_score_month       ON monthly_score (score_month);
CREATE INDEX idx_ms_ratee_user_id     ON monthly_score (ratee_user_id);
CREATE INDEX idx_ms_rater_user_id     ON monthly_score (rater_user_id);
CREATE INDEX idx_ms_status            ON monthly_score (status);
CREATE INDEX idx_ms_challenged_at     ON monthly_score (challenged_at)
  WHERE challenged_at IS NOT NULL AND status = 'challenged';
```

**Migration 文件**: `db/migrations/0004_add_monthly_score.sql`

### 2.2 状态机定义

```
draft
  │  leader 完成打分（PATCH score）
  ▼
scored
  │  员工或代理发起质疑（POST /challenge）
  ▼
challenged
  │  leader 修改分数或维持原分（POST /resolve）
  ▼
pending_lock
  │  HR 或 Boss 确认（POST /lock）
  ▼
locked  ← 终态，任何路径不得触发 UPDATE score / status
```

附加规则：

| 源状态 | 目标状态 | 操作者 | 条件 |
|---|---|---|---|
| draft | scored | rater（leader） | `score IS NOT NULL` |
| scored | challenged | 任意已认证用户（代 ratee 提） | locked_at IS NULL |
| scored | pending_lock | PMO / Boss | 跳过质疑直接锁定 |
| challenged | pending_lock | rater（leader）调用 resolve | `resolved_at` 自动写入 |
| pending_lock | locked | PMO / Boss | 写 `locked_at` + `locked_by` |
| challenged | challenged | — | 超时升级仅写 `escalated_at`，不改 status |

**禁止**：任何 status 为 `locked` 的行进行 UPDATE（service 层硬检查）。

### 2.3 字段命名对齐（CLAUDE.md 命名主权）

| 字段 | 类型后缀 | 说明 |
|---|---|---|
| `challenged_at` | `_at` = 时间戳 | 符合规范 |
| `resolved_at` | `_at` | 符合规范 |
| `locked_at` | `_at` | 符合规范 |
| `escalated_at` | `_at` | 符合规范 |
| `score_month` | `VARCHAR(7)` | 不用 `_at/_date`，因为是 bucket 字符串，对齐 `month_bucket` 惯例 |
| `snapshot_ref` | FK 引用 | 软引用，不加数据库外键（与现有 task.project_uid 对齐） |

---

## 3. API 端点设计

**Base prefix**: `/api/v1/scores`（全新，不复用 `/tasks` 路由）

**Auth**: 复用现有 `AuthGuard`（JWT cookie），无例外。

**Response envelope**: 复用现有 `{code, message, trace_id, data}` 格式。

### 3.1 端点清单

| Method | Path | 操作者权限 | 说明 |
|---|---|---|---|
| `GET` | `/scores?month=YYYY-MM` | 全员（结果按角色过滤） | 查询某月打分列表 |
| `GET` | `/scores/:score_uid` | 全员（结果按角色过滤） | 查询单条评分详情 |
| `PATCH` | `/scores/:score_uid/score` | rater 本人 | 填写/修改分数（限 draft/challenged 状态） |
| `POST` | `/scores/:score_uid/challenge` | 任意已认证用户 | 发起质疑（写 challenge_note / challenged_at）；关联部门 Leader 也可对他人团队打分提出质疑 |
| `POST` | `/scores/:score_uid/resolve` | rater 本人 | 响应质疑（分数维持或修改后确认，status → pending_lock） |
| `POST` | `/scores/:score_uid/lock` | PMO / Boss | 最终确认，status → locked |
| `GET` | `/scores/:score_uid/context` | rater 本人 / PMO / Boss | 聚合展示上下文（见 §3.3） |

### 3.2 权限规则

```
读取（GET）：
  - boss / PMO：可查看所有人的评分
  - leader：只能看自己作为 rater 的评分（ratee 列表）
  - employee：只能看自己作为 ratee 的评分

写入：
  - PATCH score：仅当 req.user.user_id === score.rater_user_id AND status IN ('draft','challenged')
  - POST challenge：任意已认证用户，status 必须是 'scored'，locked_at IS NULL；
    关联部门 Leader（非直属）也可对他人团队打分提出质疑（已确认，选项 B）
  - POST resolve：仅当 req.user.user_id === score.rater_user_id AND status = 'challenged'
  - POST lock：仅当 req.user 的 role IN ('boss','pmo','admin')

违反权限 → BusinessException(1002, 'NO_PERMISSION')，HTTP 403
```

**角色检测方式**：`user_role_binding` 表，`WHERE user_id = ? AND role IN ('boss','pmo','admin')`。HR 角色用 PMO 代替，不新增 HR 角色（已确认）。

### 3.3 `GET /scores/:score_uid/context` 聚合响应

打分界面需要的"同屏上下文"，由单个 API 聚合返回，避免前端多次请求：

```typescript
interface ScoreContext {
  score: MonthlyScore;           // 评分记录本身
  snapshot: {                    // 来自 monthly_snapshot（employee scope）
    doneRate: string;            // "75%"
    monthDoneCount: number;
    monthDueCount: number;
    monthOverdueCount: number;
    monthCarryOverCount: number;
  };
  prevScore: {                   // 上月评分（若存在），用于对比
    score: number | null;
    status: string;
    scoreMonth: string;
  } | null;
  incidents: IncidentRef[];      // 关联事故（事故模块与打分模块同期上线，可互相引用；由 incident 模块 API 提供数据）
  picProjects: PicProject[];     // 该员工作为 PIC 的项目（来自 project 表，ownerName 匹配）
}

interface PicProject {
  projectUid: string;
  name: string;
  category: string;
  region: string | null;
}
```

**`picProjects` 查询逻辑**：本期同步迁移为 `project.owner_user_id`（已确认，选项 B）。前端使用 Combobox 选人（不手填 ID），服务端查询 `WHERE project.owner_user_id = ratee.user_id`。迁移时需对 `project` 表新增 `owner_user_id` 字段并回填存量数据。

### 3.4 OCC（乐观并发控制）

`PATCH score` 和 `POST resolve` 接受 `version` 参数：

```sql
UPDATE monthly_score
SET score = ?, status = ?, version = version + 1, updated_at = NOW(), updated_by = ?
WHERE score_uid = ? AND version = ?
```

若无行受影响 → `BusinessException(1009, 'VERSION_CONFLICT')`，前端重新 GET 后重试。

---

## 4. 前端路由

### 4.1 新增路由

| Route | 文件路径 | 用途 |
|---|---|---|
| `/scores` | `apps/web/src/app/scores/page.tsx` | 评分总览（按月过滤，按角色展示不同视图） |
| `/scores/[score_uid]` | `apps/web/src/app/scores/[score_uid]/page.tsx` | 单条评分详情 + 打分操作 |

### 4.2 导航入口

在 `top-nav.tsx` 的主导航中增加"月度评分"链接，位于"项目"之后：

```
督办任务 | 仪表盘 | 项目 | 月度评分
```

`/scores` 对所有已登录用户可见；视角内容因角色不同。

### 4.3 `/scores` 总览页布局

```
┌─────────────────────────────────────────────────────┐
│ 月度评分                                              │
│ [月份选择器：默认当月] [下载占位]                      │
├──────────────────────────────────────────────────────┤
│ （Boss/HR 视角）                                      │
│ ┌───────────────────────────────────────────────────┐│
│ │ 张三   │ 4月 │ 待打分   │ [打分入口]              ││
│ │ 李四   │ 4月 │ 已打分   │ 1分 / pending_lock       ││
│ │ 王五   │ 4月 │ 质疑中   │ [查看质疑]               ││
│ │ ...    │     │ 已锁定   │ 1分 ✓                    ││
│ └───────────────────────────────────────────────────┘│
│                                                       │
│ （Leader 视角）仅显示自己负责的下属列表               │
│ （Employee 视角）仅显示自己的一行                     │
└─────────────────────────────────────────────────────┘
```

状态 badge 颜色对齐：

| 状态 | badge 颜色 |
|---|---|
| draft | 灰色（neutral） |
| scored | 蓝色（blue） |
| challenged | 橙色（orange） |
| pending_lock | 紫色（violet） |
| locked | 绿色（green） |

### 4.4 `/scores/[score_uid]` 打分详情页布局

```
┌────────────────────────────────────────────────────┐
│ ← 返回评分列表                                      │
│ 张三 · 2026-04 月度评分                            │
│ 当前状态: [scored]                                  │
├──────────────────────────────┬─────────────────────┤
│ 评分区域                      │ 上下文面板          │
│                              │                     │
│ 分数: [___] (0.0-1.0)        │ 任务完成率: 75%     │
│ （仅 rater 或已打分后显示）   │ 完成 9/12，逾期 2   │
│                              │ 结转 1              │
│ 状态操作按钮：                │                     │
│ [确认打分] → scored           │ 上月对比: 1分 ✓    │
│ [发起质疑] → challenged       │                     │
│ [确认锁定] → locked           │ 项目 PIC:           │
│                              │ · XT 印度 (自营)    │
│ 质疑记录（若有）：            │ · SkyD (投资)       │
│ 质疑备注: [___________]      │                     │
│ 发起时间: 2026-05-03 10:00   │ 关联事故: 暂无      │
│ 响应时间: -                  │ （MVP 占位）         │
└──────────────────────────────┴─────────────────────┘
```

**数据来源**：上下文面板所有数据来自 `GET /scores/:score_uid/context` 单次请求，通过 SWR 缓存。

### 4.5 状态感知的按钮可见性

| 按钮 | 显示条件 |
|---|---|
| 确认打分 | status = draft 且当前用户是 rater |
| 修改分数（在 challenged 状态） | status = challenged 且当前用户是 rater |
| 响应质疑 | status = challenged 且当前用户是 rater |
| 发起质疑 | status = scored 且 locked_at IS NULL |
| 最终锁定 | status IN (scored, pending_lock) 且当前用户是 boss/PMO |

---

## 5. Worker 扩展

### 5.1 月结后推送"评分窗口开启"通知

在现有 `runMonthlyClose()` 完成所有步骤后，追加步骤 7：

```
Step 7: 创建当月 monthly_score 草稿记录 + 推送"评分窗口开启"通知
```

**逻辑**：

1. 从 `monthly_snapshot`（employee scope，`snapshot_month = lastMonth`）取出所有 `owner_user_id`（被打分员工列表）
2. 为每个员工查找其直属 leader（`org_cache.manager_user_id`）
3. 对每对 `(ratee_user_id, rater_user_id, lastMonth)`：
   - INSERT INTO `monthly_score` … ON CONFLICT (score_month, ratee_user_id) DO NOTHING（幂等）
   - 写入 `snapshot_ref` 对应的 `snapshot_uid`
4. 向每个 rater（直属 leader）发送飞书卡片通知，汇总其需要打分的员工列表

**通知卡片内容（buildScoreWindowCard）**：

```
标题：【评分窗口开启】2026-04 月度评分
正文：您有 N 位下属待完成月度打分，请在 YYYY-MM-DD（月结后 14 日）前完成。
行动按钮：[前往打分] → https://www.harveywang.xyz/scores?month=2026-04
```

打分截止日期 = 月结执行日 + 7 天（已确认：7 天窗口，超时只发飞书提醒，不强制；超时后状态标记为"未评分"而非自动推进）。

### 5.2 新增 cron：质疑超时升级通知

在 `apps/worker/src/jobs/` 新增 `score-escalation.ts`，在 `main.ts` 注册为：

```typescript
registerJob('score-escalation', '0 9 * * *', runScoreEscalation);
// 每日 09:00 Asia/Shanghai 检查超时质疑
```

**`runScoreEscalation()` 逻辑**：

```
1. 查询所有满足以下条件的 monthly_score：
   - status = 'challenged'
   - challenged_at < NOW() - 48h
   - escalated_at IS NULL（未升级过）

2. 对每条记录：
   a. 获取 HR 用户列表（user_role_binding WHERE role IN ('hr','admin','boss')）
   b. 向 PMO（`role = 'pmo'` 全员）发送飞书卡片通知，同时抄送被打分员工（已确认，选项 B）：
      标题：【评分质疑超时提醒】
      正文：{ratee_name} 于 {challenged_at} 提出质疑，{rater_name} 尚未响应（已超 48 小时）。
      行动按钮：[查看质疑] → /scores/:score_uid
   c. UPDATE monthly_score SET escalated_at = NOW() WHERE score_uid = ?
      （仅写 escalated_at，不改 status，保证幂等）

3. 打印升级数量日志
```

**幂等保证**：`escalated_at IS NULL` 过滤确保每条质疑只发一次升级通知。

### 5.3 dry-run 支持（CLAUDE.md 强制）

两个新 job 都必须支持 dry-run 模式（与现有 job 保持一致）：

```typescript
export async function runScoreEscalation(dryRun = false): Promise<void> {
  // ...
  if (!dryRun) {
    await feishuApi.sendCardMessage(hrUserId, card);
    await db.update(monthlyScore).set({ escalatedAt: now }).where(...);
  } else {
    console.log('[DRY RUN] Would escalate:', scoreUid);
  }
}
```

---

## 6. 隔离方案

### 6.1 数据层隔离

| 原则 | 实现 |
|---|---|
| 不修改现有表 | `monthly_score` 是全新表，`UNIQUE(score_month, ratee_user_id)` 约束在新表内 |
| 不修改现有 service | `MonthlyScoreService` 在新模块 `apps/api/src/modules/monthly-score/` 下 |
| 只读引用 task / monthly_snapshot | `score context` API 只做 SELECT，不写入 task 或 monthly_snapshot |
| 软引用 snapshot | `snapshot_ref VARCHAR` 不加 DB 外键，与 `task.project_uid` 保持一致 |

### 6.2 API 层隔离

| 原则 | 实现 |
|---|---|
| 独立路由前缀 | 全部挂在 `/api/v1/scores`，不碰 `/tasks` / `/projects` / `/dashboard` |
| 独立 module | `MonthlyScoreModule` → `MonthlyScoreController` + `MonthlyScoreService` + `MonthlyScoreRepository` |
| 复用现有 AuthGuard | 不新建 guard，仅在 service 层做角色判断 |

### 6.3 Worker 层隔离

| 原则 | 实现 |
|---|---|
| Step 7 追加在 monthly-close 末尾 | 若失败（try-catch）只打 warn，不影响 step 1-6 已完成的月结 |
| 新 job 独立文件 | `jobs/score-escalation.ts` 不改动任何现有 job 文件 |
| 幂等 | INSERT ON CONFLICT DO NOTHING + escalated_at IS NULL 过滤 |

### 6.4 前端层隔离

| 原则 | 实现 |
|---|---|
| 新路由目录 | `apps/web/src/app/scores/` 独立目录 |
| 不改现有页面组件 | 只在 `top-nav.tsx` 追加一个导航链接 |
| 新 API client 函数 | 在新文件 `apps/web/src/lib/scores-api.ts` 中定义，不改 `api-client.ts` |

---

## 7. 已确认决策清单

以下设计点已与项目负责人（Harvey）逐条确认。

| # | 问题 | 决策结果 |
|---|---|---|
| 1 | HR 角色归属 | **已确认**：用 PMO 角色代替，不新增 HR 角色；质疑升级通知发给 PMO 全员，并抄送被打分员工 |
| 2 | 评分窗口截止日期 | **已确认**：月结后 7 天；超时只发飞书提醒，不强制；超时后状态标记为"未评分" |
| 3 | 1 分制定义 | **已确认**：0.0-1.0 小数制（`DECIMAL(3,1)`），非二值 0/1 |
| 4 | 关联事故字段 | **已确认**：事故模块与打分模块同期上线，可互相引用，不再是占位空数组 |
| 5 | PIC 项目查询方式 | **已确认，选项 B**：同期迁移 `owner_user_id`，前端 Combobox 选人，不用字符串匹配 |
| 6 | 质疑发起权限 | **已确认，选项 B**：关联部门 Leader 也可对他人团队的打分提出质疑（不限直属） |
| 7 | 质疑升级通知抄送 | **已确认，选项 B**：质疑升级通知同时抄送被打分员工 |
| 8 | Bitable 同步 | **已确认，选项 A**：不同步，仅 web UI 操作 |
| — | company_id | **已确认**：JWT 无此字段，MVP 阶段硬编码固定值 |

---

## 8. 受影响文档（CLAUDE.md 文档联动要求）

实施阶段需同步更新以下文档（本期 spec 不修改，仅标注影响范围）：

| 文档 | 变更内容 |
|---|---|
| `docs/02-data/field-dictionary.md` | 新增 `monthly_score` 全部字段条目 |
| `docs/02-data/enum-dictionary.md` | 新增 `monthly_score_status` 枚举（HR 角色用 PMO 替代，不新增枚举值） |
| `docs/04-process/state-machine.md` | 新增月度评分状态机图 |
| `docs/05-permissions/permission-matrix.md` | 新增评分模块的角色权限矩阵 |

---

## 9. 测试计划（QC Protocol Red-Light-First）

### 9.1 后端单测（vitest）

`apps/api/src/modules/monthly-score/monthly-score.service.spec.ts`：

- `draft → scored`：rater 填分 → status 变 scored，version 自增
- `scored → challenged`：任意用户发起质疑 → challenged_at 写入
- `challenged → pending_lock`：rater 调用 resolve → resolved_at 写入
- `pending_lock → locked`：HR 调用 lock → locked_at / locked_by 写入
- `locked 防篡改`：对 locked 行调用 PATCH score → 抛 BusinessException(1002)
- `OCC 冲突`：version 不匹配 → 抛 BusinessException(1009)
- `非 rater 打分`：非 rater 调用 PATCH score → 抛 BusinessException(1002)
- `非 HR/Boss lock`：普通 leader 调用 lock → 抛 BusinessException(1002)

### 9.2 Worker 单测

`apps/worker/src/jobs/score-escalation.spec.ts`：

- 查到 `status=challenged` 且超 48h 且 `escalated_at IS NULL` → 发通知 + 写 escalated_at
- 已发过 escalation（`escalated_at IS NOT NULL`）→ 跳过，不重发
- dry-run = true → 不调用 feishuApi，不写 escalated_at

### 9.3 前端单测（vitest + RTL）

`apps/web/src/__tests__/scores-page.test.tsx`：

- Boss 视角：列表包含所有员工行
- Leader 视角：列表仅包含自己下属
- Employee 视角：列表仅包含自己一行
- `locked` 状态行：所有操作按钮均不渲染
- `challenged` 状态：显示"发起质疑"记录区域

### 9.4 E2E + Screenshot Audit（CLAUDE.md 强制）

`apps/web/e2e/scores.spec.ts`：

- Leader 登录 → 进入 `/scores` → 截图 `scores-overview-leader.png`
- 点击待打分员工行 → 进入 `/scores/:uid` → 截图 `scores-detail-draft.png`
- 填写分数 + 确认 → status 变 scored → 截图 `scores-detail-scored.png`
- 发起质疑 → status 变 challenged → 截图 `scores-detail-challenged.png`

---

## 10. 设计原则

**单页信息接收合理量原则**：默认展示最相关的核心信息，次级信息需要主动展开。

- 评分列表页（`/scores`）：默认展示员工名、当月状态、分数；质疑备注、历史分数等次级信息在详情页展示。
- 打分详情页（`/scores/[score_uid]`）：左侧聚焦评分操作，右侧上下文面板展示辅助信息（任务完成率、事故、PIC 项目）；项目列表较长时可折叠。

---

## 11. 实施步骤（高层，供后续 writing-plans 展开）

1. **§7 确认清单已全部通过** → 可进入执行
2. DB migration `0004_add_monthly_score.sql` + 字典文档更新（含 `project.owner_user_id` 迁移）
3. `MonthlyScoreModule`（NestJS）：Repository → Service → Controller → DTO 校验
4. 后端单测（Red → Green）
5. Worker：`monthly-close.ts` 追加 Step 7（创建草稿 + 推送通知，7 天窗口）
6. Worker：新增 `score-escalation.ts` + 注册 cron（PMO 全员 + 抄送被打分员工）
7. Worker 单测
8. 前端：`apps/web/src/app/scores/` 路由 + 组件 + SWR hooks（分数输入 0.0-1.0 小数）
9. `top-nav.tsx` 追加"月度评分"导航项
10. 前端单测 + Playwright e2e + screenshot audit
11. dev DB 走通全流程（含 dry-run 验证）
12. 生产部署（DB migration 先行，API + Worker + Web 随后）

---

*End of spec. §7 已全部确认，可由 writing-plans 生成详细执行计划。*
