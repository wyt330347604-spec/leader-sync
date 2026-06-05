# 月结崩溃修复 + 延期率口径修正（2026-06-01 事故）

## 1. 事故事实（已用生产日志 + DB 验证）

- 2026-06-01 00:00 UTC，`monthly-close` 作业处理 2026-05 时崩溃。
- 日志：`Stats: ... overdue=413 ... Rates: ... overdue=1251.5%` → `PostgresError 22003 numeric field overflow` at `monthly-close.ts:72`（写 `monthly_snapshot`）。
- 该 insert 在 **Step 4（生成快照）**，而**继承移动在 Step 5**，且 Step 4 无 try-catch → 整个作业 abort。
- 后果（DB 实测）：
  - `2026-06` 桶仅 1 条、`is_carried_over=false` → **继承未执行**。
  - `2026-05` 桶仍有 412 条未完成任务卡住（done 23 / in_progress 74 / not_started 200 / pending 138）。
  - `monthly_snapshot(2026-05)` = 0 行；无月报推送；无打分草稿。
- 每月 1 号确定性复发。

## 2. 根因

1. **分子口径错误**：`monthOverdueCount` 用 `due_at ≤ 月末 && !done`（累计积压，413），违反主权文档 §2.6「本月延期未完成」（应为**本月到期**且未完成）。分子(413) ≫ 分母(33) → 延期率 12.5。
2. **存储溢出**：`monthly_snapshot.done_rate / overdue_rate` 为 `numeric(5,4)`（上限 9.9999），存不下 ≥10 的值 → 22003。
3. **故障未隔离**：快照写入失败连带阻断了核心的继承移动。

> 注：`doneRate = 本月完成 / 本月到期` 同样存在潜在溢出（若某月完成数 ≫ 本月到期数，例如集中清理积压），需一并兜底。

## 3. 修复方案（已确认：累计积压口径，延期率回到 0–100%）

### 3.1 口径修正（累计口径，分子分母同时改为累计 → 需更新主权文档）
- **分母 `monthDueCount`（重定义为累计）**：`due_at ≤ 本月末 && status ∉ {shelved} && 未删除`（去掉原"本月内"下界；含已完成，作为"截至本月末应完成"的全集）。
- **延期分子 `monthOverdueCount`（累计，维持现状）**：`due_at ≤ 本月末 && status ∉ {done,shelved,closed}` = 413。
- **完成分子 `monthDoneCount`（改为累计子集，保持与分母同集合）**：`due_at ≤ 本月末 && status = done`（原口径是"completed_at 落在本月"，改为"累计应完成集合中已完成的"，使完成率/延期率互补、分母统一）。
- 同步修正 per-assignee 快照（`monthly-close.ts:100-103`）同一组逻辑。
- 结果：`完成率 + 延期率 ≈ 1`，两者值域 [0,1]，分母统一 = 累计 `month_due_count`，符合 §3「分母统一」。
- **列宽**：累计口径下 rate ≤ 1，`numeric(5,4)`（≤9.9999）足够，**无需扩列**。
- **影响**：延期率从此反映全部跨月积压（413 条计入）。完成率语义由"本月完成"变为"累计应完成中已完成"，需在驾驶舱/月报说明同步。

### 3.2 防御兜底
- 写库前对两个 rate `clamp` 到 ≤ 9.9999（即便未来分子再异常也不溢出）。

### 3.3 故障隔离（核心）
- 把 Step 4（快照）+ Step 6（月报）各自包 try-catch（仿现有 Step 7），保证 **Step 5 继承移动永不被统计/通知失败阻断**。
- 快照统计取自 Step 2 的内存数组，与 Step 5 的 DB 移动无先后依赖，隔离即可，无需调序。

### 3.4 dry-run / skip-notifications 支持
- 给 `runMonthlyClose(opts?: { dryRun?: boolean; skipNotifications?: boolean })` 加参数（满足 CLAUDE.md「所有定时任务必须支持 dry-run」）。
- 数据补救重跑用 `skipNotifications: true`，只做继承 + 快照，避免给全员补发延迟的飞书卡片。

## 4. 数据补救（独立于代码部署）

- 修复部署后，对 2026-05 执行一次 `runMonthlyClose({ skipNotifications: true })`（今日 `now` 仍指向 5 月，会捡起 412 条移到 6 月并生成 2026-05 快照）。
- 重跑前确认 `monthly_snapshot(2026-05)=0`（当前成立），避免重复插入；如非 0 需先清理该 run。

## 5. 变更文件清单
- `apps/worker/src/jobs/monthly-close.ts`（累计口径 + clamp + try-catch 隔离 + `opts: {dryRun, skipNotifications}`）
- `apps/worker/src/jobs/__tests__/monthly-close.spec.ts`（新增回归测试，vi.mock `@leader-sync/db` + `feishu-api`）
- `docs/02-data/metrics-definition.md`（改写 §2.2/2.3/2.4/2.6/3 为累计口径，标注本次口径变更生效月份）

## 6. 测试计划（QC：先红后绿）
1. RED：构造「累计积压 ≫ 本月到期」的任务集，断言旧逻辑下作业抛错 / 继承未执行 → 复现。
2. GREEN：修复后 `overdueRate ≤ 1`，且即使快照 insert 抛错，`task.update`（继承移动）仍对全部非完成任务被调用。
3. clamp 单测：极端分子下 rate 落到 9.9999 不溢出。
4. 口径单测：延期分子只计本月到期未完成。

## 7. 决策记录（已确认 2026-06-01）
- **Q1 口径范围**：采用「累计积压口径」——分子分母同改累计，完成率/延期率互补，更新主权文档 §2.2/2.3/2.4/2.6/3。无需扩列宽。
- **Q2 补发通知**：补救重跑 `skipNotifications: true`，只补继承 + 快照，不给全员补发飞书卡片。
