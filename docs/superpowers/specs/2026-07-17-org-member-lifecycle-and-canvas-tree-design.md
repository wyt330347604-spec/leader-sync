# 离职/隐藏人员全局清理 + 组织架构交互式画布 — 设计方案

- 日期：2026-07-17
- 状态：待实现（Harvey 已确认设计，spec 待复核）
- 关联：`2026-07-02-requirement-axis-design.md` 之后的组织架构演进；替换现 `/org` 页 CSS 树

## 1. 背景与目标

现状两个问题：

1. **离职人员没从应用里去掉。** 生产 org_cache 87 行，其中已确认离职的（刘国军、Roselinda、周佳玮）仍在数据里；不参与绩效但在职的账号（Albern@China 的 3 个账号、陈明、李星）也照常出现在组织架构图、人员选择器等处，`score_exempt=true` 只挡了打分花名册，挡不住其它出口。当前完全没有"离职"这个状态。
2. **`/org` 可视化很差。** 现用纯 CSS `ul/li::before/::after` 画连接线的"树"，宽组会横向溢出、连接线在深层错位、无缩放平移、一屏看不全 66+ 节点，观感不像真正的组织架构图。

### 目标（DoD）

- org_cache 引入"离职"生命周期状态，飞书同步**自动**判定离职并全局隐藏，无需人工维护，复职自愈。
- 提供**手动隐藏**开关，覆盖"在职但不该出现在目录里"的账号（Albern×3/陈明/李星）。
- 离职/隐藏人员从**人员目录类出口**（组织架构图、人员搜索、打分花名册）全部消失；**历史任务/打分记录保留可查**，不做物理删除。
- `/org` 重写为**交互式画布**（缩放/平移/一屏 fitView/minimap），保留现有全部编辑能力（拖拽调汇报线、恢复飞书默认、手动徽章、上级未识别提示）。

### 非目标

- 不清理离职者的**存量任务/打分历史**（保留可审计）；驾驶舱"人员概览"按任务聚合，离职者若还有存量任务仍会出现 —— 那是历史数据口径，不在本次范围（若要清，需先转派任务，另立项）。
- 不做离职交接流程（任务转派、审批）。
- 不引入标签体系（BOSS/HR/PMO>CORE>Leader），编辑白名单沿用现 `ORG_STRUCTURE_ADMINS`。

## 2. 数据模型

### migration `0023_org_member_lifecycle.sql`

`org_cache` 新增 3 列（全部 nullable，不改已有字段，sync-engine 隔离安全）：

| 列 | 类型 | 含义 |
|---|---|---|
| `left_at` | `timestamptz NULL` | 离职时间。飞书同步作业自动写；`NULL`=在职 |
| `hidden_at` | `timestamptz NULL` | 手动隐藏时间；`NULL`=未隐藏 |
| `hidden_by` | `varchar(128) NULL` | 执行隐藏的管理员 user_id（审计） |

**在册口径（canonical）：`left_at IS NULL AND hidden_at IS NULL`。**

Drizzle schema `db/src/schema/org-cache.ts` 同步加 `leftAt` / `hiddenAt` / `hiddenBy` 三列。改 schema 后必须 `pnpm --filter @leader-sync/db build`（记忆坑：db 包不 rebuild，API 运行时引用旧 dist）。

不加 DB CHECK 约束；语义由应用层守。

## 3. 离职自动判定（worker `sync-org-hierarchy.ts`）

现同步作业末尾 `fetched` map 就是**本次飞书枚举到的在职集合**（部门递归 + worklist 兜底后仍解析到的人）。在此之后追加"离职判定"步骤：

```
在职句柄集合 activeHandles = new Set(fetched.keys())
对 org_cache 每一行 row:
  h = ouHandle(row)                       // ou_ open_id 优先
  在职? = h && activeHandles.has(h)
  if 在职 && row.leftAt != null:          // 复职 / 授权范围恢复 → 自愈
      清 left_at (set null)
  if !在职 && row.leftAt == null:         // 新判定离职
      set left_at = now
  （已离职且仍不在职：不动，幂等）
```

- **双命名空间连带**：同一人多行（user_id 行 + open_id 行共享 open_id）按句柄一起标/清，沿用现同步的 `rowsByHandle` 模式。
- **句柄无法解析的行**（ouHandle 返回 null，非 ou_）：跳过不标（历史脏数据，交由手动隐藏处理）。

### 安全阀（关键，防误标全员离职）

飞书 API 半途故障（分页断、权限被撤、限流）会让 `fetched` 偏小，若直接按差集标离职会把大批在职者误判。规则：

```
现有可解析在册行数 resolvableRows = 有 ou_ 句柄且 left_at IS NULL 的行数
if fetched.size < resolvableRows * 0.5:
    跳过整个离职判定步骤 + console.warn 告警（含两个数字）
    result.leaveSkippedBySafetyValve = true
```

阈值 0.5 写成常量。dryRun 时只计数不写。

### OrgSyncResult 扩展

新增计数字段：`markedLeft`（本次新标离职数）、`revived`（本次自愈复职数）、`safetyValveTriggered`（bool）。日志行追加这三项。

> 注：现有 `notFound` 计数只覆盖 identitySet（系统已知身份）里 getUser 失败的，语义不同，保留不动；离职判定独立用 `fetched` 全集做差。

## 4. 手动隐藏

### API

`PATCH /api/v1/org/users/:uid/hidden` body `{ hidden: boolean }`

- 仅 `ORG_STRUCTURE_ADMINS`（Harvey / 杨平 / dev fixture），复用 `assertOrgAdmin`，无权 `UNAUTHORIZED`(403)。
- `hidden:true` → set `hidden_at=now, hidden_by=requester.userId`；`hidden:false` → 清两列。
- 按句柄连带双行（同 setManager 的 buildLookup + 找到 target 后对同句柄所有行更新）。为此 `OrgRepository` 加 `setHidden(rowIds: number[], values)`，service 收集同句柄 row ids。
- 目标不存在 → `ORG_USER_NOT_FOUND`(404)。

`left_at`（离职）**不提供手动清除端点** —— 离职由同步说了算，人工不可撤（复职会自愈）。隐藏与离职正交：一个人可以既离职又被隐藏，在册口径是"两者皆空"。

### 前端

- 管理员在节点卡片 hover 出「隐藏」动作（离职节点不显示此动作，离职本就不渲染）。
- 页头「显示已隐藏 (N)」开关：默认关；开启后前端请求带 `include_hidden=1`，隐藏节点灰态显示，手动隐藏的可点「取消隐藏」，离职的标「离职」徽章且不可操作。
- **上线后立即手动隐藏**：Albern@China（3 账号）、陈明、李星。刘国军 / Roselinda / 周佳玮 由同步自动标离职（首次同步验证）。

## 5. 全局过滤（出口清单）

| 出口 | 文件 | 改动 |
|---|---|---|
| 组织架构树 | `org.service.ts` `getTree` | 默认 `WHERE left_at IS NULL AND hidden_at IS NULL`；管理员传 `include_hidden=1` 时返回全部并在节点上带 `left_at`/`hidden_at` 供前端灰态区分。返回结构加 `hidden_count`。 |
| 人员搜索 | `user.controller.ts` `search` | `allUsers` 查询加在册过滤（`left_at IS NULL AND hidden_at IS NULL`）。协作人/负责人/PIC 选择器共用此端点，一处改全部生效。 |
| 打分花名册 | `apps/worker/src/jobs/score-window.ts` | 现按 `scoreExempt` 跳过之外，再跳过 `left_at != null || hidden_at != null`（离职/隐藏不生成打分草稿）。 |
| 任务/打分**历史** | — | **不改**。离职者的存量任务、历史打分记录、org_cache 行全部保留，只从"人员目录"消失。 |

过滤放在**数据查询层**（org tree / user search 直接在 SQL/内存过滤在册），不在前端做，避免离职数据下发到客户端。

`getTree` 因需支持 `include_hidden`，`OrgRepository.listAll` 加可选 `{ includeHidden?: boolean }`，默认 false 时 SQL `WHERE left_at IS NULL AND hidden_at IS NULL`。setManager/reset 内部仍用全量 listAll（防环校验要看到隐藏节点，避免拖拽绕过环检测）—— 为此保留一个不带过滤的内部查询，`getTree` 用带过滤的。

## 6. 交互式画布树（`/org` 前端重写）

### 技术选型

- `@xyflow/react`（React Flow v12）—— 画布、缩放、平移、minimap、受控节点拖拽，社区成熟、可主题化。
- `d3-hierarchy`（`stratify` + `tree`）—— 由 manager 关系算 tidy-tree 坐标（固定卡片尺寸 → x/y）。多根用一个隐形虚拟根挂所有 roots，布局后丢弃虚拟根。
- 两个新依赖 → 生产部署要 `pnpm install --frozen-lockfile`（rsync lockfile + package.json）。

**为何不沿用 CSS 树**：CSS `::before/::after` 连接线在宽/深组错位、无法缩放平移、一屏看不全 —— 是本次要解决的核心问题，必须换成画布。

**为何不选纯 SVG 自绘**：自绘要重写缩放/平移/拖拽命中，等于造一个 React Flow 子集，YAGNI。

### 组件拆分（多小文件）

- `apps/web/src/app/org/page.tsx` —— 页面壳：数据加载、页头、隐藏开关、错误条、`<OrgCanvas>`。
- `apps/web/src/app/org/org-layout.ts` —— 纯函数：`buildFlowGraph(users, collapsed)` → `{nodes, edges}`（d3-hierarchy 布局 + 折叠子树聚合 `+N`）。**无 React 依赖，可单测。**
- `apps/web/src/app/org/org-node-card.tsx` —— React Flow 自定义节点：现卡片全部信息（头像/姓名/职级/N名下属/手动徽章/上级未识别/恢复默认/隐藏动作/离职灰态）。
- `apps/web/src/app/org/org-canvas.tsx` —— React Flow 容器：注册自定义节点、fitView、minimap、缩放控件、拖拽落点 → setManager。
- 去重/规范身份/防环预检等纯函数（现 page.tsx 里的 `canonicalId`/`dedupeUsers`/`buildForest`/`subtreeKeys`）抽到 `org-layout.ts` 复用。

### 交互

- 初始 `fitView` 一屏看全；滚轮缩放、拖画布平移、minimap 导航、右下缩放/复位控件。
- **折叠/展开**：节点 chevron 收起子树，收起后父节点显示 `+N`（隐藏的后代数）。默认全展开（清人后约 66 节点，画布无压力）。
- **调汇报线**（管理员）：拖节点放到目标节点卡上 = `setManager(dragId, targetId)`；React Flow 原生区分**节点拖拽**与**画布平移**，不再需要 HTML5 原生 drag 的 useRef hack。防环客户端预检（`subtreeKeys`）保留：拖到自己子树内的节点高亮为禁止落点。
- **设为根节点**：原顶部"拖到这里=设为根"投放区改为**节点卡片上的动作按钮**（管理员，`setManager(id, null)`），去掉画布外的投放区（画布里没有稳定的"根投放区"位置）。

### 主题

沿用现 CSS 变量（`--bg-card`/`--border`/`--accent-blue`/`--text-*`/`--tag-private`/`--accent-orange`）；React Flow 的默认样式用变量覆盖，明暗主题都要过截图审计。离职灰态用降透明度 + 「离职」橙徽章。

## 7. 测试计划（TDD：先 RED 后 GREEN）

- **worker**（vitest，`apps/worker`）：
  - 离职判定：org_cache 有 A/B，fetched 只含 A → B 被标 `left_at`，A 不动。
  - 自愈：B 之前 `left_at` 有值，本次 fetched 含 B → `left_at` 清空。
  - 幂等：已离职且仍不在职 → 不重写 `left_at`。
  - 安全阀：fetched.size < 在册行数 50% → 跳过判定 + `safetyValveTriggered=true`，无行被标。
  - 双命名空间：同句柄两行一起标/清。
- **api**（vitest，`apps/api`）：
  - `getTree` 默认过滤离职/隐藏；`include_hidden=1` 管理员返回全部 + `hidden_count`。
  - `getTree` 非管理员传 `include_hidden=1` 仍只拿在册（防越权看隐藏）。
  - `PATCH .../hidden` 白名单外 403；管理员 hidden:true 写两列、按句柄连带双行；hidden:false 清；目标不存在 404。
  - `user search` 结果排除离职/隐藏。
  - 防环校验仍能看到隐藏节点（隐藏节点不破坏环检测）。
- **web**（vitest + RTL）：`org-layout.ts` 的 `buildFlowGraph` 纯函数：多根挂虚拟根、折叠聚合 `+N`、坐标不重叠（同层 x 递增）。
- **截图审计**（playwright，QC Protocol §2）：`/org` 画布默认视图（明/暗）、折叠展开、隐藏开关开启后灰态 + 离职徽章、管理员拖拽落点高亮。主动 Read 截图确认。

覆盖率维持 ≥80%。

## 8. 文档联动（CLAUDE.md Documentation Rules 强制）

- `docs/02-data/field-dictionary.md`：org_cache 加 `left_at` / `hidden_at` / `hidden_by`；定义"在册口径"。
- `docs/02-data/enum-dictionary.md`：新增成员生命周期状态（在册 / 离职 / 隐藏）语义 + 安全阀阈值 0.5。
- `docs/04-process/state-machine.md`：org_cache 成员生命周期（在职↔离职自愈、手动隐藏正交）。
- `docs/05-permissions/permission-matrix.md`：`PATCH /org/users/:uid/hidden` 仅 ORG_STRUCTURE_ADMINS；`include_hidden` 查询仅管理员生效。
- `docs/03-sync/*`：sync-org-hierarchy 增加离职判定 + 安全阀说明。

## 9. 部署顺序

1. migration `0023` → 生产 `docker exec leader-sync-postgres-1 psql`（备份 DB）。
2. `pnpm --filter @leader-sync/db build`（schema 新列）。
3. rsync lockfile + package.json → 生产 `pnpm install --frozen-lockfile`（React Flow / d3-hierarchy 新依赖）。
4. rsync：shared-types dist（若有）→ db dist → api dist → worker 源码 → web `.next`（本地先 `pnpm build`，非 standalone）。
5. 重启：worker `systemctl restart leader-worker`；api/web 按端口 `fuser` 查 PID kill + `setsid --fork` 重启（**不用 pkill -f 含命令串**）。
6. **手动触发一次 org sync** 验证 Roselinda/刘国军/周佳玮 被自动标 `left_at`；核对安全阀未误触（directoryCount vs 在册数）。
7. 管理员用隐藏开关隐藏 Albern×3/陈明/李星。
8. 冒烟：`/org` 200、`/api/v1/org/tree` 401(无 token)、`/api/v1/org/users/x/hidden` 401、截图确认画布渲染。

## 10. 影响范围与风险

- **误标离职风险**：安全阀（<50% 跳过）+ 首次上线手动核对 + 复职自愈三重兜底。
- **防环回归**：过滤后 setManager 若用过滤后的数据做环检测会漏隐藏节点 → 明确用不过滤的内部查询做防环。
- **新依赖体积**：React Flow ~独立 chunk，仅 `/org` 路由加载，不影响首屏。
- **数据保留**：不物理删除，任何时候可通过 SQL 或 `include_hidden` 追溯离职/隐藏历史。
