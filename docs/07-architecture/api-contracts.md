# API 契约草案

> 外部接口主权文档。字段名以 field-dictionary.md 为准。

## 1. 目标

定义前后端与外部集成使用的主要 API 契约。当前为初稿，后续可转为 OpenAPI。

## 2. 通用约定

- Base Path：`/api/v1`
- 所有响应统一包含：`trace_id`
- 时间统一使用 ISO 8601
- 认证方式：飞书登录态 + 服务端 session / JWT

## 3. 通用响应格式

```json
{
  "code": 0,
  "message": "ok",
  "trace_id": "tr_123",
  "data": {}
}
```

## 4. 任务接口

### 4.1 创建任务
`POST /api/v1/tasks`

请求体（用户提交必填字段标 *）：
```json
{
  "title": "完成 4 月经营分析",        // * A 必填
  "detail": "输出经营分析和风险复盘",
  "task_type": "report",               // * A 必填
  "priority": "p1",                    // * A 必填
  "assignee_user_id": "ou_xxx",        // * A 必填
  "due_at": "2026-04-08T18:00:00+08:00", // * A 必填
  "assignment_type": "boss_assign",
  "boss_attention_flag": true
}
```

系统自动填充：`task_uid`、`issuer_user_id`、`assigner_user_id`、`leader_user_id`、`month_bucket`、`status`、`version`、`created_at`、`created_by`

### 4.2 获取任务详情
`GET /api/v1/tasks/{task_uid}`

### 4.3 更新任务
`PATCH /api/v1/tasks/{task_uid}`

请求体必须包含 `version` 用于乐观锁校验：
```json
{
  "version": 3,
  "title": "...",
  "status": "in_progress",
  "progress_percent": 50,
  "latest_progress": "已完成初稿",
  "due_at": "2026-04-10T18:00:00+08:00"
}
```

允许字段：
- `title`
- `detail`
- `status`
- `progress_percent`
- `latest_progress`
- `due_at`
- `completed_at`
- `blocked_reason`
- `delay_reason`
- `version`（必填，乐观锁）

规则：
- `version` 不一致返回 `409 Conflict`
- 响应体附当前最新版本

### 4.4 指派任务
`POST /api/v1/tasks/{task_uid}/assign`

```json
{
  "assignee_user_id": "ou_new",
  "assignment_type": "manager_assign",
  "reason": "调整负责人"
}
```

### 4.5 提交完成
`POST /api/v1/tasks/{task_uid}/complete`

```json
{
  "latest_progress": "已完成并提交验收",
  "completed_at": "2026-04-07T20:30:00+08:00"
}
```

### 4.6 延期申请
`POST /api/v1/tasks/{task_uid}/delay`

```json
{
  "new_due_at": "2026-04-12T18:00:00+08:00",
  "delay_reason": "依赖数据未到齐"
}
```

## 5. 列表接口

### 5.1 我的任务
`GET /api/v1/me/tasks`

Query：
- `status`
- `bucket`
- `priority`
- `page`
- `page_size`

### 5.2 Leader 团队任务
`GET /api/v1/leader/tasks`

### 5.3 老板驾驶舱
`GET /api/v1/dashboard/boss`

## 6. 月结接口

### 6.1 月结 dry-run
`POST /api/v1/monthly-close/dry-run`

### 6.2 执行月结
`POST /api/v1/monthly-close/execute`

### 6.3 获取月报
`GET /api/v1/monthly-close/{month}`

## 7. 同步管理接口

### 7.1 手工重试同步
`POST /api/v1/sync/tasks/{task_uid}/retry`

### 7.2 获取同步日志
`GET /api/v1/sync/logs`

### 7.3 标记冲突已处理
`POST /api/v1/sync/conflicts/{conflict_id}/resolve`

## 8. 鉴权与权限

- 员工仅访问与自己相关的任务
- leader 仅访问自己团队的聚合视图与明细
- 老板与 PMO 可访问全局视图
- 所有写接口必须做角色检查

## 8bis. 月度绩效评分接口（/scores，V1.4 —— 2026-07-08）

响应统一信封 `{ code, message, trace_id, data }`；下表仅描述 `data`。字段为 drizzle 原始行（camelCase），数值 numeric 以字符串返回。

### 8bis.1 列表
`GET /api/v1/scores?month=YYYY-MM&page=&page_size=`
- 可见范围：PMO/Boss/Admin 或 `perf_role.is_leader/is_management` → 全员；否则 leader 看自己打的、员工看自己的。
- `data`：`{ items: MonthlyScore[], total, page, page_size }`。新行含 `templateUid/totalScore/composite/grade/redLine`；旧行 `templateUid=null` 仍用 `score`。

### 8bis.2 详情 / 上下文
`GET /api/v1/scores/{score_uid}` → 单行。
`GET /api/v1/scores/{score_uid}/context` → `{ score, snapshot, prevScore, incidents, picProjects, details }`。`details` 为 V1.4 每维度明细（旧行空数组）。

### 8bis.3 打分表单模板（V1.4 新增）
`GET /api/v1/scores/{score_uid}/template`
- 按该行 `template_uid` 返回 `{ template, dimensions }`（dimensions 含 `code/name/description/weight/sort/anchors`，按 sort 升序）。
- **无 template_uid 的旧行返回 `null`**（前端据此渲染单值只读）。
- 权限：与查看该行一致（含 is_leader/is_management 放宽）。

### 8bis.4 提交打分
`PATCH /api/v1/scores/{score_uid}/score`（draft → scored）
两种请求体（服务端按 `details` 是否存在分流）：
- **V1.4 多维**：`{ details: [{ dimension_code, coefficient }], red_line?, red_line_note?, version }`
  - 校验：维度必须与模板**完全一致**（多/少/重复都拒 `1001`）；每个 `coefficient` 须 >0 且 ≤5（`1001`）；`red_line=true` 必填 `red_line_note`（`1001`）。
  - 服务端用 domain-core 算 `total_score/composite/grade`（红线强制 D），事务写主行汇总 + 明细；红线触发时通知 boss/hr。
- **旧单值（兼容）**：`{ score: 0.0–1.0, version }`（仅无 template_uid 的历史行）。
- 权限：仅 rater。OCC 版本冲突 → `1009`。

### 8bis.5 质疑 / 响应 / 锁定（状态机不变）
- `POST /api/v1/scores/{score_uid}/challenge`：`{ challenge_note?, version }`（scored → challenged，仅 ratee）。
- `POST /api/v1/scores/{score_uid}/resolve`：challenged → pending_lock（仅 rater）。V1.4 行传 `{ details, red_line?, red_line_note?, version }` 重新评分；旧行传 `{ score, version }`。
- `POST /api/v1/scores/{score_uid}/lock`：pending_lock/scored → locked（仅 PMO/Boss/Admin）。

## 8ter. 季度考核评分会 / 合成 / 公示 / 申诉接口（/quarter，P3 —— 2026-07-09）

均在 `AuthGuard` 下；权限见 permission-matrix.md §9。计分一律 import `packages/domain-core`。（P2 周期/打分/同事指定/mgmt 标记/目标接口见 quarter 模块 controller，不在此重列。）

### 8ter.1 合成
- `POST /api/v1/quarter/tasks/{task_uid}/result/compute`：单任务合成，body `{ red_line?, red_line_note? }`（默认 false，省略保留既有值）。任务须 `scored`；已 published 结果 → 400。返回 `quarter_result` 行。
- `POST /api/v1/quarter/cycles/{cycle_uid}/results/compute`：批量合成 cycle 内全部 scored 任务（跳过已公示）。返回 `{ computed, scoredTotal, skippedPublished, results }`。

### 8ter.2 评分会看板
- `GET /api/v1/quarter/cycles/{cycle_uid}/panel`（管理层/boss/admin/hr/pmo）：`{ cycle, summary{enrolledCount,scoredCount,computedCount,publishedCount}, distribution{gradeCounts,buckets}, rows[三方分解+result], managerAverages[各直属打分均值], sList, dList }`。

### 8ter.3 改分 / 公示
- `PATCH /api/v1/quarter/results/{result_uid}`（管理层/boss/admin）：`{ field: goal_score|soft_merged|total|grade, after, reason }`。goal_score/soft_merged 重算 total/grade；total/grade 仅记录。写 `quarter_result_revision`。published 后 → 403。
- `POST /api/v1/quarter/cycles/{cycle_uid}/publish`（admin/boss/hr）：全部 draft → published，`appeal_deadline_at = published_at + 3 工作日`，发公示卡片。返回 `{ published, appealDeadlineAt, quarter }`。无 draft → 400。

### 8ter.4 被评人视角
- `GET /api/v1/quarter/my-result?cycle={cycle_uid}`：本人结果。未公示 → 403；无结果 → `{ result: null }`；已公示 → `{ result, appeal, canAppeal }`。
- `GET /api/v1/quarter/results/{result_uid}`（本人公示后 / 直属 / 管理角色）：`{ result, revisions, appeals, isSelf, canAppeal }`。

### 8ter.5 申诉
- `POST /api/v1/quarter/results/{result_uid}/appeal`（仅本人）：`{ content }`。须 published 且未过 `appeal_deadline_at`；一 result 一条 open（否则 400）。提交后通知 hr。
- `PATCH /api/v1/quarter/appeals/{appeal_uid}`（hr/admin）：`{ status: resolved|rejected, resolution }`。已处理再处理 → 400。
- `GET /api/v1/quarter/appeals?cycle={quarter|cycle_uid}`（hr/admin）：`{ items[] }`。cycle 兼容 `YYYY-QN`（自动解析 cycle_uid）与 cycle_uid；缺参 400，quarter 不存在 404。

## 8quater. 季度半年合成 / 定级定岗联动 / CSV 导出（/quarter，P4a —— 2026-07-09）

均在 `AuthGuard` 下；权限见 permission-matrix.md §10。计分/资格一律 import `packages/domain-core`（`halfYearTotal`/`quarterlyGrade`/`promotionEligible`/`quartersForHalf`）。

半年合成（A）：
- `POST /api/v1/quarter/half-year/compute`（admin/boss/hr）：body `{ half: 'YYYY-H1'|'YYYY-H2' }`。对该半年（H1=Q1+Q2，H2=Q3+Q4）有 published `quarter_result` 的人 upsert 一条 `half_year_result`（唯一 `(half,ratee)`，幂等）。返回 `{ half, prevQuarter, currQuarter, synthesized, results[] }`。非法 half → 400。
- `GET /api/v1/quarter/half-year?half={YYYY-HN}&ratee_user_id={?}`：给 `ratee_user_id` → 本人/直属/管理角色可读该人；不给 → 仅管理角色读全部。返回 `{ half, items[] }`。

定级定岗联动（B）：
- `GET /api/v1/quarter/promotion-eligibility?ratee_user_id={id}`（本人/直属/管理角色）：读该人 published 结果 (quarter, grade) 序列，`promotionEligible` 判定。返回 `{ rateeUserId, eligible, reason, basis[], history[] }`（当季 S 或连续两季 A 及以上）。
- `POST /api/v1/quarter/cycles/{cycle_uid}/backfill-grade-snapshot`（admin/boss/hr）：把 cycle 内每个 published 结果回填该人**最新** `grade_history.score_snapshot`（`{quarter,total,grade,soft_merged,goal_score}`）；无记录跳过 + warn。返回 `{ quarter, publishedCount, backfilled, skipped[] }`。

CSV 导出（C）：
- `GET /api/v1/quarter/cycles/{cycle_uid}/export.csv`（admin/hr/pmo/boss）：**非 JSON 信封**，`Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment`，UTF-8 BOM 防 Excel 中文乱码。列：姓名/部门/类型/目标分/直属软项/同事软项/管理层均值/软项合成/总分/评级/权重组/是否红线。

## 8quinquies. 我的绩效 / 目标提案 / 月度 CSV（P4b —— 2026-07-09）

均在 `AuthGuard` 下；权限见 permission-matrix.md §11。

个人绩效聚合：
- `GET /api/v1/me/performance`（本人）：`{ monthlyTrend:[{month,totalScore,composite,grade,redLine}], quarterResults:[{resultUid,quarter,total,grade,softMerged,goalScore,sheetType,status,appealDeadlineAt}], halfYearResults:[{resultUid,half,total,grade,formula}], grade, promotion:{eligible,reason,basis[]} }`。复用现有 service 组装，不重复计分。

半年目标提案流（§10.4；直属设定、双方发起、直属确认留痕）：
- `POST /api/v1/quarter/goals`（直属/admin）：`{ ratee_user_id, half, content }` 设定/覆盖正式目标。
- `PUT /api/v1/quarter/goals/{goal_uid}`（直属/admin）：改正式内容，写 `quarter_goal_revision`。
- `POST /api/v1/quarter/goals/{goal_uid}/propose`（**被评人本人**）：`{ content }` 写 pending 提案（`proposed_content/by/at`），不动正式内容；已有 pending → 400。
- `PATCH /api/v1/quarter/goals/{goal_uid}/confirm`（**直属/admin**）：`{ accept, reason? }`。accept=true 应用提案为正式内容 + 写 revision + 清 pending；false 驳回（不改正式、留痕原提案）。无 pending → 400。
- `GET /api/v1/quarter/goals/{goal_uid}/revisions`（本人/直属/管理角色）：调整历史。

月度综合系数导出：
- `GET /api/v1/quarter/monthly/export.csv?month={YYYY-MM}`（admin/hr/pmo/boss）：**非 JSON 信封**，UTF-8 BOM。列：姓名/部门/月份/综合系数/评级/是否红线。部门名 join `org_cache.dept_name`（双命名空间）。

卡片通知（非接口，仅升级）：`FeishuMessengerService` 加 `sendCardToUser`（interactive）；公示/申诉/同事被指定改发交互卡片（quarter-cards.ts）；worker 开窗/截止催办卡片（message-builder + quarter-deadline-reminder job）。**本地凭证为空 stub，靠单测+dry-run 验证，非实发。**

## 9. 错误码建议

- `1001` 参数非法
- `1002` 无权限
- `1003` 任务不存在
- `1004` 状态流转非法
- `1005` 同步冲突
- `1006` 外部系统调用失败
- `1007` 月结已锁定
- `1009` 版本冲突（409）
