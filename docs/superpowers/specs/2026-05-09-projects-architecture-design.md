# 项目架构总览页 设计文档

- **日期**: 2026-05-09
- **状态**: Draft（待用户 review）
- **范围**: `/projects` 页全面改造 + DB schema 扩展 + 数据迁移 + seed
- **参考**: `项目架构图.html`（HTML demo，位于仓库根目录上一级 `task-manger/项目架构图.html`）

---

## 1. 背景与目标

当前 `/projects` 页只支持项目名（`name`）和默认标记（`isDefault`），是一个平铺列表。Demo 给出了完整的「项目架构总览」视觉体系：4 个业务板块分组、stats row、卡片含负责人 + 国家 + 副标签。

本次改造：
- 把 demo 视觉迁移到生产 `/projects` 页
- 项目模型扩展 4 个字段（`category` / `ownerName` / `region` / `subtitle`）支撑分组显示
- 不绑定飞书人员（`ownerName` 是字符串字段，未来再升级为 `user_id` 关系）
- 现有 3 条数据用「rename + 扩字段」就地迁移，0 任务数据风险

## 2. 范围

### In Scope
- `project` 表 schema 扩展（4 个 nullable 列）
- 数据迁移：公司建设 / 印度金融 / 印尼电商 三条记录就地修改
- 新增 18 条 demo 项目作为 seed
- `apps/web/src/app/projects/page.tsx` 完全重写
- 创建/编辑 modal（替换现有 inline 输入）
- 后端 API DTO + service + controller 字段扩展
- 字典文档同步（`field-dictionary.md` / `enum-dictionary.md`）

### Out of Scope
- `ownerName` 飞书 user 绑定（后续独立需求）
- 项目排序拖拽（用 `createdAt` 自然排序）
- 项目下任务的批量操作
- ownerName 输入下拉建议（YAGNI，纯文本即可）

## 3. 设计决策（已确认）

| # | 决策点 | 结论 | 备注 |
|---|---|---|---|
| 1 | 新增字段集 | `category` + `ownerName` + `region` + `subtitle` | 用户选项 B |
| 2 | 板块枚举 | `jt` / `zy` / `fw` / `tz` / `hz` | 5 个，新增"集团" |
| 3 | 板块显示顺序 | 集团 → 自营 → 服务 → 投资 → 合作 | 集团置顶 |
| 4 | 公司建设归属 | `category=jt` | 用户指定 |
| 5 | 印度金融 → XT 印度 | rename + `category=zy` + `region=印度` + `ownerName=Mia` | 复用 projectUid |
| 6 | 印尼电商 → XL 电商 | rename + `category=zy` + `region=印尼` + `ownerName=Shawn` | 复用 projectUid |
| 7 | `region` 字段类型 | 枚举：印度/印尼/巴基斯坦/孟加拉/深圳，可空 | 集团板块项目可不填 |
| 8 | 头像颜色 | 自动 hash `ownerName` → 8 个预设色板 | 与 demo CSS 同色板 |
| 9 | 头像首字母 | 自动取 `ownerName` 第一个字符 | 中文取首字 / 英文取首字母 |
| 10 | 空缺态 | `ownerName=null` → 虚线头像 + "空缺" | 例：XT 巴基斯坦 |
| 11 | 编辑权限 | 复用现有 `canManage`（Tobi/Harvey/杨平） | 不引入新权限 |
| 12 | 板块内排序 | `createdAt` ASC | seed 顺序对齐 demo |
| 13 | 集团板块配色 | slate `#475569` / 浅 `#F1F5F9` | 中性，与业务板块区分 |
| 14 | 创建/编辑 UI | Modal（dialog） | 复用 alert-dialog 基建 |

## 4. DB Schema 变更

### 4.1 `project` 表新增列

```sql
ALTER TABLE project ADD COLUMN category VARCHAR(8);
ALTER TABLE project ADD COLUMN owner_name VARCHAR(64);
ALTER TABLE project ADD COLUMN region VARCHAR(32);
ALTER TABLE project ADD COLUMN subtitle VARCHAR(64);
```

四个字段均 nullable（保证现有行不破坏）。Drizzle migration 自动生成。

### 4.2 字典登记（CLAUDE.md 强制）

`docs/02-data/field-dictionary.md` 新增条目：

| 字段名 | 数据库列 | 类型 | 含义 | 来源 |
|---|---|---|---|---|
| `category` | `project.category` | enum | 业务板块 | 手填 |
| `ownerName` | `project.owner_name` | string | 项目负责人显示名 | 手填 |
| `region` | `project.region` | enum | 项目所在国家/地区 | 手填 |
| `subtitle` | `project.subtitle` | string | 项目副标签（NBFC × 2、联合负责 等） | 手填 |

`docs/02-data/enum-dictionary.md` 新增枚举：

```yaml
project_category:
  jt: 集团
  zy: 自营
  fw: 服务
  tz: 投资
  hz: 合作

project_region:
  印度: 印度
  印尼: 印尼
  巴基斯坦: 巴基斯坦
  孟加拉: 孟加拉
  深圳: 深圳
```

## 5. 数据迁移

### 5.1 一次性迁移 SQL

```sql
-- 已有 3 条迁移
UPDATE project SET category='jt' WHERE name='公司建设';
UPDATE project SET name='XT 印度', category='zy', region='印度', owner_name='Mia' WHERE name='印度金融';
UPDATE project SET name='XL 电商', category='zy', region='印尼', owner_name='Shawn' WHERE name='印尼电商';
```

### 5.2 Seed 18 条新项目

放在 `db/src/seeds/projects-demo.ts`，按 demo 顺序 INSERT。

> **Demo 的数字偏差**：`项目架构图.html` 的 page-subtitle 写"19 个项目"、stats-card 写"自营 7"，但 `自营` section 实际有 8 张卡片。本 spec 以**视觉卡片数为准**（demo 文字不准）。

| name | category | region | ownerName | subtitle |
|---|---|---|---|---|
| DFW 印度 | zy | 印度 | Qi | – |
| XL 内容 | zy | 印尼 | Shawn | – |
| XL 供应链 | zy | 印尼 | George | – |
| XT 巴基斯坦 | zy | 巴基斯坦 | (null) | – |
| DFW 巴基斯坦 | zy | 巴基斯坦 | Qi | – |
| XT 孟加拉 | zy | 孟加拉 | 建豪 | – |
| XW 印度 | fw | 印度 | Mia | – |
| AS 印度 | fw | 印度 | Mia | – |
| CQ 风控 | fw | 印度 | Yang | – |
| KD | tz | 巴基斯坦 | 建豪 | – |
| LWT | tz | 巴基斯坦 | 建豪 | – |
| SkyD | tz | 巴基斯坦 | 建豪 | – |
| Zeropay | tz | 印度 | Yang | – |
| allenpay | tz | 印度 | Yang | – |
| DFW | tz | 印度 | Tobi + Yang | 联合负责 |
| VN 深圳 | tz | 深圳 | Harvey | – |
| cash 印度 | hz | 印度 | Harvey | NBFC × 2 |
| CQ 孟加拉 | hz | 孟加拉 | Harvey | – |

迁移后总计 **21 个项目** = 公司建设(集团) + XT 印度 + XL 电商 + 18 新增。

板块分布：集团 1 / 自营 8 / 服务 3 / 投资 7 / 合作 2 = 21。

### 5.3 幂等性保证

Seed 脚本通过 `name` 唯一性保护，重复执行不产生副作用：

```ts
// 伪代码
for (const p of demoProjects) {
  await db.insert(project).values(p).onConflictDoNothing({ target: project.name });
}
```

`name` 列加 unique 约束（migration 同步加）。

## 6. API 变更

### 6.1 DTO

`apps/api/src/modules/project/project.controller.ts` 中：

```ts
// CreateProjectDto
{
  name: string;
  category?: 'jt' | 'zy' | 'fw' | 'tz' | 'hz';
  ownerName?: string;
  region?: '印度' | '印尼' | '巴基斯坦' | '孟加拉' | '深圳';
  subtitle?: string;
}

// UpdateProjectDto = Partial<CreateProjectDto>
```

### 6.2 Service

`project.service.ts` 的 `create` / `update` 接受新字段并落库。

### 6.3 List 响应

`GET /api/v1/projects` 返回字段扩展为：

```ts
{
  id, projectUid, name, isDefault, createdAt,
  category, ownerName, region, subtitle
}
```

### 6.4 校验

- `category` 不在枚举内 → `BusinessException` 400
- `region` 不在枚举内 → 同上
- `name` 重复 → 已有约束 + 业务异常

## 7. UI 设计

### 7.1 页面结构

```
┌──────────────────────────────────────┐
│ 项目架构总览                         │
│ 21 个项目 · 5 大业务板块 · 8 位负责人 │   ← 动态计算
├──────────────────────────────────────┤
│ [集团 1] [自营 8] [服务 3] [投资 7] [合作 2] │  stats row
├──────────────────────────────────────┤
│ ● 集团  1 个项目                      │
│ ┌────────────────────┐                │
│ │ 公司建设            │                │
│ │ ── 负责人 / region │                │
│ └────────────────────┘                │
│                                       │
│ ● 自营  8 个项目                      │
│ ┌──────┐ ┌──────┐ ...                │
│                                       │
│ （服务 / 投资 / 合作 同结构）         │
└──────────────────────────────────────┘
```

### 7.2 关键改动点

- **page-header**：标题 + 副标题（动态聚合 `projects.length` / 板块数 / 唯一负责人数）
- **stats-row**：5 个 stat-card，按 `category` 分组聚合
- **section × 5**：按板块顺序固定渲染；空板块（计数 0）也显示，提示"暂无项目"
- **project-card**：
  - 名称行：`name` + 可选 subtitle（如 NBFC × 2 在 demo 里表现为 "→ NBFC × 2"）
  - 负责人行：avatar（颜色 hash）+ `ownerName` / 副文 "联合负责" 等
  - region tag 浮右
  - 默认项目 → 加角标"默认"
  - 卡片左侧 3px 色条，颜色按 `category`
- **创建按钮**：右上角"新建项目"（仅 `canManage` 显示）
- **编辑入口**：每张卡片右上角铅笔（`canManage` 显示），点开同款 modal
- **删除入口**：modal 内"删除项目"红色按钮（默认项目不可删）

### 7.3 Modal 表单字段

| 字段 | 类型 | 必填 | 默认 |
|---|---|---|---|
| 项目名称 | text | ✓ | – |
| 业务板块 | radio (5 选 1) | ✓ | – |
| 负责人 | text（可空 → "空缺"） | – | – |
| 国家/地区 | select（5 + "无"） | – | "无" |
| 副标签 | text（可空） | – | – |
| 设为默认 | checkbox | – | false |

提交后 `mutate()` 刷新列表。

### 7.4 Avatar 工具函数

新增 `apps/web/src/lib/avatar.ts`：

```ts
const PALETTE = [
  { bg: '#0F172A', fg: '#fff' },     // harvey
  { bg: '#FCE7F3', fg: '#BE185D' },  // mia
  { bg: '#DBEAFE', fg: '#1D4ED8' },  // qi
  { bg: '#FEF3C7', fg: '#B45309' },  // shawn
  { bg: '#DCFCE7', fg: '#15803D' },  // george
  { bg: '#EDE9FE', fg: '#6D28D9' },  // jianhao
  { bg: '#CFFAFE', fg: '#0E7490' },  // yang
  { bg: '#FFE4E6', fg: '#BE123C' },  // tobi
];

export function getAvatar(name: string | null) {
  if (!name) return { initial: '?', vacant: true, bg: '#F1F5F9', fg: '#94A3B8' };
  const initial = Array.from(name)[0]; // unicode-safe first char
  const hash = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const palette = PALETTE[hash % PALETTE.length];
  return { initial, vacant: false, ...palette };
}
```

确保同一个 `ownerName` 永远 hash 到同一颜色（决定性）。

### 7.5 颜色 token

复用 demo CSS 变量（直接 inline 到组件 / globals.css）：

```css
--cat-jt: #475569;  /* 集团 - slate */
--cat-jt-soft: #F1F5F9;
--cat-zy: #DC2626;  --cat-zy-soft: #FEF2F2;
--cat-fw: #EA580C;  --cat-fw-soft: #FFF7ED;
--cat-tz: #059669;  --cat-tz-soft: #ECFDF5;
--cat-hz: #2563EB;  --cat-hz-soft: #EFF6FF;
```

## 8. 权限模型

完全复用现有 `GET /api/v1/projects/permissions` 返回的 `canManage`：

- `canManage=true`：显示"新建"、"编辑铅笔"、"删除"按钮，可提交 modal
- `canManage=false`：纯只读，所有操作按钮隐藏

后端在 `create` / `update` / `delete` 路由仍走现有 guard（不变）。

## 9. 测试计划（QC Protocol Red-Light-First）

### 9.1 后端单测（vitest）

`apps/api/src/modules/project/project.service.spec.ts`：
- ✓ create 接受新字段并落库
- ✓ update 部分字段（PATCH 语义）
- ✓ category 非法值 → 抛异常
- ✓ region 非法值 → 抛异常
- ✓ list 返回所有新字段

### 9.2 后端集成测试

`apps/api/src/modules/project/project.controller.e2e.ts`：
- ✓ POST /projects 全字段 → 200 + 落库
- ✓ PATCH /projects/:uid 改单字段 → 其他字段不变

### 9.3 迁移幂等

`scripts/seed-projects-demo.test.ts`：
- ✓ 第 1 次执行后 20 条记录
- ✓ 第 2 次执行后仍 20 条（onConflict 跳过）

### 9.4 前端单测（vitest + RTL）

`apps/web/src/__tests__/projects-page.test.tsx`：
- ✓ 5 个板块按固定顺序渲染
- ✓ stats 计数正确
- ✓ 副标题"X 个项目 · 5 大业务板块 · X 位负责人" 计算正确
- ✓ 空板块显示 "暂无项目"
- ✓ vacant owner → 显示"空缺" + 虚线头像
- ✓ avatar hash 决定性：相同 name 永远相同颜色

### 9.5 E2E + Screenshot Audit（CLAUDE.md 强制）

`apps/web/e2e/projects-architecture.spec.ts`：
- 进入 `/projects` → 截图 `projects-overview.png`
- 点击"新建项目" → 填表 → 截图 `projects-create-modal.png`
- 点击编辑铅笔 → 截图 `projects-edit-modal.png`

主动 Read 所有截图确认视觉无回归。

## 10. 实施步骤（高层）

1. DB migration + 字典文档（`field-dictionary.md` / `enum-dictionary.md`）
2. Seed 脚本 + 一次性迁移 SQL（dev DB 验证）
3. 后端 DTO/Service/Controller 扩展 + 单测 + e2e
4. 前端 avatar utility + 工具函数测试
5. 前端 `projects/page.tsx` 重写 + 单测
6. 创建/编辑 modal 组件
7. Playwright e2e + screenshot audit
8. dev DB 走通 → 准备生产迁移脚本
9. 生产部署：先备份 DB → 跑迁移 SQL → rsync 部署

详细任务分解由 `writing-plans` skill 在 spec 通过 review 后生成。

## 11. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 生产数据迁移误操作 | 先备份（pg_dump），每条 UPDATE 单独执行并核对 |
| 字段命名违反 CLAUDE.md「命名主权」 | 已用 `_at` / `_name` / 枚举小写约定，无冲突 |
| Modal 提交失败但用户以为成功 | 提交按钮 disabled 期间显示 loading，失败 toast 错误 |
| Avatar hash 改动后颜色突变 | 函数加单测，对当前 8 个名字的颜色断言锁定 |
| 旧 inline 编辑 → 新 modal 的 UX 突变 | screenshot audit 前后对比 |

回滚预案：
- DB 层：`ALTER TABLE project DROP COLUMN ...`（全 nullable，安全）
- 前端：`git revert` 重写 commit 即可
- 数据：从 pg_dump 恢复

## 12. 验收清单

- [ ] DB schema migration 应用
- [ ] 字典文档同步更新
- [ ] 3 条现有项目数据按计划迁移
- [ ] 18 条 demo 项目 seed 入库
- [ ] 前端 `/projects` 页视觉对齐 demo（screenshot audit 通过）
- [ ] 创建/编辑 modal 全字段可写
- [ ] 删除/设为默认 操作仍正常
- [ ] 后端单测/集成测试 100% 通过
- [ ] 前端单测/e2e 100% 通过
- [ ] 权限：非管理员只读视图无任何操作按钮
- [ ] 数据：dev DB 显示 21 个项目，按板块分布 1 / 8 / 3 / 7 / 2 = 21
