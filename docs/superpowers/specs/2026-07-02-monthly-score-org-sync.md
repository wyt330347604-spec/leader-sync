# 月度绩效打通 + 飞书组织架构同步 + 组织架构图（2026-07-02）

## 背景（生产实测证据）

- 2026-07-01 月结 Step 6 失败：`Cannot find module '/opt/leader-sync/apps/worker/src/lib/uid'`（journalctl leader-worker）。生产 worker 源码落后本地：缺 `lib/uid.ts`、`services/message-builder.ts` 的打分卡片、`jobs/score-escalation.ts`，main.ts 为旧版。
- 生产 `monthly_score` 表 0 行——打分草稿只能由月结 Step 6 生成（无手工创建端点），故线上无分可打。
- **更根本缺口**：`org_cache.manager_user_id` 全代码只有 dev seed 写入。生产 org_cache 只有 OAuth 登录 upsert（姓名/部门，无 manager）。就算修好 worker，草稿也是 0 条（每条草稿 rater = ratee 的 manager）。
- 通讯录 API 权限（contact:contact.base:readonly）尚未申请（待办清单遗留项）。

## 目标

1. **Phase A**：让 6 月月度绩效可打分——生产 worker 收敛到本地版本 + 从飞书通讯录同步上下级 + 补生成 2026-06 打分草稿。
2. **Phase B**：组织架构图 `/org`——默认渲染飞书同步的上下级树，boss/pmo/admin 可拖拽调整（人工 override），作为"飞书关系不准时二次修改"的载体。

## 关键设计决策

### D1 上下级的单一数据源（消费方零改动）
`org_cache.manager_user_id` 保持唯一有效值（effective manager），monthly-close/score-window 等消费方**继续只读这一个字段**。新增：
- `manager_source` varchar(16) NOT NULL DEFAULT 'feishu'：`feishu`（同步来）| `manual`（组织架构图人工调整）
- `manager_updated_at` timestamptz、`manager_updated_by` varchar(128)（审计）
- 飞书同步**跳过 `manager_source='manual'` 的行**（人工 override 优先，重复同步不覆盖）；组织架构图「恢复飞书默认」= 把 source 改回 feishu 并立即用飞书值回填。

### D2 ID 命名空间（user_id vs open_id）根治
生产两套 ID 并存：org_cache.user_id 来自 OAuth（可能是员工 user_id），任务/快照的 ownerUserId 97.5% 是 `ou_` open_id。Step 6 现有 `orgById.get(snap.ownerUserId)` 存在 miss 风险。根治：
- score-window 的 org 查找表**双 key**（userId 和 openId 都 set 一份），任一命名空间都能命中。
- 通讯录同步统一用 `user_id_type=open_id` 调 contact API，manager 写入 `ou_` open_id（发卡片需要 `ou_`，且与任务命名空间一致）。
- 同步的目标行匹配顺序：`open_id = ou_x` 的行 → `user_id = ou_x` 的行 → 都没有则**新建**（user_id=open_id=ou_x，覆盖"从未登录 Web 但有任务"的员工）。同步源名单 = org_cache 全部行 ∪ 活跃任务 distinct assignee（ou_ 格式）。

### D3 补跑 6 月草稿：专用脚本，不重跑月结
月结 `--skip-notifications` 会连 Step 6 一起跳过；不 skip 会给全员重发 6 月月报。故把 Step 6 抽为 `jobs/score-window.ts` 的 `runScoreWindowSetup(opts)`（monthly-close 委托调用，行为不变），另加 `scripts/run-score-window-once.ts --month 2026-06 [--send-cards] [--dry-run]`。**默认不发卡片**（等 Harvey 确认再 --send-cards；insert onConflictDoNothing 幂等，可先静默生成、之后再单独发卡）。

### D4 生产 worker 整体收敛（不再挑文件）
版本漂移正是本次故障根因。部署 = rsync 整个 `apps/worker/src`（先 diff 审查 + 本地全测绿）。score-escalation 随之启用：仅对「challenged 超 48h 未处理」记录动作，空数据 no-op，安全。

## Phase A 交付物

| # | 内容 | 测试 |
|---|------|------|
| A1 | `jobs/score-window.ts`：从 monthly-close Step 6 抽出，deps 注入（db/feishu/now），双 key org 查找，`sendCards` 开关 | 单测：草稿生成/无 manager 跳过/双 key 命中/onConflict 幂等/卡片开关 |
| A2 | `scripts/run-score-window-once.ts`：--month/--send-cards/--dry-run | 复用 A1 函数，脚本薄壳 |
| A3 | `jobs/sync-org-hierarchy.ts`：lark SDK `contact.user.get`（user_id_type=open_id）拉 leader_user_id + name，按 D2 匹配写入；manual 行跳过；权限未开时明确报错（code 99991672 等）不落库 | 单测（mock lark client）：写入/跳过 manual/新建缺失行/权限错误优雅降级 |
| A4 | main.ts 注册 `sync-org-hierarchy`（每日 07:00，早于月结 08:00） | — |
| A5 | 部署：diff → rsync worker src 整目录 + lib → systemctl restart leader-worker → journal 验证 | 冒烟：journal 无报错、sync 任务正常跑 |
| A6 | 生产跑通讯录同步（**需 Harvey 先在飞书后台开通讯录只读权限**）→ 跑 run-score-window-once --month 2026-06 --dry-run 核对名单 → 正式生成 | monthly_score 行数、/scores 页可见 |

## Phase B 交付物

| # | 内容 | 测试 |
|---|------|------|
| B1 | migration `0015_org_manager_source.sql` + schema + field-dictionary.md | — |
| B2 | API `org` 模块：`GET /org/tree`（任意登录，全员+manager+source）；`PATCH /org/users/:user_id/manager`（boss/pmo/admin；写 manual + 审计；**防环校验**：新 manager 的祖先链不得含本人）；`POST /org/users/:user_id/manager/reset`（恢复飞书默认=翻转 source，值待下次同步刷新）。~~POST /org/sync-feishu~~ **不做**：避免在 API 侧复制同步实现（口径单一），同步走 worker 每日 07:00 cron 或手动脚本 `run-org-sync-once.ts` | 单测：权限/防环/自指/override 写入/reset |
| B3 | Web `/org`：组织树（无 manager 为根；孤儿归"未指定上级"区）；boss/pmo/admin 拖拽节点→新上级（HTML5 DnD，桌面）；节点显示 source 徽章（飞书/手动）+「恢复飞书默认」；nav 入口 gated | 截图审计（QC#2） |
| B4 | permission-matrix.md、enum-dictionary.md（manager_source）更新 | — |

## 模糊点与决策

| 模糊点 | 决策 | 状态 |
|--------|------|------|
| 通讯录权限申请 | 需 Harvey 飞书后台开 `contact:contact.base:readonly` | ⏳ 等 Harvey（代码先行，权限开后即可跑） |
| 6 月草稿生成后是否立刻发打分卡片 | 默认**不发**，脚本留 --send-cards | ⏳ 等 Harvey 确认 |
| score-escalation 是否启用 | 随整体收敛启用（无申诉时 no-op） | ✅ 已定 |
| 组织架构图编辑权限 | boss/pmo/admin 可编辑，其他人只读 | ✅ 默认，可调 |
| 打分 rater 口径 | 单一来源 org_cache.manager_user_id（manual 优先于 feishu 由写入侧保证） | ✅ 已定 |

## 文档联动
- `docs/02-data/field-dictionary.md`：org_cache 三个新字段
- `docs/02-data/enum-dictionary.md`：manager_source
- `docs/05-permissions/permission-matrix.md`：/org 三端点
