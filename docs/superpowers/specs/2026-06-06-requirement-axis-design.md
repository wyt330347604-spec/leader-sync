# 需求轴 + 业务线语义修正 · 详细设计（定稿 2026-06-06）

> 对齐《需求管理规范》(repo 根 `需求管理规范.md`) + 两张流程图（需求流程图1 / 需求开发流程1）。
> 交互稿：`docs/product/requirement-axis-demo.html`（v4，已定稿，所有形态以此为准）。
> 分期：R0 业务线语义修正 → R1 需求轴 → R2 容量+双甘特 → R3 P0/变更联动。

## 0. 最终模型
```
业务线 (project, parent=null, 永续)        印度金融 / 印尼电商 / 公司建设
  ├─ 需求(挂业务线本身)                      跨 app 的需求
  └─ app / 项目 (project, parent=业务线)      cash印度 · allenpay · 电商主站 …
       └─ 需求 (requirement)                 提需求时选"挂业务线 或 某 app"
            └─ 任务 (task)                    全部从需求拆出(task.requirement_uid)
侧轴：事故(incident, 规范明确"不算需求", 已有 V2, 独立)
```
- **业务线/app 都是容器**（业务线永续；app 是产品，长期存在）——**它们没有"交付日"**。
- **需求 = 提出人发起、PM 收口把关、拆成任务执行的最小价值单元**；交付日/健康度/排程落在**需求 + 任务**层。
- 数据上：业务线 = 顶级 project(parent_project_uid 为 null)，app = 子 project(parent=业务线)。这是 V0 已建的两级 project，仅语义改名。

## 已锁定决策
①需求挂业务线或app、任务从需求拆 ②P0/变更=算影响+通知+人工确认（不静默改期）③工时粒度=半天/天 ④容量=并行+投入度(MS Project/Float 风格)，直接做 ⑤分期 R0→R3；投入度默认100%可手调。

---

# R0 · 业务线语义修正（先做，小）

V1 现状把"顶级 project（业务线）"当成有交付日/完成率展示，在"业务线永续"下是误导。R0 纯语义+展示，**无表结构变更**。

### 后端 `getProjectPortfolio`（dashboard.service）
- 顶级节点（业务线）新增：`appCount`(子 project 数)、`atRiskCount`/`overdueCount`(健康为预警/逾期的子项目数)。
- 业务线 `health` 口径改为：**其子项目(app)里最差的健康度**（overdue>at_risk>on_track）；无子项目时回落到直接任务健康度。
- 业务线 spanStart/spanEnd 不再作为"业务线交付日"语义（字段可保留，前端不展示为交付日）。
- 子项目(app)节点不变（仍有 health/span；R1 起 app 下挂需求）。
- 注：R1 之前还没有"需求"实体，故"需求计数"在 R1 补；R0 先把业务线层语义改对（app 数 + 健康汇总）。

### 前端
- `project-portfolio.tsx` 业务线卡片：加「业务线·永续」标签；展示「N app · M 预警 · K 逾期」+ 进度环 + 健康灯；**去掉业务线卡片上的起止/交付日**（下沉子项目行）。
- `project-gantt.tsx`：顶级(业务线)行只作分组标题，**不画自己的 bar**；子项目/任务才有 bar。

### 测试
- rollup 单测：业务线 health = 最差子项目；appCount/atRiskCount/overdueCount 计数正确。
- 前端截图审计业务线卡片新文案 + 甘特无业务线 bar。

风险：低，纯展示/口径，无迁移。

---

# R1 · 需求轴（按规范两图定稿）

## R1.1 数据模型
**新表 `requirement`**（migration `0014_requirement.sql`）：
| 列 | 类型 | 说明 |
|---|---|---|
| requirement_uid | varchar(64) uniq | req_xxx |
| title / value / description | varchar/text | 标题 / 价值 / 详述 |
| business_line_uid | varchar(64) | 业务线(顶级 project)，必填 |
| app_project_uid | varchar(64) null | 挂到的 app(子 project)；null = 挂业务线本身 |
| source | varchar(16) | 来源：biz(业务方提报)/plan(产品规划)/tech(技术优化)/feedback(用户反馈) |
| priority | varchar(8) | P0/P1/P2 |
| status | varchar(32) | 生命周期(见 R1.2)，默认 collected |
| target_version | varchar(32) null | 目标版本/迭代(排期时填) |
| reporter_user_id/_name | varchar | 提出人 |
| pm_user_id/_name | varchar(128) null | 承接人(PM)，null=待认领 |
| acceptor_user_id/_name | varchar(128) null | 验收人 |
| expected_release_date | date null | 期望上线(P0必填) |
| est_effort_days | numeric(5,1) null | 预估工时(人天，技术评审/分解时填，喂 R2) |
| company_id, version, created_at/by, updated_at/by, deleted_at | | 审计 |

- `task` 加 `requirement_uid varchar(64)`（任务从需求拆出；任务也带 `est_effort_days` + `allocation_pct` 默认100，供 R2）。
- **产出物**：`requirement_artifact`(requirement_uid, type[prd/tech_design/test_case/accept_report/biz_confirm/release_note], title, url, created_by, created_at) —— 规范要求留痕。
- 索引：business_line_uid、app_project_uid、status、pm_user_id、priority、target_version。

## R1.2 生命周期状态机（规范两图对齐）
```
collected 收集(待收口)         ← 提出人提，4类来源
 → analyzing 分析(PM·出PRD)
  → req_review 需求评审(PM×技术, 闸门)        ↩不过→analyzing
   → tech_review 技术评审(研发·任务分解+估工时, 闸门)  ↩不过→analyzing/修改
    → scheduled 排期(PM·定目标版本)
     → developing 开发(研发·单元自测)
      → testing 测试(用例评审→冒烟→功能→集成→回归)   ↩缺陷→developing
       → product_accept 产品验收(PM·预发)            ↩不过→developing
        → tech_release 技术上线(研发/运维)
         → biz_accept 业务验收(业务方/提出人·生产)     ↩不过→处理
          → released 业务上线
           → retro 复盘(PM) → closed
任意态 → rejected 驳回(记原因)
```
- 测试子步骤(冒烟/功能/集成/回归)做成 testing 阶段内 checklist + 测试用例产出物，不各占状态。
- 回退(↩)是合法转移，**每次回退记原因+留痕**(version/updatedBy + 一条变更记录)。

## R1.3 API
- `POST /requirements` 提需求（任意登录人；标题/价值/来源/优先级/挂业务线或app/期望上线）。默认 collected，reporter=当前用户，pm=null。
- `GET /requirements?business_line_uid=&app_project_uid=&status=&pm_user_id=&priority=&target_version=` 看板/列表（行级安全：非特权角色看自己提的；PM/boss/admin 看全部）。
- `GET /requirements/:uid` 详情（含拆出任务、产出物、当前阶段责任人）。
- `PATCH /requirements/:uid` 编辑 + 状态流转（合法性校验，含回退；关键流转限 PM/boss/admin；提出人仅可改自己 collected 态）。
- `POST /requirements/:uid/claim` PM 认领（collected→PM 接手）。
- `POST /requirements/:uid/decompose` 任务分解：批量建任务(带 requirement_uid + 工时 + 负责人 + 投入度)，可回填 est_effort_days。
- `POST /requirements/:uid/artifacts` 挂产出物。
- 权限：复用 requesterFrom + 角色；PM 为 owner。

## R1.4 前端
- **导航加「需求」**（gated：PM/boss/admin/leader 可见全；普通员工可提、只看自己的）。
- **需求池看板**（按状态分列，对齐 demo v4 的 10 列）+ 过滤(业务线/app/PM/优先级/版本) + 「+提需求」。
- **提需求表单**：标题/价值/来源(4类)/优先级/挂业务线或app/期望上线。
- **需求详情**（demo v4 形态）：头部(业务线/app/来源/版本/提出人/PM/验收/期望上线/工时) + 12 段 stepper + 拆出任务列表 + 产出物留痕 + 流转/分解/驳回/**↩打回上一步** + 跨链接(需求池/业务线/产能)。
- **业务线概览(R0)联动**：业务线卡片 → app → **需求计数**（R1 补上）→ 点需求开详情；详情与需求池互通(闭环)。

## R1.5 测试
状态流转合法性(含回退非法跳转拒绝)、claim、decompose 回填工时+建任务、行级安全、看板过滤；前端截图审计(看板/提需求/详情/闭环)。

## R1.6 不在 R1
测试缺陷自动回流、变更需求正式审批(并入 R3)、工时驱动的人力甘特(R2)。

---

# R2 · 容量 + 双甘特（并行 + 投入度）
- 任务/需求带 `est_effort_days` + `allocation_pct`(默认100)。每人每日容量 1.0 FTE；工期=工时÷投入度；每日负载=当天各任务投入度之和，>100% 过载红。
- **需求维度甘特**：每条需求一条 bar(期望上线/起止)，展开见任务。
- **人力维度甘特**：每人并行任务条 + 每日负载热力(过载红区)。
- 数据来自 R1 的 decompose(工时/负责人/投入度)。

# R3 · P0 / 变更 联动（算影响 + 通知 + 人工确认）
- 触发点 = **提需求时选 P0**（或编辑改期）。提交后系统按容量重算：占用产能 → 相关人过载 → 低优先任务顺延 → 受影响需求交付日重算。
- 弹**影响预览**(产能冲突/连锁顺延/需求交付变化/通知名单/留痕) → PIC/技术负责人**确认** → 才改期+通知+留痕(喂问责/KPI)。对齐规范 3.1 紧急需求 / 3.2 变更需求。

---
落地顺序：R0(本次)→R1→R2→R3。每步 QC：红灯测试→实现→dev验证→截图→部署。
