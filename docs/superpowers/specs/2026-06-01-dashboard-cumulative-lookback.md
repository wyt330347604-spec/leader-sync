# 驾驶舱口径对齐累计版 + 上月回看包含被继承任务

## 1. 背景与问题

1. **回看上月分母丢任务**：驾驶舱所有查询按 `task.month_bucket` 过滤（`dashboard.service.ts:222` 等）。月结继承会把未完成任务的 `month_bucket` 从 M 改成 M+1。于是回看 M 月概览时，实时统计只剩 M 月已完成的任务 → 分母塌缩、完成率虚高 100%、被继承走的任务从分解卡片消失。
2. **实时率口径与快照不一致**：前端概览顶行（`page.tsx:170-204`）用 `done/total`、`overdue/total`（total=bucket 内全部任务）现算 rate，与月结快照的累计口径（分母=`due_at≤月末且非shelved`）不一致，且**完全没读后端已返回的 snapshot**。

## 2. 决策记录（已确认 2026-06-01）
- **Q1 已结月份概览顶部口径**：冻结快照优先。已结单月的 总/完成/延期/完成率/延期率 取自 `monthly_snapshot`，与月报/打分口径一致，不随后续状态漂移。
- **Q2 分解是否同修**：是。leader/人员/项目分解在回看上月时也要含被继承走的任务（按 `source_month` 归属重算）。分解为实时状态、非冻结，允许与顶部快照数字微差。

## 3. 设计

### 3.1 归属月份查询谓词（核心，一处改动修两个问题）
**关键纠正**：`source_month` 存的是「最初归属月」，多次继承的任务其值会**早于**回看月（如 carry_over_count=4 的任务 source_month=2026-02）。故 `source_month = M` 等值判断会漏掉长期积压任务（实测 2026-05 回看：等值只捞 38 条，正确应 412 条）。

正确谓词用**区间相交**——任务存活区间 `[source_month(未继承则=自身桶) .. month_bucket]` 与周期 `[periodStart..periodEnd]` 有交集：
```
month_bucket >= periodStart
AND COALESCE(source_month, month_bucket) <= periodEnd
AND deleted_at IS NULL
```
- 已完成留在 M 月：`month_bucket=M ≥ M` ✓，`coalesce=M ≤ M` ✓。
- 被继承走（现 bucket>M，source≤M）：`bucket≥M` ✓，`coalesce=source≤M` ✓。
- 当前月新建任务：`bucket=M≥M` ✓，`coalesce=M≤M` ✓；不会误纳入更早月份回看（`coalesce=M > 更早月` 被排除）。
- 单月与季度（多桶）统一适用（periodStart/End 取桶区间首尾）。
- 实测：2026-05 区间谓词 = 412 条（23 done 留存 + 389 继承出且 source≤2026-05），符合预期。

→ 因 leader/人员/项目/风险/分解全部遍历同一 `tasks` 数组，此谓词一次性修复 Q2 + 分母。

### 3.2 顶部 stats 口径（Q1）
`getBossDashboard` 计算 `stats` 时：
- **单月且存在 company 快照**（= 已结月份）：`total/done/overdue/carryOver/doneRate/overdueRate` 取自快照（`monthDueCount/monthDoneCount/monthOverdueCount/monthCarryOverCount` + `doneRate/overdueRate`）。周新增/周完成仍实时。
- **当前月（无快照）/ 多月**：实时计算，但改为**累计口径**（与 `monthly-close-stats.computeStats` 一致）：
  - `total(应完成) = due_at ≤ periodEnd 且 status≠shelved`
  - `done = due_at ≤ periodEnd 且 status=done`
  - `overdue = due_at ≤ periodEnd 且 status∉{done,shelved,closed}`
- 前端 `page.tsx` 顶行无需改动（继续从 stats.total/done/overdue 现算 rate；后端已填权威值）。
- 返回的 `snapshot` 对象补 `monthDueCount` 字段。

### 3.3 同源问题的其余方法（已对齐，第二批）
`getGanttData`、`getLeaderMonthly`、`getMyMonthly`、`getLeaderMemberTasks` 同样按 `month_bucket` 过滤、同有回看丢任务问题。已抽共享 helper `belongsToMonths(buckets)`（区间谓词，getBossDashboard 也改用）统一套用：
- `getGanttData`：`inArray(monthBucket)` → `belongsToMonths(buckets)`。
- `getLeaderMonthly` / `getMyMonthly` / `getLeaderMemberTasks`：`eq(monthBucket,bucket)` → `belongsToMonths([bucket])`，assignee/权限过滤保留。
- `getLeaderWeekly` **无需改**：它本就查全部任务（跨月周视图），无 bucket 过滤，无回看 bug。
口径策略：这批是「实时明细视图」，本次只套区间谓词（被继承任务回到分母/明细），保留各自现有 `done/total` 计数口径，不引入 due-based 累计（避免一次改太多数字）。各加谓词断言测试（SQL 含 source_month）。

## 4. 变更文件
- `apps/api/src/modules/dashboard/dashboard.service.ts`（谓词 + 顶部 stats 口径 + snapshot 补字段）
- `apps/api/src/modules/dashboard/__tests__/dashboard.service.spec.ts`（新增回归用例）
- 前端无需改动（验证：顶行读 stats，分解读各 summary 数组）。

## 5. 测试计划（QC：先红后绿）
1. RED：回看已结月份（mock：23 done in-bucket + 412 carried with source_month=M）→ 断言旧谓词下分解/分母丢掉 412 条。
2. GREEN：新谓词下 total 含 412 条；已结月份 stats 来自快照（total=431）。
3. 当前月累计口径：not-yet-due / shelved 不计入分母；done+overdue 与 due 集合一致。
4. 当前月 source_month 不误纳（无快照走实时分支）。

## 6. 已知取舍 / 遗留
- 分解 done/overdue 用任务**当前**状态（非月末冻结），故 leader/人员合计可能与顶部快照微差（Q2 已接受）。
- 实时驾驶舱与快照在「已结月份」一致；当前月用累计口径，月末翻篇时数字连续。
- UI 无代码改动，但渲染数字变化 → 交付后建议本地 seed 继承场景做一次截图核对（QC #2）。
- **预存缺陷（非本次引入）**：`getLeaderWeekly` 的 2 个单测（per-member / teamSummary counts）依赖真实 wall-clock「本周」，fixture 用 5 月日期，今天 6 月 → 必失败。对已提交原始代码同样失败（实为 3 个）。属测试时间耦合问题，需后续用 `vi.setSystemTime` 固定时钟修复，不在本次范围。
- **当前月可见变化**：6 月实时概览改累计口径后，被继承进来的逾期任务计入分母与延期数 → 延期率会显著高于旧的 done/total 口径。这是「累计积压口径」的预期表现（与用户决策一致）。
