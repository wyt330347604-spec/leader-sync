# 现状诊断：BMAD 层次分析

> 本文档诊断当前仓库中 32 份设计文档的 BMAD 层次归属，识别过早细节、缺失定义和待降级内容。

---

## 一、BMAD 应有的文档层次

```
第 1 层：产品愿景 / 问答             ← 完全缺失
第 2 层：Product Brief               ← 完全缺失
第 3 层：User Journey Map            ← 完全缺失
第 4 层：MVP Scope & Success Metrics ← 散落在多个文档中，未独立冻结
第 5 层：PRD（范围层）               ← 存在但混入大量实现细节
第 6 层：Architecture（实现层）      ← 已过度展开，且上层定义未冻结
第 7 层：Implementation / Ops        ← 已完成代码骨架、部署方案，过早
```

**核心问题：第 1-3 层完全空白，第 6-7 层已深度展开。** 项目从"字段字典"和"同步引擎"开始设计，而不是从"谁是第一用户"和"核心旅程是什么"开始。

---

## 二、当前文档哪里过早进入细节

### 2.1 在产品目标未冻结前，已写出完整数据库 DDL

`db-schema.md` 定义了 9 张表、40+ 列、完整索引策略。但此时"MVP 到底验证什么假设"这个问题没有文档化。如果 MVP 范围调整（例如砍掉月结），月快照表和相关字段就是浪费。

### 2.2 同步引擎设计先于用户旅程

`sync-field-authority.md`、`sync-conflict-policy.md`、`sync-idempotency-policy.md` 三份文档总计近 400 行，定义了 5 类字段主权、4 级冲突优先级、两层幂等保留。但"用户在什么场景下触发同步"、"同步延迟对用户体验的实际影响"这些问题没有先回答。

### 2.3 运维文档先于产品验证

`deploy.md`、`backup-and-restore.md`、`runbook.md`、`domain-and-ssl.md` 合计 4 份文档，在产品连第一次联调都没做的情况下已经定义了备份周期、恢复流程、运维巡检清单。

### 2.4 PRD 混入了实现层概念

`prd.md` 中出现了 `source_event_id`、`version`（乐观锁）、`sync_log`、"A 类 / B 类必填字段"等纯实现术语。`business-rules.md` 中出现了 `month_bucket`、`carried_from_task_uid`、`carry_over_count` 等数据库列名。

---

## 三、哪些高层定义缺失或混杂

| 缺失内容 | 影响 |
|---|---|
| **产品一句话定义** | 团队无法快速对齐"我们在做什么" |
| **第一用户是谁** | 当前文档把 4 个角色（员工、Leader、老板、PMO）平等对待，没有优先级 |
| **核心用户旅程** | 散落在 PRD 的"核心场景"列表中（8 条并列），没有主次、没有步骤、没有"最容易断的地方" |
| **MVP 核心假设** | 没有写"我们赌什么"，直接跳到了"我们做什么" |
| **成功标准的量化定义** | `metrics-definition.md` 定义了完成率/延期率的计算公式，但没有"上线首月怎么算成"的判断标准 |
| **明确不做的清单** | 散落在 `prd.md` 第 6/13 节和 `project-charter.md` Out of Scope 中，未统一冻结 |

### 混杂最严重的区域

- **`enum-dictionary.md`**：业务词汇表（task_type、status、priority）和工程枚举（sync_status、source_type）混在一起，但前者是产品定义，后者是实现决策
- **`state-machine.md`**：任务生命周期状态机（产品）和同步状态机（实现）共存一个文档
- **`field-dictionary.md`**：业务字段语义（产品）和物理列定义 + 类型 + 索引建议（实现）合为一体

---

## 四、哪些实现层设计需要暂时降级

"降级"不是"删除"，而是**标注为"待上层冻结后再细化"，暂不作为开发依据**。

### 4.1 应降级为"架构草案"（等 MVP Scope 冻结后再确认）

| 文档 | 原因 |
|---|---|
| `sync-field-authority.md` | 字段主权分类方案依赖 MVP 范围——如果 MVP 不做日历同步，D 类字段规则暂无用 |
| `sync-conflict-policy.md` | 冲突处理策略依赖同步方向——但 MVP 是否真的需要多来源同步还没定论 |
| `sync-idempotency-policy.md` | 幂等对账策略在 M2 之前无实际使用场景 |
| `callback-contracts.md` | 回调契约在 M2/M3 之前无实际使用场景 |
| `event-subscriptions.md` | 事件订阅在 M2/M3 之前无实际使用场景 |
| `task-calendar-mapping.md` | 日历映射在 M5 之前无实际使用场景 |

### 4.2 应降级为"运维预案"（等产品验证后再细化）

| 文档 | 原因 |
|---|---|
| `deploy.md` | 部署方案应等代码能跑起来后再写 |
| `backup-and-restore.md` | 备份恢复应等有真实数据后再写 |
| `runbook.md` | 运维手册应等有线上环境后再写 |
| `domain-and-ssl.md` | 域名/证书策略应等服务器到位后再写 |

### 4.3 应从 PRD 中剥离实现细节

| 文档 | 需要剥离的内容 |
|---|---|
| `prd.md` | 技术目标（3.2）、`source_event_id`/`version`/`sync_log` 引用（8.9）、A/B 类必填分层（8.1） |
| `business-rules.md` | 所有数据库列名引用（`month_bucket` 等）、物理存储策略（"新建记录"） |
| `monthly-close-rules.md` | `snapshot_run_id`/`snapshot_version`/`is_latest`、精确 cron 时间、重跑机制 |
| `state-machine.md` | 同步状态机（Section 5）、月结流程中的 snapshot 字段 |
| `enum-dictionary.md` | `sync_status`、`source_type` 应移到架构文档 |

---

## 五、建议的行动顺序

```
1. 先写 Product Brief            ← 冻结"做什么/不做什么/给谁做/赌什么"
2. 再写 User Journey Map         ← 冻结"核心旅程/断点/系统责任"
3. 再写 MVP Scope & Metrics      ← 冻结"必做/不做/怎么判断成败"
4. 用上述 3 份文档反向校正 PRD   ← 剥离超范围内容和过早细节
5. 最后才继续 Architecture 层    ← 此时架构决策有上层依据
```

当前状态是**从第 5 步开始做的**，缺少 1-4 的地基。
