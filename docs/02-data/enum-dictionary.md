# 枚举字典

> 本文件是所有枚举值的业务语义主权来源。其他文档引用枚举时以本文件为准。

## 1. task_type

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| strategy | 战略事项 | 公司级、季度级、方向性事项 |
| operation | 运营事项 | 日常经营与推进事项 |
| project | 项目事项 | 明确项目归属 |
| report | 汇报事项 | 汇报、材料、总结 |
| meeting | 会议事项 | 会议准备、复盘、协调 |
| collaboration | 协同事项 | 跨团队协同事项 |
| follow_up | 督办事项 | 重点跟进与催办 |
| other | 其他 | 临时分类 |

## 2. priority

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| p0 | 极高 | 最高优先级，老板关注或重大风险 |
| p1 | 高 | 高优先级 |
| p2 | 中 | 正常优先级 |
| p3 | 低 | 低优先级 |

## 3. assignment_type

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| boss_assign | 老板指派 | 老板直接指派给负责人 |
| manager_assign | 上级指派 | 上级对下级任务分派 |
| peer_collaboration | 平级协同 | 平级之间协作 |
| self_claim | 自领 | 负责人主动认领 |
| carry_over | 系统继承 | 从上月结转 |

## 4. status

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| draft | 草稿 | 刚创建，尚未正式派发 |
| assigned | 已指派 | 已分配负责人 |
| in_progress | 进行中 | 正在处理 |
| blocked | 阻塞 | 因外部因素阻塞 |
| pending_review | 待验收 | 执行完成，待确认 |
| done | 已完成 | 业务上已完成 |
| reopened | 重新打开 | 已完成后被重新打开 |
| cancelled | 已取消 | 不再继续执行 |
| closed | 已归档 | 已结束并归档 |

## 5. sync_status

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| pending | 待同步 | 尚未执行同步 |
| syncing | 同步中 | 正在执行 |
| retrying | 重试中 | 失败后自动重试，允许落库 |
| success | 成功 | 同步成功 |
| failed | 失败 | 同步失败，已超出重试上限 |
| conflict | 冲突 | 同步冲突，待裁决 |
| manual_review | 人工处理中 | 冲突后进入人工处理队列 |
| skipped | 跳过 | 按规则无需同步或主动跳过 |

## 6. source_type

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| bitable | 多维表格 | 表格侧来源 |
| task | 飞书任务 | 任务侧来源 |
| calendar | 飞书日历 | 日历侧来源 |
| card | 飞书卡片 | 卡片交互来源 |
| api | 网页应用/API | 系统页面来源 |
| system | 系统 | 定时任务、月结等 |

## 7. role_scope

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| employee | 员工 | 个人维度 |
| leader | Leader | 团队维度 |
| company | 公司 | 全局维度 |

## 8. conflict_resolution_status

| 枚举值 | 中文含义 | 说明 |
|---|---|---|
| resolved_keep_local | 保留中心主档 | 采纳本地值 |
| resolved_accept_remote | 接受外部变更 | 采纳外部值 |
| resolved_merge | 合并 | 字段级合并 |
| resolved_manual_override | 人工强制覆盖 | 人工指定最终值 |
| unresolved_pending_review | 待处理 | 尚未裁决 |

## project_category（业务板块）

| 值 | 中文 | 显示顺序 | 颜色 token |
|---|---|---|---|
| `jt` | 集团 | 1 | `--cat-jt` (#475569) |
| `zy` | 自营 | 2 | `--cat-zy` (#DC2626) |
| `fw` | 服务 | 3 | `--cat-fw` (#EA580C) |
| `tz` | 投资 | 4 | `--cat-tz` (#059669) |
| `hz` | 合作 | 5 | `--cat-hz` (#2563EB) |

## project_region（国家/地区）

固定枚举（页面 select 用此清单）：

- `印度`
- `印尼`
- `巴基斯坦`
- `孟加拉`
- `深圳`

集团板块的项目（如"公司建设"）可以不填 region。

## manager_source（上下级关系来源）

`org_cache.manager_source`，migration 0015。写入侧仲裁：通讯录同步跳过 `manual` 行。

| 值 | 含义 |
|---|---|
| `feishu` | 飞书通讯录同步写入（默认） |
| `manual` | 组织架构图人工拖拽调整（同步不覆盖；「恢复飞书默认」改回 feishu 并立即回填） |

## user_role（应用角色，`user_role_binding.role`）

应用 RBAC 角色（与绩效打分身份 `perf_role` 两套不混）。定义在 `packages/shared-types/src/enums.ts` `UserRole`。

| 值 | 含义 | 说明 |
|---|---|---|
| `employee` | 员工 | 默认角色 |
| `leader` | Leader | 团队负责人 |
| `boss` | 老板 | 全公司可见 |
| `pmo` | PMO | 项目管理 |
| `admin` | 管理员 | 系统管理 |
| `hr` | HR | 绩效申诉受理人（建议绑杨平）。2026-07-08 新增，仅类型/常量，权限逻辑另行接入 |

## score_template_code（打分模板编码）

`score_template.code`，migration 0017。四份定稿模板（唯一）。

| 值 | 含义 | scale | goal_weight |
|---|---|---|---|
| `monthly_employee` | 月度员工版 | coefficient | NULL |
| `monthly_leader` | 月度 leader 版 | coefficient | NULL |
| `quarterly_employee` | 季度员工版 | one_to_ten | 45 |
| `quarterly_leader` | 季度 leader 版 | one_to_ten | 40 |

## score_dimension_scale（维度打分制式）

`score_dimension.scale`，migration 0017。

| 值 | 含义 | 计分 |
|---|---|---|
| `coefficient` | 系数制（月度 V1.4） | 得分 = 手写系数 × 权重（可超 100） |
| `one_to_ten` | 1–10 制（季度 V2.3） | 得分 = 打分 ÷ 10 × 权重 |

## 季度考核枚举（migration 0019，2026-07-09）

### quarter_cycle_status（`quarter_cycle.status`）

| 值 | 含义 | 说明 |
|---|---|---|
| `goal_check` | 目标核对 | 季度内准备（P2 未用） |
| `scoring` | 打分中 | 开窗即此态（P2 落点） |
| `panel` | 评分会 | 评分会阶段（P3；panel 看板读 scoring/published 均可） |
| `published` | 已公示 | 公示出分后置此态（P3 `POST /quarter/cycles/:uid/publish`） |
| `closed` | 已关闭 | 终态（申诉处理完锁定，P4） |

### quarter_task_stage（`quarter_task.stage`，串行门控）

| 值 | 含义 | 解锁条件 |
|---|---|---|
| `pending_self` | 待自评 | 初始态；自评提交或超时(self_skipped) → 解锁同事+直属 |
| `pending_peer_manager` | 待同事/直属 | 同事、直属并行打分 |
| `pending_mgmt` | 待管理层 | 直属提交后（仅 mgmt_required）；建管理层 sheet |
| `scored` | 打分完成 | 无 mgmt 员工：直属+同事都提交即到此；mgmt_required：直属+同事 + 管理层 sheet 全部提交后到此（P3） |

状态转移见 state-machine.md §8。

### quarter_sheet_rater_role（`quarter_sheet.rater_role`）

| 值 | 含义 | 说明 |
|---|---|---|
| `self` | 自评 | 仅参照、不计分 |
| `manager` | 直属评 | 打全维度 + 目标达成 goal_score |
| `peer` | 同事评 | 打全部软项维度 |
| `management` | 管理层评 | 直属提交后生成；排除一级部门 leader/直属/本人 |

### quarter_sheet_status（`quarter_sheet.status`）

| 值 | 含义 |
|---|---|
| `draft` | 草稿（未提交） |
| `submitted` | 已提交（不可重复提交） |

## 评分会 / 合成 / 申诉枚举（migration 0020，2026-07-09，P3）

### quarter_result_status（`quarter_result.status`）

| 值 | 含义 | 说明 |
|---|---|---|
| `draft` | 草稿 | compute 合成后置此态；评分会可改分（`PATCH /quarter/results/:uid`） |
| `published` | 已公示 | `POST /quarter/cycles/:uid/publish` 后；禁改分，开放申诉 |
| `closed` | 已关闭 | 申诉处理完锁定（P4 收口） |

状态转移见 state-machine.md §9。

### quarter_appeal_status（`quarter_appeal.status`）

| 值 | 含义 | 说明 |
|---|---|---|
| `open` | 待处理 | 本人 published 且未过申诉期提交；一 result 至多一条 open |
| `resolved` | 已受理 | hr/admin 处理，resolution 必填 |
| `rejected` | 已驳回 | hr/admin 处理，resolution 必填 |

## 半年合成 / 公平性硬化枚举（migration 0021，2026-07-09，P4a）

### half_year_formula（`half_year_result.formula`）

| 值 | 含义 | 说明 |
|---|---|---|
| `40/60` | 双季合成 | 前季 ×0.4 + 后季 ×0.6（domain-core `halfYearTotal`） |
| `single_100` | 单季满权 | 该半年仅一季有 published 结果 → 该季 ×100% |

### quarter_mgmt_trace_rule（`quarter_task.mgmt_trace.rule` / `quarter_result.mgmt_raters.rule`）

| 值 | 含义 | 说明 |
|---|---|---|
| `first_level_dept` | 一级部门规则 | 排除被评人一级部门 leader（+ 本人 + 直属） |
| `manager_chain_fallback` | 管理链回退 | 部门数据缺失时，排除管理链上的管理层成员 |
| `all_excluded_fallback` | 全排除回退（硬化2） | 排除后管理层评分人为空 → 不建 management sheet、不进 pending_mgmt，raterIds=[]，本任务退化为无 mgmt |

### soft_weights_group（`quarter_result.weights_used`，硬化1 四分支）

缺席方（管理层 mgmt / 同事 peer）的权重并入直属；缺席方 key 不出现在 `weights_used` 中。四组权重之和恒为 1：

| 管理层 | 同事 | manager | mgmt | peer |
|---|---|---|---|---|
| 在 | 在 | 0.55 | 0.35 | 0.10 |
| 在 | 缺 | 0.65 | 0.35 | — |
| 缺 | 在 | 0.90 | — | 0.10 |
| 缺 | 缺 | 1.00 | — | — |

> 缺席判定：mgmt 缺席 = 非 mgmt_required / `mgmtAverage` 为 null / 全排除回退；peer 缺席 = 未指定同事 / 同事 sheet 未提交（含 `peer_skipped`）。`self_skipped` / `peer_skipped` 为 boolean 放行标记（非枚举），门控中视同该环节已完成。
