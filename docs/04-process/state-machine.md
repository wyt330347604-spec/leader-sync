# 状态机与流程

> 状态枚举值以 enum-dictionary.md 为准。

## 1. 任务生命周期状态机

```mermaid
stateDiagram-v2
    [*] --> draft: 创建
    draft --> assigned: 指派
    assigned --> in_progress: 开始执行
    assigned --> cancelled: 取消
    in_progress --> blocked: 发生阻塞
    blocked --> in_progress: 解除阻塞
    in_progress --> pending_review: 提交完成
    pending_review --> done: 验收通过
    pending_review --> in_progress: 验收退回
    in_progress --> done: 直接完成
    done --> reopened: 重新打开
    reopened --> in_progress: 继续执行
    done --> closed: 月结归档
    cancelled --> closed: 归档
```

## 2. 生命周期状态说明

| 状态 | 中文 | 说明 |
|---|---|---|
| draft | 草稿 | 已创建但未正式派发 |
| assigned | 已指派 | 已有负责人，待开始 |
| in_progress | 进行中 | 正在处理 |
| blocked | 阻塞 | 有阻塞因素 |
| pending_review | 待验收 | 已提交，待确认 |
| done | 已完成 | 业务完成 |
| reopened | 重新打开 | 已完成后重新处理 |
| cancelled | 已取消 | 终止 |
| closed | 已归档 | 历史归档状态 |

## 3. 状态流转规则

### 3.1 创建后
- 默认进入 `draft`
- 若创建时已明确负责人并立即生效，可直接进入 `assigned`

### 3.2 开始执行
- `assigned -> in_progress`
- 触发条件：负责人确认开始或第一次更新进展

### 3.3 阻塞
- `in_progress -> blocked`
- 要求：必须填写阻塞原因

### 3.4 提交完成
- `in_progress -> pending_review`
- 适用于需要 leader / 发起人验收的任务

### 3.5 完成
- `pending_review -> done`
- 或 `in_progress -> done`

### 3.6 重新打开
- `done -> reopened`
- 要求：必须记录重新打开原因

### 3.7 归档
- `done -> closed`
- `cancelled -> closed`
- 由月结或归档任务触发

## 4. 月度周期状态机

```mermaid
stateDiagram-v2
    [*] --> current_month_new: 本月新增
    current_month_new --> current_month_active: 进入执行
    current_month_active --> due_this_week: 本周应完成
    due_this_week --> overdue_warning: 临近延期
    overdue_warning --> overdue: 到期未完成
    current_month_active --> completed_in_month: 本月完成
    overdue --> carry_over_pending: 月结待结转
    carry_over_pending --> carried_to_next_month: 继承到下月
    completed_in_month --> monthly_archived: 上月快照归档
    carried_to_next_month --> monthly_archived: 上月快照归档
```

## 5. 同步状态机

> 枚举值以 enum-dictionary.md `sync_status` 为准。

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> syncing: 开始同步
    syncing --> success: 成功
    syncing --> failed: 失败
    failed --> retrying: 自动重试
    retrying --> success: 重试成功
    retrying --> failed: 重试仍失败（超出上限）
    syncing --> conflict: 冲突
    retrying --> conflict: 重试后冲突
    conflict --> manual_review: 进入人工处理
    manual_review --> success: 修复完成
    pending --> skipped: 规则判定跳过
```

## 6. 指派流程

```mermaid
flowchart TD
    A[创建任务] --> B{是否立即指派}
    B -- 否 --> C[保存为 draft]
    B -- 是 --> D[记录发起人/指派人/负责人]
    D --> E[写入中心主档]
    E --> F[同步多维表格]
    E --> G[同步飞书任务]
    E --> H{是否需要同步日历}
    H -- 是 --> I[创建/更新日程]
    H -- 否 --> J[结束]
    I --> J
```

## 7. 月结流程

```mermaid
flowchart TD
    A[月结开始] --> B[统计口径按月末 24:00 冻结]
    B --> C[抽取上月任务]
    C --> D[计算个人统计]
    D --> E[计算 leader 统计]
    E --> F[计算公司统计]
    F --> G[生成 monthly_snapshot]
    G --> H[判定继承任务]
    H --> I[新建继承任务记录]
    I --> J[发送月报]
    J --> K[月结完成]
```

## 8. 季度考核串行门控（quarter_task.stage —— 2026-07-09，P2）

Harvey 定：**串行打分**——自评 → 同事+直属（并行）→ 管理层，逐环解锁；自评超时 3 天自动放行（标 `self_skipped`，防一人卡全链）。纯推导逻辑见 `apps/api/src/modules/quarter/quarter-logic.ts`（`computeQuarterStage`），每次 sheet 提交后重算。

```mermaid
stateDiagram-v2
    [*] --> pending_self: 开窗生成任务
    pending_self --> pending_peer_manager: 自评提交 / 超时 self_skipped
    pending_peer_manager --> scored: 无 mgmt（含全排除回退）——直属+同事（含 peer_skipped）均完成
    pending_peer_manager --> pending_mgmt: mgmt_required 且有评分人——直属提交（建管理层 sheet + 排除名单）
    pending_mgmt --> scored: 管理层 sheet 全部提交 + 同事已完成（含 peer_skipped）
    scored --> [*]
```

门控规则（`computeQuarterStage` / `computeSheetLock`）：

- **自评（self）**：仅 `pending_self` 可填；提交或超时 → `pending_peer_manager`。自评仅参照、不计分。
- **同事(peer)+直属(manager)**：`pending_self` 时锁定（"等待本人完成自评"），其后并行解锁。
- **管理层(management)**：仅 `pending_mgmt` 可填（"等待直属完成打分"）；直属提交且 `mgmt_required` 时，服务端计算「一级部门 leader/直属/本人」排除名单（缺部门数据回退管理链规则），生成 management draft sheet 并写 `mgmt_trace` 留痕。
- **终态**：无 mgmt 员工在直属+同事都完成后 → `scored`；`mgmt_required` 任务在直属+同事 + **管理层 sheet 全部提交**后 → `scored`（P3 收口，`computeQuarterStage` 增 `mgmtSheetsExist`/`allMgmtSubmitted` 判据，每张 management sheet 提交后重算）。
- **缺失 sheet 不阻塞**：无直属（no-manager）或未指定同事（no-peer）时该环节视为"无需等待"。
- **硬化2 · 管理层全排除回退**：`mgmt_required` 任务在直属提交时，若排除规则算完管理层评分人为空（小部门/都在排除名单），则**不建 management sheet、不进 `pending_mgmt`**，`computeQuarterStage` 以 `mgmtRatersEmpty=true` 退化为「无 mgmt」路径（直属+同事完成即 `scored`），`mgmt_trace` 留痕 `rule='all_excluded_fallback'`、`raterIds=[]`。合成（`computeResult`）走 mgmt 缺席分支。
- **硬化3 · 同事超时放行**：`computeQuarterStage` 新增 `peerSkipped` 判据，`peer_skipped=true` 视同「同事已完成」参与门控。

超时放行由 worker 每日执行（幂等，dry-run 支持）：
- `advance-self-timeout`（09:05）：`pending_self` 且过 `stage_deadlines.self` → `self_skipped=true` + `stage=pending_peer_manager`，自评 sheet 保持 draft 不删。
- `advance-peer-timeout`（09:10，硬化3）：`pending_peer_manager`、`peer_skipped=false` 且过 `stage_deadlines.peer_manager`、同事 sheet 未提交 → `peer_skipped=true`；重算 stage（非 mgmt 且直属已完成 → `scored`，否则维持 `pending_peer_manager` 等直属）。未指定同事 / 同事已提交 → 跳过不放行。

### 8.1 周期状态机（quarter_cycle.status —— 2026-07-15，评分会召集）

`goal_check → scoring → panel → published → closed`。开窗建 cycle 即 `scoring`（§5）；公示 `publish` 置 `published`（§9）。**新增 `scoring → panel`（召集评分会）**：

```mermaid
stateDiagram-v2
    scoring --> panel: 召集评分会（写 panel_at + 发管理层召集卡）
    panel --> published: 公示出分（publish）
```

- **召集触发**：① 手动 `POST /quarter/cycles/:uid/convene-panel`（admin/boss/hr，随时可召集）；② worker 自动 job `convene-panel-check`（每日 09:20）扫描 `scoring` 周期，当其**全部 enrolled 任务 stage=scored**（且至少一条参评任务，保守口径）时自动召集。两者同口径（API `QuarterService.convenePanel` / worker glue，跨进程各落一份）。
- **副作用**：`status=panel`、`panel_at=now`，给全部 `perf_role.is_management` 成员发召集卡（`open_id` 解析不到 warn 跳过；发送失败 warn 不阻塞）。
- **幂等**：已 `panel/published/closed` → 跳过不改状态不发卡；仍在 `goal_check`（未开窗打分）→ 手动端点 400。
- 说明：`panel` 是评分会看板/合成/改分的进行态；合成 `compute` 与公示 `publish` 不强制要求先经 `panel`（当前 `compute` 只门控 `task.stage=scored`），召集主要用于**通知管理层集合 + 记录 panel_at**。触发时间/阈值口径待全面测试后收口。

## 9. 季度合成结果生命周期（quarter_result.status —— 2026-07-09，P3）

`quarter_task.stage=scored` 后，管理角色触发合成（`POST /quarter/tasks/:uid/result/compute` 或批量），从已提交 sheet 取数 → `mergeSoft`/`quarterlyTotal`/`quarterlyGrade` 写一条 `quarter_result`（draft，一任务一条幂等 upsert）。逻辑见 `apps/api/src/modules/quarter/quarter-result.service.ts`。

```mermaid
stateDiagram-v2
    [*] --> draft: compute 合成（scored 任务）
    draft --> draft: 评分会改分（PATCH results/:uid，写 revision + 重算）
    draft --> published: 公示出分（publish，+3 工作日申诉期 + 飞书卡片）
    published --> closed: 申诉处理完锁定（P4）
    published --> [*]
```

- **draft**：评分会可反复改分（`goal_score`/`soft_merged` 重算 total/grade；`total`/`grade` 仅记录），每次写 `quarter_result_revision`（reason 必填）。批量合成会覆盖 draft（改分前执行），故顺序为「合成 → 改分 → 公示」。
- **published**：`publish` 将 cycle 内全部 draft 结果置 published、`appeal_deadline_at = published_at + 3 个工作日`（domain-core `addWorkingDays`，跳周六日），并给每个被评人发飞书卡片（失败 warn 不阻塞）。published 后**禁改分**（`PATCH results` 返回 403）。
- **申诉（quarter_appeal.status）**：`open`（本人 published 且未过 `appeal_deadline_at` 提交，一 result 至多一条 open）→ hr/admin 处理为 `resolved` / `rejected`（resolution 必填）。提交时给 hr 角色绑定用户发卡片。

```mermaid
stateDiagram-v2
    [*] --> open: 本人公示期内提交
    open --> resolved: hr/admin 受理
    open --> rejected: hr/admin 驳回
    resolved --> [*]
    rejected --> [*]
```

## 10. 半年合成 + 定级定岗联动（2026-07-09，P4a）

半年合成不是状态机，是幂等派生：`POST /quarter/half-year/compute {half}`（admin/boss/hr）对该半年（H1=Q1+Q2，H2=Q3+Q4）有 published `quarter_result` 的人算 `halfYearTotal`（双季→`40/60`，仅一季→`single_100`）+ `quarterlyGrade`，upsert 一条 `half_year_result`（唯一 `(half, ratee_user_id)`，可重复执行覆盖）。

定级定岗联动为只读派生，不新建职级记录：

- **快照回填**：`POST /quarter/cycles/:uid/backfill-grade-snapshot`（admin/boss/hr）把 cycle 内每个 published `quarter_result` 回填到该人**最新** `grade_history.score_snapshot`（`{quarter,total,grade,soft_merged,goal_score}`）；无 `grade_history` 记录则跳过 + warn。
- **资格判定**：`GET /quarter/promotion-eligibility?ratee_user_id`（本人/直属/管理角色）读该人 published `quarter_result` 的 (quarter, grade) 序列，`promotionEligible` 纯函数判定——**当季总评 S**，或**连续两季 A 及以上**（S 亦算 A 及以上，两季须相邻）。

> `mergeSoft` 四分支口径（硬化1）：缺席方（管理层/同事）权重并入直属，见 enum-dictionary.md「soft_weights_group」与 spec §4。

## 11. 组织成员生命周期（org_cache —— 2026-07-17，migration 0023）

成员生命周期由两个正交维度组成：**离职（自动、自愈）** 与 **隐藏（手动）**。判定/写入逻辑见 `apps/worker/src/jobs/sync-org-hierarchy.ts`（离职）与 `apps/api/src/modules/org/org.service.ts` `setHidden`（隐藏）。枚举/字段口径见 enum-dictionary.md「org_member_lifecycle」、field-dictionary.md「org_cache 表 — 成员生命周期」。

```mermaid
stateDiagram-v2
    [*] --> 在职: 通讯录同步发现/创建（left_at=NULL）
    在职 --> 离职: sync-org-hierarchy 判定（句柄未出现在本次飞书通讯录枚举中）→ left_at=now
    离职 --> 在职: sync-org-hierarchy 自愈（句柄重新出现）→ left_at=NULL
    在职 --> 隐藏: 管理员手动隐藏（PATCH /org/users/:uid/hidden）→ hidden_at=now
    隐藏 --> 在职: 管理员取消隐藏 → hidden_at=NULL
```

- **在职 ↔ 离职**：完全由 worker `sync-org-hierarchy` 每次全量同步自动判定，**无人工写入/清除 `left_at` 的入口**。判定方式：本次飞书通讯录全量枚举（部门递归 + 成员分页）与 org_cache 现有在册行做差集——句柄不在枚举结果中 → 标记离职；此前已离职的句柄重新出现 → 自愈复职（清空 `left_at`）。受安全阀 `LEAVE_SAFETY_MIN_RATIO=0.5` 保护：枚举数过低（疑似飞书 API 故障）时整体跳过本轮判定，不误伤。
- **隐藏 ↔ 取消隐藏**：完全由管理员手动触发（`PATCH /api/v1/org/users/:user_id/hidden`，仅 `ORG_STRUCTURE_ADMINS` 白名单），按 ou_ 句柄连带同一人名下全部行；**无自动逻辑会置位或清空 `hidden_at`**，同步流程不触碰此字段。
- **两个维度正交、可组合**：离职与隐藏互不驱动，同一行可以同时 `left_at` 与 `hidden_at` 都非空（如离职后又被追加隐藏，或反之）。在册口径统一为「两者皆空」，不因组合方式而有例外。
- **对下游的影响**：不在册（离职或隐藏，任一非空）的成员从组织树默认视图（`GET /org/tree`）、人员搜索（`GET /users/search`）、月度打分开窗花名册（score-window `skippedLeftOrHidden`）三处过滤消失；管理员可用 `?include_hidden=1` 在组织树里看到全部（不在册的以灰态展示，并返回 `hidden_count`）。**历史任务数据、历史打分记录不受影响、不做过滤**（保留原样，符合「历史不动」原则）。
