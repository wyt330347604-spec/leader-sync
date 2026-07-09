# 绩效评分板块设计方案 —— 月度 V1.4 + 季度 V2.3 线上化

- 日期：2026-07-08　状态：**已定稿（Harvey 2026-07-08 批复全部决策点，含两条补充规则：串行打分、季度结束后开窗）**
- 依据（唯一准绳）：
  - 季度：飞书《季度考核打分工具 V2.3 精简版》（docx id `NzEGdyapVo4Te1xwFsncN6tmnRf`）
  - 月度：《月度考核打分工具_V1.4.docx》（Harvey 终稿）
- 目标：**公司所有人在本应用内完成完整打分闭环**（月度系数 → 季度三方 → 半年合成 → 公示申诉 → 定级定岗联动），替代线下 docx/HTML 工具。

---

## 1. 现状与差距

| 能力 | 现状 | 定稿要求 | 结论 |
|---|---|---|---|
| 月度打分 | 直属手填单一系数 0.0–1.0（`monthly_score.score`） | V1.4：每维度手写系数×权重，总分=Σ=综合系数×100，可超 100；员工 2 维（工作量15/交付85），leader 3 维（团队量10/团队交付70/领导力20）；红线一票否决 | **升级打分内核**，状态机/开窗/质疑/锁定/通知全复用 |
| 季度考核 | 无 | V2.3 全流程 | **新建** |
| 半年合成 | 无 | 前季40%+后季60%，Q2/Q4 评分会当场合成+review 留痕 | **新建** |
| 角色：leader | `user_role_binding`（人工绑） | leader 群 `oc_1181b79589e1dffa8b484857e8d75984` 成员即 leader | **新建群同步** |
| 角色：管理层 | 无此概念 | 管理层群 `oc_ba5a3862c93e8c932cf1e68a3a2f14f5` 成员 | **新建群同步** |
| 直属领导 | `org_cache.manager_user_id`（飞书通讯录日同步+手工调整） | 直属 55%/90% 评分人 | **直接复用** |
| 入职日期 | org_cache 无此字段 | 新人 ≥2 完整月才参评 | **补字段**（通讯录 join_time 同步） |
| 红线/等级/申诉 | 均无 | S/A/B/C/D、红线建议开除、3 工作日申诉 | **新建** |

---

## 2. 角色模型与飞书群同步

### 2.1 三个身份来源
1. **直属领导**：`org_cache.manager_user_id`（现状不变，仍是"谁给谁打分"的唯一来源）。
2. **leader 身份**：leader 群成员 → 决定被评人用「leader 版打分表」（月度 3 维/季度 5 维），且**必进管理层评分**。
3. **管理层身份**：管理层群成员 → 参与季度管理层集体打分（会前各打、取均值）。

### 2.2 新表 `perf_role`
```
perf_role: user_id (uk), open_id, is_leader bool, is_management bool,
           source_chat_ids jsonb, synced_at
```
- worker 新 job `sync-perf-roles`（每日 07:10，跟在 07:00 org 同步后；另提供 admin 手动触发接口）。
- 调 `GET /im/v1/chats/{chat_id}/members`（分页）拉两个群成员，open_id 对回 org_cache。
- **已实测验证（2026-07-08，用文档应用 `cli_aacdce98ca7a5bb6`）**：管理层群 8 人（Tobi/扶梅娟/王永涛/辛建豪/杨平/张小亮/潘安/张诗珧）、leader 群 17 人，接口通。
- **注意：文档应用 ≠ 生产应用**（文档应用无通讯录权限，而生产 org 同步一直在跑 → 两个不同 app）。上线路径二选一：
  - **A（推荐）**：生产应用加 `im:chat:readonly` + 其机器人拉进两个群，worker 用现有凭证一套搞定；
  - B（兜底）：worker 加第二组凭证 `FEISHU_SYNC_APP_ID/SECRET`（文档应用）只做群同步——能跑但两套凭证，不干净。
- `user_role_binding` 保持现状只管应用 RBAC（admin/pmo/boss）；打分身份一律走 `perf_role` + manager 链，两套不混。
- 新增 `hr` 角色绑定（申诉受理人，建议绑杨平），复用现有 role binding 机制。

### 2.3 「关联的一级部门领导除外」的落地规则（Harvey 定：读飞书组织架构）
飞书通讯录有真实部门树（生产应用已有通讯录权限，现有 org 同步就在用 `contact.department.children`）。落地：
- 新表 `feishu_department`（dept_id, parent_dept_id, name, leader_user_id, level, synced_at），并入现有每日 org 同步 job 一起拉。
- **一级部门** = 沿部门树向上走到根（0）的下一层那个部门；**排除对象** = 被评人一级部门的 `leader_user_id`（+ 直属领导本人，其单独占 55%/90% 不进均值）。
- **兜底**：若某人部门数据缺失或部门无 leader_user_id，回退到"管理链上的管理层成员全排除"规则，并在均值留痕（`mgmt_raters` jsonb）里标注用了哪条规则。
- 注：文档应用测部门接口报 40004（无权限），生产应用有权限——此项在 P0 用生产凭证跑通即验收。

---

## 3. 数据模型（Drizzle，migration 0008 起）

### 3.1 规则模板（打分规则进库不写死，规则变了改数据不改代码）
```
score_template:  uid, code (monthly_employee | monthly_leader |
                 quarterly_employee | quarterly_leader), version, active bool
score_dimension: uid, template_uid, code, name, description,
                 weight numeric, sort, scale ('coefficient' | 'one_to_ten'),
                 anchors jsonb   -- 档位锚定文案 [{grade:'S',range:'9-10',desc:'…'},…]
```
初始数据 = 两份定稿的维度/权重/锚定原文：
- monthly_employee：工作量15、交付85（系数制）
- monthly_leader：团队量10、团队交付70、领导力20（系数制）
- quarterly_employee：专业18、主动担当15、协作10、学习自省12（1–10 制）+ 目标达成45（单独）
- quarterly_leader：拆目标15、带人14、决策12、跨职能12、落地创新7（1–10 制）+ 团队结果40（单独）

### 3.2 月度升级（V1.4）
```
monthly_score        （现表保留，加列）:
  + template_uid, total_score numeric(5,1), composite numeric(4,2),
  + grade text, red_line bool, red_line_note text
monthly_score_detail: uid, score_uid fk, dimension_code,
                      coefficient numeric(4,2),   -- 手写系数，1.0 以上不封顶
                      weighted numeric(5,1)       -- = coefficient × weight
```
- 旧列 `score`（0–1 标量）冻结为历史只读；新周期起 detail 必填、total 自动算。
- 状态机、质疑、锁定、48h 升级、开窗 job **全部不动**。
- 打分表按 `perf_role.is_leader` 决定员工版/leader 版。
- 红线勾选 → 强制 D + 「建议开除」标记 + 必填说明，通知 boss/hr。

### 3.3 季度考核（V2.3）
```
quarter_cycle:    uid, quarter '2026-Q3', status
                  (goal_check → scoring → panel → published → closed),
                  open_at, deadline, panel_at, published_at
quarter_task:     uid, cycle_uid, ratee_user_id, sheet_type (employee|leader),
                  mgmt_required bool,           -- leader 恒 true；员工由直属勾"表现差/晋级申请"
                  mgmt_reason text, enrolled bool, skip_reason text, -- 新人不足2完整月等
                  stage (pending_self → pending_peer_manager → pending_mgmt → scored)
                  -- 串行门控（Harvey 定）：自评提交后才解锁 同事+直属；直属提交后才解锁 管理层
                  -- 无 mgmt 的员工：pending_peer_manager 完成即 scored
                  -- 自评超时 3 天自动放行下一环并标记 self_skipped（防一人卡全链）
                  , self_skipped bool, stage_deadlines jsonb
peer_assignment:  uid, cycle_uid, ratee_user_id, peer_user_id, assigned_by, at
                  -- 校验：同一 peer 最多连续两季（查前两周期）；每半年至少换人
quarter_sheet:    uid, cycle_uid, ratee_user_id, rater_user_id,
                  rater_role (self|manager|peer|management),
                  status (draft|submitted), submitted_at
quarter_sheet_item: sheet_uid, dimension_code, raw int (1-10),
                    weighted numeric   -- = raw/10 × weight
                  -- manager sheet 另有 goal_score numeric（0–45 / 0–40）
quarter_result:   uid, cycle_uid, ratee_user_id, goal_score, soft_merged,
                  total, grade, red_line bool,
                  weights_used jsonb,  -- {manager:.55,mgmt:.35,peer:.10} 或 {manager:.90,peer:.10}
                  mgmt_avg numeric, mgmt_raters jsonb（含被排除名单，留痕）,
                  published_at, appeal_deadline
quarter_result_revision: result_uid, field, before, after, reason, revised_by, at
                  -- 评分会改分留痕（谁改、为什么）
quarter_goal:     uid, half '2026-H2', ratee_user_id, content, set_by, at
quarter_goal_revision: goal_uid, before, after, reason, revised_by, at  -- 季中调整留痕
quarter_appeal:   uid, result_uid, ratee_user_id, content,
                  status (open|resolved|rejected), handler, resolution, at
half_year_result: uid, half, ratee_user_id, prev_q_total, curr_q_total,
                  formula ('40/60'|'single_100'), total, grade, synthesized_at
```
- `org_cache` 加 `joined_at`（通讯录 `join_time` 同步；拉不到的 HR 手补）→ 新人规则可判。

---

## 4. 计分引擎（纯函数，放 `packages/domain-core`，TDD 先行）

```
月度:  total = Σ(coefficient_i × weight_i)          // 91.5 分这种，可 >100
       composite = total / 100                       // 挂激励的综合系数
季度:  dim_score = raw / 10 × weight
       soft(rater) = Σ dim_score
       soft_merged = mergeSoft(manager, mgmt_avg, peer)          // 硬化1 四分支，见下
       mgmt_avg = mean(管理层已提交 sheet，排除被评人管理链上的管理层成员)
       total = goal_score + soft_merged
       grade: S≥90 / A 80–89 / B 70–79 / C 60–69 / D <60 或红线

【硬化1 · mergeSoft 四分支口径（Harvey 2026-07-08 拍板，2026-07-09 落地）】
签名 mergeSoft({manager, mgmt: number|null, peer: number|null})——null=缺席（区别于「在场且打 0 分」传 0）。
按「管理层是否在场 × 同事是否在场」四分支，缺席方权重并入直属（"给直属"）；四组权重之和恒为 1，
usedWeights 如实记录实际采用的组（缺席方 key 不出现）：
  - 管理层在 + 同事在：0.55×manager + 0.35×mgmt + 0.10×peer
  - 管理层在 + 同事缺：0.65×manager + 0.35×mgmt          （peer 的 0.10 并入 manager）
  - 管理层缺 + 同事在：0.90×manager + 0.10×peer
  - 管理层缺 + 同事缺：1.00×manager
缺席判定（computeResult）：peer 缺席 = 没指定同事 / 同事 sheet 未提交（含 peer_skipped，硬化3）；
mgmt 缺席 = mgmtAverage 返回 null（非 mgmt_required / 无评分人 / 全排除回退 all_excluded_fallback，硬化2）。
纯函数与四分支用例见 packages/domain-core/src/perf-scoring.ts + __tests__/perf-scoring.test.ts。
半年:  total = prev_q × 0.4 + curr_q × 0.6；仅一季有分 → 该季 ×100%
新人:  完整月数(joined_at, quarter) ≥ 2 才 enrolled
```
- 自评 sheet（rater_role=self）不进任何合成，仅展示参照。
- 同事按 V2.3 定稿**打全部软项维度**。
- 目标达成/团队结果只有 manager sheet 有，不进三方加权。

---

## 5. 流程与状态机

### 季度周期（Harvey 定：**季度结束后才开窗** + **串行打分**；以 Q3 为例）
0. **季度内（随时）**：目标设定/季中调整、同事指定、mgmt_required 勾选——这些是准备动作，不是打分；打分入口季度内一律锁死。
1. **10月1日 08:00 自动开窗**（quarter_cycle 由 cron 创建，admin 可改期）：批量生成 quarter_task（stage=pending_self）；开窗时校验目标/同事指定缺失项并发卡片催办。
2. **串行打分（互相不可见对方分数）**：
   - **① 自评（3 天）**：本人先打（参照不计分）。提交或超时 → 解锁下一环（超时标 self_skipped）。
   - **② 同事 + 直属（5 天，并行）**：同事打全部软项；直属打全维度+目标达成，打分页右侧自动带出**月度底稿**（周期内逐月系数+评级+备注，仅参照）+ 半年目标 + 自评参照 + 关联事故。
   - **③ 管理层（4 天，仅 mgmt_required）**：直属提交后解锁；各管理层成员独立打软项（排除名单自动生效）。
   - 无 mgmt 的员工走完 ② 即完成打分。
3. **评分会（panel，约 10 月中旬）**：管理层看板 —— 每个 mgmt_required 被评人的管理层各自分、自动均值（排除名单透明展示）、全员分布直方图、各 leader 打分均值对比、S 名单逐个过事实、D 名单逐个过去留；**Q2/Q4 当场合成半年分**；会上改分走 revision 弹窗（必填 reason，留痕）。
4. **公示**：出分推卡片给本人；`appeal_deadline = 公示 + 3 个工作日`；申诉入口在个人档案页，提交后通知 HR。
5. **关闭**：申诉处理完 → closed 锁定；quarter_result 回填 `grade_history.score_snapshot`（现成 jsonb 扩展位），定级定岗资格（当季 S 或连续两季 A+）在职级页自动亮牌。

### 月度周期
完全沿用现有节奏（次月 1 日 08:00 开窗、7 天期限、48h 质疑升级、PMO/Boss/Admin 锁定），仅打分表单换成多维系数制。V1.4 的「其他 leader 可看」→ `canViewScore` 放宽：is_leader/is_management 可读全员月度分。

---

## 6. 页面（Next.js App Router 增量）

| 路由 | 内容 | 谁用 |
|---|---|---|
| `/scores`（改） | 月度列表 + 「季度」页签 | 全员 |
| `/scores/[uid]`（改） | 多维系数表单：每维度一张卡（锚定表折叠可展开）、系数输入、实时总分/综合系数、红线勾选 | 直属 |
| `/quarter` | 季度中心：我的待办（自评/同事评/直属评/管理层评）、进度条 | 全员 |
| `/quarter/sheet/[uid]` | 打分页：维度卡 + S/A/B/C/D 锚定 + 1–10 输入 + 实时得分；直属版多"目标达成"和月度底稿侧栏 | 各评分方 |
| `/quarter/panel` | 评分会看板：均值/分布/对比、S/D 下钻、改分留痕、半年合成（Q2/Q4） | 管理层 |
| `/quarter/admin` | 周期管理、同事指定总览与校验、mgmt_required 名单、申诉处理、导出 CSV（给薪酬） | admin/hr/pmo |
| `/me/performance` | 个人档案：月度系数曲线、季度/半年成绩、评级、申诉入口、定级定岗资格牌 | 本人 |
| `/me/goals` | 半年目标（直属设定、本人可见、双方可发起调整、直属确认留痕） | 本人+直属 |

## 7. 飞书通知（复用 message-builder 卡片，全部发个人 open_id）

开窗/截止 T-2d 催办（发有未完成 sheet 的人）、同事被指定告知、公示出分（发本人，带 `/me/performance` 链接）、申诉提交（发 HR）、红线触发（发 boss+HR）、评分会前一天给管理层发个人清单卡。月度通知不动。

## 8. 权限矩阵增量（同步更新 `docs/05-permissions/permission-matrix.md`）

| 动作 | 本人 | 同事 | 直属 | 管理层 | hr | pmo/boss/admin |
|---|---|---|---|---|---|---|
| 填自评 | ✓ | | | | | |
| 填同事评 | | ✓(被指定) | | | | |
| 填直属评+目标分 | | | ✓ | | | |
| 填管理层评 | | | | ✓(排除链上) | | ✓boss |
| 看本人结果 | ✓(公示后) | | ✓ | ✓ | ✓ | ✓ |
| 评分会改分 | | | | ✓(留痕) | | ✓ |
| 处理申诉 | | | | | ✓ | ✓ |
| 周期管理/导出 | | | | | ✓ | ✓ |

## 9. 实施计划（TDD，domain-core 纯函数先写测试）

| Phase | 内容 | 估时 |
|---|---|---|
| P0 地基 | migration 0008、score_template+初始维度数据、perf_role 群同步 job、joined_at 同步、hr 角色 | 2–3d |
| P1 月度 V1.4 | detail 表+计分函数+表单改造+红线+可见性放宽+历史兼容 | 2–3d |
| P2 季度核心 | cycle/task/sheet/result、同事指定+连任校验、自评/同事/直属打分流+月度底稿侧栏 | 5–7d |
| P3 评分会 | 管理层打分+排除规则+panel 看板+改分留痕+公示+申诉 | 4–5d |
| P4 收口 | 半年合成、个人档案、目标管理、定级定岗联动、CSV 导出、通知全量接通 | 3–4d |

合计 ≈ 16–22 个工作日。**节奏建议：8 月底整链路试跑一轮（用假周期演练评分会），9 月底 Q3 首用。** 每 Phase 结束更新 `docs/02-data`、`04-process`、`05-permissions` 主档。

## 10. 决策记录（Harvey 2026-07-08 批复，全部定稿）

1. **月度评级映射** ✅：S>100 / A 90–100 / B 80–89 / C 70–79 / D<70，存模板可改。
2. **管理层排除规则** ✅（改）：读飞书组织架构部门树，排除被评人**一级部门 leader**；部门数据缺失时回退管理链规则（§2.3）。
3. **员工进管理层评分的触发** ✅：直属勾"表现特别差/晋级申请"（必填理由），admin/boss 可加。
4. **半年目标设定权** ✅：直属设定、本人可见、双方可发起调整、直属确认留痕。
5. **旧月度数据** ✅：0–1 单系数历史只读，不回填。
6. **前置动作** ✅（部分完成）：文档应用机器人已进两群、`im:chat:readonly` 已加（群成员接口 2026-07-08 实测通）。**剩余：确认生产应用同样入群+加权限（方案 A），或 worker 配双凭证（方案 B）**，见 §2.2。
7. **串行打分**（Harvey 补充）✅：自评 → 同事+直属 → 管理层，逐环解锁；自评超时 3 天自动放行（标 self_skipped）。
8. **季度结束后才开窗**（Harvey 补充）✅：打分窗于季度结束次日 08:00 自动开启，季度内只做准备动作（目标/同事指定/勾选 mgmt）。
