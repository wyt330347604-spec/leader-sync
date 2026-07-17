# 权限矩阵

## 1. 角色定义

### 1.1 员工
- 默认只看自己相关任务
- 更新进展
- 标记完成
- 发起协同

### 1.2 Leader
- 查看本团队任务
- 分派团队内任务
- 验收、退回、改期
- 查看团队月度结果

### 1.3 老板
- 查看全量
- 发起重点任务
- 查看老板驾驶舱
- 调整重点关注

### 1.4 PMO / 运营
- 维护月结与提醒规则
- 处理冲突
- 管理统计口径
- 辅助老板运营系统

### 1.5 系统管理员
- 维护技术配置
- 不直接处理业务口径

## 2. 功能权限矩阵

| 操作 | 员工 | Leader | 老板 | PMO/运营 | 系统管理员 |
|---|---|---|---|---|---|
| 查看自己的任务 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看团队任务 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 查看全公司任务 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 查看「我的完成情况」驾驶舱 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 查看「我的团队」驾驶舱 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 查看「全员概览/甘特」驾驶舱 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 创建任务 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 指派任务 | ⚠️ | ✅ | ✅ | ✅ | ❌ |
| 修改负责人 | ❌ | ✅ | ✅ | ✅ | ❌ |
| 修改标题/详情 | ⚠️ | ✅ | ✅ | ✅ | ❌ |
| 修改截止日期 | ⚠️ | ✅ | ✅ | ✅ | ❌ |
| 更新进展 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 标记完成 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 验收任务 | ❌ | ✅ | ✅ | ✅ | ❌ |
| 退回任务 | ❌ | ✅ | ✅ | ✅ | ❌ |
| 申请延期 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 标记老板关注 | ❌ | ❌ | ✅ | ✅ | ❌ |
| 查看同步日志 | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| 处理同步冲突 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 执行月结 | ❌ | ❌ | ❌ | ✅ | ❌ |
| 修改系统配置 | ❌ | ❌ | ❌ | ❌ | ✅ |

> **驾驶舱权限落地说明**：全员概览（`GET /api/v1/dashboard/boss`）与甘特图（`GET /api/v1/dashboard/gantt`）在服务端强制校验角色，仅 `boss / pmo / admin` 放行，其余角色返回 `1002 NO_PERMISSION`（HTTP 403）。前端按角色隐藏对应 tab，且无权限时不发起这两个请求。校验逻辑见 `apps/api/src/modules/dashboard/dashboard.controller.ts`，回归用例见 `dashboard.controller.spec.ts`。

## 3. 行级可见性规则

### 员工可见
- 我负责的
- 我发起的
- 我协同的
- 与我有关且被授权共享的

### Leader 可见
- 我团队成员负责的
- 我发起的
- 需要我验收的
- 我所在管理范围内的

### 老板可见
- 全部任务
- 全部统计
- 全部月结快照
- 全部重点事项

### PMO / 运营可见
- 全量业务任务
- 同步日志
- 月结记录
- 冲突记录

## 4. 字段级编辑权限建议

| 字段类别 | 员工 | Leader | 老板 | PMO/运营 | 说明 |
|---|---|---|---|---|---|
| 任务标题/详情 | 部分 | ✅ | ✅ | ✅ | 员工仅限自己发起或授权项 |
| 负责人 | ❌ | 团队内 | ✅ | ✅ | 结构字段 |
| 发起人/指派人 | ❌ | 部分 | ✅ | ✅ | 原则上自动记录 |
| 状态/进展 | ✅ | ✅ | ✅ | ✅ | 执行字段 |
| 老板关注（管理标记） | ❌ | ❌ | ✅ | 受托 | 仅老板/PMO，不属于普通业务字段 |
| 派生统计字段 | ❌ | ❌ | ❌ | ❌ | 仅系统写 |

## 5. 数据操作边界

- 技术管理员不得直接修改业务统计口径
- PMO 不得越权修改系统安全配置
- 员工不可直接修改系统派生字段
- 飞书任务侧不得修改业务结构字段

## 6. 组织映射原则

权限判断依赖以下因素共同决定：

- 当前登录用户角色
- 当前登录用户所在部门
- 当前登录用户是否为负责人直属上级
- 当前登录用户是否为任务发起人/指派人
- 任务是否被老板关注

## 7. 组织架构（/org，2026-07 新增）

| 端点 | 员工 | Leader | 老板 | PMO | Admin | 说明 |
|---|---|---|---|---|---|---|
| `GET /api/v1/org/tree` | ✅ | ✅ | ✅ | ✅ | ✅ | 组织树只读，任意登录用户；默认只返回在册（`left_at`/`hidden_at` 皆空）成员 |
| `GET /api/v1/org/tree?include_hidden=1` | ❌ | ❌ | ❌ | ❌ | ❌ | **仅对 ORG_STRUCTURE_ADMINS（Harvey/杨平）生效**：非白名单用户即使传该参数，服务端也按普通请求处理（`effectiveIncludeHidden = includeHidden && canEditOrg(requester)`），不返回离职/隐藏成员。白名单用户可见离职/隐藏成员（前端灰态展示），响应额外带 `hidden_count` |
| `PATCH /api/v1/org/users/:user_id/manager` | ❌ | ❌ | ❌ | ❌ | ❌ | **白名单制（2026-07-02 决策）：仅 Harvey/杨平（user_id/open_id 匹配，不走角色）**。拖拽调整上级（写 manager_source='manual'，防环校验） |
| `POST /api/v1/org/users/:user_id/manager/reset` | ❌ | ❌ | ❌ | ❌ | ❌ | 同上白名单。恢复飞书默认（下次通讯录同步刷新） |
| `PATCH /api/v1/org/users/:user_id/hidden` | ❌ | ❌ | ❌ | ❌ | ❌ | **同上白名单制（ORG_STRUCTURE_ADMINS，2026-07-17 新增，migration 0023）**：仅 Harvey/杨平可手动隐藏/取消隐藏成员（`{hidden: boolean}`）。写/清 `hidden_at`+`hidden_by`，按 ou_ 句柄连带同一人全部行。`left_at`（离职）无对应手动端点，仅由 `sync-org-hierarchy` 自动判定/自愈 |

上下级数据来源：飞书通讯录每日 07:00 同步（`sync-org-hierarchy` worker job）；`manual` 行同步不覆盖。该关系是月度绩效打分 rater 的唯一来源（月结 Step 6）。同一 worker job 每次同步也顺带做离职判定（自动 + 自愈，安全阀 `LEAVE_SAFETY_MIN_RATIO=0.5`），见 state-machine.md §11 / enum-dictionary.md「org_member_lifecycle」。

组织架构编辑白名单为过渡方案；规划中的**标签体系**（BOSS/HR/PMO 同级最高 > CORE > LEADER，一人多标签、按最高标签生效）落地后由标签接管，见 spec `2026-07-02-monthly-score-org-sync.md` 附录。

## 8. 月度绩效评分（/scores，V1.4 —— 2026-07-08）

月度打分的行级可见性与写入权限（服务端 `apps/api/src/modules/monthly-score/monthly-score.service.ts` 强制校验）：

| 动作 | 被评人(ratee) | 评分人(rater=直属) | perf_role.is_leader / is_management | PMO/Boss/Admin | 说明 |
|---|---|---|---|---|---|
| 查看某人月度分（list / detail / context / template） | ✅(自己) | ✅(自己打的) | ✅**(任意行)** | ✅(全量) | **V1.4 放宽**：`perf_role.is_leader` 或 `is_management` 可读全员月度分 |
| 提交/修改多维系数（PATCH `/score`、resolve 再评） | ❌ | ✅ | ❌(仅可看) | ❌ | 仅直属 rater；红线勾选须填说明 |
| 发起质疑（challenge） | ✅ | ❌ | ❌ | ❌ | 仅被评人本人（scored 且未锁定） |
| 最终锁定（lock） | ❌ | ❌ | ❌ | ✅ | 仅 PMO/Boss/Admin（RBAC 角色） |

> **可见性放宽落地说明**：`perf_role` 是飞书群同步得来的绩效身份（`is_leader` = leader 群成员、`is_management` = 管理层群成员），**与 RBAC 角色（admin/pmo/boss/hr/leader/employee）两套不混**。放宽仅作用于「查看」：`canView` 先判直接可见（ratee/rater/PMO·Boss·Admin），未命中再查 `perf_role`，`is_leader || is_management` 放行任意行；列表页同理（这类旁观者不加 user 过滤，看全员）。写入（打分/质疑/锁定）不放宽。回归用例见 `monthly-score.service.spec.ts`「可见性放宽」describe。
>
> **红线通知**：多维打分勾选红线（强制 D）时，服务端用 `FeishuMessengerService` 给 `user_role_binding` 中 role ∈ (`boss`,`hr`) 的绑定用户发文本通知；发送失败只 warn 不阻塞打分结果。

## 9. 季度评分会 / 合成 / 公示 / 申诉（/quarter，P3 —— 2026-07-09）

服务端强制校验（`apps/api/src/modules/quarter/quarter-result.service.ts`）。「管理层」= `perf_role.is_management`（飞书群同步身份，与 RBAC 两套不混）；其余为 RBAC 角色。

| 动作 | 本人(ratee) | 直属(manager) | 管理层(is_management) | hr | pmo | boss | admin | 说明 |
|---|---|---|---|---|---|---|---|---|
| 召集评分会（convene-panel） | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | scoring→panel + panel_at + 发管理层召集卡；已 panel/published 幂等跳过；goal_check→400。worker `convene-panel-check` 全 scored 时自动同口径 |
| 看评分会看板（panel） | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 非管理层/非上述 RBAC → 403 |
| 合成结果（compute / 批量） | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 任务须 scored；已公示结果不可重算（400） |
| 评分会改分（PATCH results，留痕） | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | reason 必填；published 后 403 |
| 公示出分（publish） | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | 无 draft 结果 → 400；申诉期 +3 工作日 |
| 看本人结果（my-result / result 详情） | ✅(公示后) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 本人未公示 → 403；直属/管理角色可看草稿 |
| 提交申诉（appeal） | ✅(公示后·期限内) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 仅本人；过期 400；重复 open 400 |
| 处理申诉（PATCH appeals） | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | resolution 必填；已处理再处理 400 |
| 申诉列表（GET appeals） | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | hr/admin |

> **落地说明**：`convenePanel = RBAC∈{admin,boss,hr}`（`QuarterService.convenePanel`）；`canPanel = RBAC∈{admin,pmo,boss,hr} ∪ is_management`；`canRevise = RBAC∈{admin,boss} ∪ is_management`；`publish = RBAC∈{admin,boss,hr}`；`处理/列表申诉 = RBAC∈{admin,hr}`。**公示 / 申诉通知**：`publish` 给每个被评人、`appeal` 提交给 hr 角色绑定用户发飞书文本卡片（`QuarterNotifierService` → `FeishuMessengerService`），失败 warn 不阻塞。回归用例见 `quarter-result.service.spec.ts`。

## 10. 季度半年合成 / 定级定岗联动 / 导出（/quarter，P4a —— 2026-07-09）

服务端强制校验（`quarter-result.service.ts`）。行级读权限中「直属」指 `org_cache.manager_user_id === 当前用户`。

| 动作 | 本人(ratee) | 直属(manager) | 管理层(is_management) | hr | pmo | boss | admin | 说明 |
|---|---|---|---|---|---|---|---|---|
| 合成半年成绩（POST half-year/compute） | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | admin/boss/hr；非法 half → 400 |
| 看半年成绩（GET half-year，给 ratee_user_id） | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 本人/直属/管理角色（admin,pmo,boss,hr）可读 |
| 看半年成绩（GET half-year，不给 ratee → 全部） | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | 仅管理角色 |
| 定级定岗资格（GET promotion-eligibility） | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 本人/直属/管理角色 |
| 回填职级快照（POST cycles/:uid/backfill-grade-snapshot） | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | admin/boss/hr；无 grade_history 跳过 + warn |
| 导出结果 CSV（GET cycles/:uid/export.csv） | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | admin/hr/pmo/boss；UTF-8 BOM + `text/csv` |

> **落地说明**：`半年合成 / 回填快照 = RBAC∈{admin,boss,hr}`；`导出 CSV = RBAC∈{admin,hr,pmo,boss}`；`看半年成绩（指定 ratee）/ 定级资格 = 本人 ∪ 直属 ∪ RBAC∈{admin,pmo,boss,hr}`；不给 ratee 的半年列表仅管理角色。回归用例见 `quarter-result.service.spec.ts`（computeHalfYear / getHalfYear / getPromotionEligibility / backfillGradeSnapshot / exportCycleCsv）。

## 11. 我的绩效 / 半年目标提案（P4b —— 2026-07-09）

| 动作 | 本人(ratee) | 直属(manager) | 管理层 | hr | pmo | boss | admin | 说明 |
|---|---|---|---|---|---|---|---|---|
| 我的绩效聚合（GET /me/performance） | ✅ | — | — | — | — | — | — | 仅本人（返回自己的月度/季度/半年/资格） |
| 设定/改目标（POST goals · PUT goals/:uid） | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | 直属或 admin；PUT 写 revision |
| 发起目标调整建议（POST goals/:uid/propose） | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **仅被评人本人**；已有 pending → 400 |
| 确认/驳回提案（PATCH goals/:uid/confirm） | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | 仅直属/admin；accept 应用+写 revision，reject 留痕 |
| 看目标/调整记录（GET goals · goals/:uid/revisions） | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 本人/直属/管理角色 |
| 导出月度综合系数 CSV（GET monthly/export.csv） | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | admin/hr/pmo/boss；UTF-8 BOM |

> **落地说明**：目标提案流是「本人发起 → 直属确认留痕」的两段式（§10.4 决策）；`propose` 仅本人、`confirm` 仅直属/admin，服务端 `assertGoalProposer`/`assertGoalWriter` 强制。回归用例见 `quarter.service.spec.ts`（proposeGoalChange / confirmGoalProposal）。前端 `/me/goals` 默认自评视图（可 propose），`?ratee=` 供直属视图（可 set/confirm），角色由后端 guard 兜底。
