# 组织架构：粘性离职标记 + 业务线分图 设计方案

> 日期：2026-07-23 ｜ 状态：待 Harvey 评审 ｜ 承接：`2026-07-17-org-member-lifecycle-and-canvas-tree-design.md`

## 一句话目标（说人话）

让管理员能在组织架构图上**手动把离职的人点掉、且第二天不被自动同步"复活"**；并把 **XT虾条 / DFW曙条 两条平行业务线拆成两张图**。

## 背景与根因

- 现状：`/org` 图默认已不显示离职(`left_at`)/隐藏(`hidden_at`)的人（2026-07-17 已上线）。但生产 92 人里**只有 1 人被标离职** → 大量"已离职却还挂在飞书通讯录里"的人仍显示。
- **关键坑（本方案核心动因）**：`apps/worker/src/jobs/sync-org-hierarchy.ts:334-335` 的"复职自愈"逻辑**无条件**执行——只要某行 `left_at != null` 且该人仍在飞书通讯录枚举结果里，就清空其 `left_at`。它**不区分人工标记还是系统自动标记**。因此纯手动 `left_at` 会被次日 07:00 同步推翻，"标记离职按钮"若不改造即形同虚设。
- 业务线：数据无 `dept_name`（基本为空），两条线只能靠汇报链顶端区分。已用递归查询验证 78 名在职者全部干净归属：**Tobi→49（虾条）、祁雁飞→27 + 孔德俊→2（曙条）**，无孤儿。

## 范围（三部分）

### 第一部分：粘性离职标记 + 自动上并

**数据模型（`db`）**
- `org_cache` 新增列 `left_source varchar`（取值 `'manual'` / `'feishu'`，可空；null 视同历史 `'feishu'`）。镜像现有 `manager_source` 口径。
- 新 migration（编号顺延，当前最新 0023 → 本方案 `0024_org_left_source.sql`）。`db` 包必须 `tsc -p tsconfig.build.json` 重新构建（既有坑）。

**Worker 同步改造（`sync-org-hierarchy.ts`）— 最关键**
- 复活分支（当前 line 334-335）加条件：**仅当 `left_source = 'feishu'`（或为 null 的历史行）才清空 `left_at`**；`left_source = 'manual'` 的行**永不自动复活**。
- 自动标离职分支（line 337-339）写 `left_at = now, left_source = 'feishu'`。
- 安全阀逻辑不变。
- 幂等：手动标记的行在任意次数同步后状态不变。

**API（`org.service` / `org.controller` / `org.repository`）**
- 新增端点 `PATCH /api/v1/org/users/:uid/left`，body `{ left: boolean }`，管理员限定（`assertOrgAdmin`，复用 `ORG_STRUCTURE_ADMINS` 白名单 + 双命名空间匹配）。
  - `left=true`：设 `left_at=now, left_source='manual'`；并执行**自动上并**（见下）。
  - `left=false`（撤销）：清 `left_at=null, left_source=null`。人回到图上；其原下属已上并的关系不自动回退（撤销不还原汇报线，避免二次意外改动——记为已知取舍）。
- **自动上并**：标某人 P 离职时，把 P 的所有活跃直属下属 C（`C.manager_user_id` 双命名空间命中 P）改挂到 P 的上级：`C.manager_user_id = P.manager_user_id`，并置 `C.manager_source='manual'`（防止次日同步按飞书链把 C 改回 P）。若 P 无上级（顶端）→ C 的 `manager_user_id` 置空，C 成为新顶端。
- 错误码复用既有 `ORG_USER_NOT_FOUND` 等。

**Web（`apps/web/src/app/org/`）**
- 节点卡 `org-node-card.tsx` 增加「标记离职」/「撤销离职」按钮（仅 `can_edit` 时显示），调用上面端点，成功后 `mutate` 刷新。
- 与既有「隐藏」按钮并列，文案区分清楚：**离职=人走了（粘性，同步不复活）**；隐藏=临时藏。

### 第二部分：按业务线拆两张图

- **归类规则**：每个在职节点沿 `manager_user_id`（双命名空间）向上爬到顶端，按"顶端→业务线"配置归类。
- **配置**（新常量，置于 `org.service` 或独立配置文件，形如 `ORG_STRUCTURE_ADMINS`）：
  - `虾条 XT` ← Tobi 的两个账号（`2d2adg26`、`ou_243a9225acc248c148c25f8fe0699407`）
  - `曙条 DFW` ← 孔德俊（`ou_da7e2a5ae070ceb2b247569aa8acdf87`）、祁雁飞（`ou_b23684cac81e32b5631dfcee7dbe4e27`）
  - 爬不到任一已知顶端 → `未分组`（当前为空，保留兜底）
- **实现选择**：后端 `GET /org/tree` 为每个节点附 `business_line` 字段（`'xt'|'dfw'|'ungrouped'`），前端按此过滤；避免前端重复爬链逻辑。
- **Web**：`/org` 顶部加标签切换【虾条】【曙条】【未分组】，复用现有 React Flow 画布，仅按 `business_line` 过滤要渲染的节点集。`include_hidden` 开关行为不变。

### 第三部分：Albern（已在生产直接处理，本方案仅登记）

- Albern 3 个账号已于 2026-07-23 手动标记：`left_at=2026-07-18`，并保留 `hidden_at` 作为同步保险。
- `left_source` 上线后，将其归为 `'manual'`，届时 `hidden_at` 保险可清（同步不再能复活 manual-left）。

## 边界与决策记录

| 决策点 | 结论 | 备注 |
|---|---|---|
| 手动离职是否粘性 | 是，`left_source='manual'` 永不被同步复活 | 无此则按钮无效（核心） |
| 管理者离职后下属 | **自动上并到离职者的上级**；离职者是顶端则下属成新顶端 | Harvey 2026-07-23 定 |
| 撤销离职是否还原下属汇报线 | 否，不自动回退 | 避免二次意外改动 |
| 一次性批量清理 | 不做；仅提供按钮，Harvey 自行点选 | Harvey 2026-07-23 定 |
| 业务线分组依据 | 汇报链顶端（无公司/部门字段可用） | 数据已验证 78 人全连通 |
| 离职连带效应 | 标离职 = 同时踢出绩效花名册（不打分/不收卡） | 「撤销离职」可救回；UI 需提示 |

## 测试计划（TDD，先证伪后修复）

- **Worker**（vitest，`apps/worker`）：`left_source='manual'` 的行在"人仍在通讯录"时**不被复活**（RED→GREEN）；`'feishu'`/null 行照常复活；自动标离职写 `'feishu'`；安全阀不受影响；幂等（多次同步态不变）。
- **API**（vitest，`apps/api`）：`PATCH /left` 权限测试（非管理员 403）；标离职写 manual + 上并下属（下属 manager 改到离职者上级、置 manual）；顶端离职→下属 manager 置空；撤销清 left_source；`GET /org/tree` 返回正确 `business_line` 分组。
- **Web**（vitest + RTL / e2e）：按钮仅 `can_edit` 显示；三标签切换过滤正确；截图审计（QC#2）。
- **回归**：既有 org 测试全绿；`db` 重建后类型导出正确。

## 非目标（YAGNI）

- 不新增"公司/业务线"独立标签字段（用汇报链顶端，单一事实来源）。
- 不做离职名单批量导入。
- 「未分组」暂不做特殊管理，仅兜底展示。
- 不改动绩效花名册逻辑（本会话已确保其排除 left/hidden）。

## 部署要点

- 改 `db` schema → 必 `tsc -p tsconfig.build.json` 重建 + rsync `db/dist`。
- migration 0024 手动 apply 到阿里云生产（`leader-sync-postgres-1`），先备份。
- Worker 改动：生产 worker 跑 `tsx` 源码（非 dist），rsync 源码 + `systemctl restart leader-worker`。
- API/Web：本地 build → rsync dist → 按端口 `fuser` 重启（**非 systemctl**，API/Web 是 nohup+setsid）。
- 冒烟：`/org/tree` 200 带 business_line；`PATCH /left` 无 token 401；截图三标签。
