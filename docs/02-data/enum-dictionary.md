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
