# 项目架构总览页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/projects` 平铺列表升级为对齐 demo 的「项目架构总览」（5 板块分组 + 头像 + 国家 + 副标签 + Modal 创建/编辑），新增 4 个字段并迁移现有数据。

**Architecture:** PostgreSQL 加 4 列 nullable（保持向后兼容）→ 后端 DTO/Service 扩展 → 前端完全重写 page 用分组视图 + Modal。`ownerName` 为字符串字段（未来再升级为飞书 user 关系）。所有变更都不影响 task 表（`task.projectUid` 不动）。

**Tech Stack:** PostgreSQL + Drizzle ORM / NestJS + class-validator / Next.js 15 + SWR + radix-ui Dialog / Vitest + Playwright

**Spec 来源:** `docs/superpowers/specs/2026-05-09-projects-architecture-design.md`

---

## File Structure

### Shared types
- **Modify** `packages/shared-types/src/enums.ts` — 加 `ProjectCategory`、`ProjectRegion` 枚举

### DB layer
- **Modify** `db/src/schema/project.ts` — 加 4 列（`category` / `ownerName` / `region` / `subtitle`）
- **Create** `db/migrations/0003_project_arch_fields.sql` — 给现有表加列 SQL
- **Modify** `db/seed/fixtures.ts` — `PROJECTS` 数组从 3 条扩到 21 条（含新字段）
- **Create** `db/scripts/migrate-projects-prod-2026-05.ts` — 生产环境一次性迁移脚本（rename 已有 2 条 + insert 18 条新）

### Backend
- **Modify** `apps/api/src/modules/project/project.service.ts` — `create` / `update` 接受新字段 + 枚举校验
- **Modify** `apps/api/src/modules/project/project.controller.ts` — `CreateProjectDto` / `UpdateProjectDto` 扩展
- **Create** `apps/api/src/modules/project/__tests__/project.service.spec.ts` — 新增单测

### Frontend
- **Create** `apps/web/src/lib/avatar.ts` — `getAvatar(name)` 工具
- **Create** `apps/web/src/lib/__tests__/avatar.test.ts` — avatar 单测
- **Create** `apps/web/src/components/project-modal.tsx` — 创建/编辑 Modal
- **Modify** `apps/web/src/app/projects/page.tsx` — 完全重写
- **Modify** `apps/web/src/app/globals.css` — 加 5 个 category 颜色 token
- **Modify** `apps/web/e2e/desktop.spec.ts` — 加 modal 截图（03b/03c）

### Docs
- **Modify** `docs/02-data/field-dictionary.md` — 加 4 个新字段
- **Modify** `docs/02-data/enum-dictionary.md` — 加 `project_category` / `project_region` 枚举

---

## Task 1: 在 shared-types 添加 ProjectCategory + ProjectRegion 枚举

**Files:**
- Modify: `packages/shared-types/src/enums.ts`

- [ ] **Step 1: 在文件末尾追加两个枚举（保持与现有 TaskStatus 同风格）**

```ts
// 文件末尾追加
export const ProjectCategory = {
  GROUP: 'jt',      // 集团
  SELF: 'zy',       // 自营
  SERVICE: 'fw',    // 服务
  INVEST: 'tz',     // 投资
  COOP: 'hz',       // 合作
} as const;
export type ProjectCategory = (typeof ProjectCategory)[keyof typeof ProjectCategory];

export const ProjectCategoryLabel: Record<string, string> = {
  jt: '集团',
  zy: '自营',
  fw: '服务',
  tz: '投资',
  hz: '合作',
};

// 显示顺序（页面渲染用）
export const ProjectCategoryOrder: ProjectCategory[] = ['jt', 'zy', 'fw', 'tz', 'hz'];

export const ProjectRegion = {
  INDIA: '印度',
  INDONESIA: '印尼',
  PAKISTAN: '巴基斯坦',
  BANGLADESH: '孟加拉',
  SHENZHEN: '深圳',
} as const;
export type ProjectRegion = (typeof ProjectRegion)[keyof typeof ProjectRegion];

export const ProjectRegionList: ProjectRegion[] = ['印度', '印尼', '巴基斯坦', '孟加拉', '深圳'];
```

- [ ] **Step 2: 编译 shared-types 确认无类型错误**

Run: `cd packages/shared-types && pnpm tsc --noEmit`
Expected: 退出码 0，无输出错误

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/enums.ts
git commit -m "feat(types): add ProjectCategory + ProjectRegion enums"
```

---

## Task 2: 扩展 project schema（加 4 列）

**Files:**
- Modify: `db/src/schema/project.ts`

- [ ] **Step 1: 加 4 个 nullable 列**

替换 `db/src/schema/project.ts` 全文为：

```ts
import { pgTable, bigserial, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const project = pgTable('project', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectUid: varchar('project_uid', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 128 }).notNull(),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // ---- 2026-05 项目架构总览新增字段 ----
  category: varchar('category', { length: 8 }),       // ProjectCategory enum, nullable
  ownerName: varchar('owner_name', { length: 64 }),   // 自由文本姓名, null = 空缺
  region: varchar('region', { length: 32 }),          // ProjectRegion enum, nullable
  subtitle: varchar('subtitle', { length: 64 }),      // 副标签（NBFC × 2 等）
});
```

- [ ] **Step 2: 编译 db 包**

Run: `cd db && pnpm tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 3: Commit**

```bash
git add db/src/schema/project.ts
git commit -m "feat(db): add category/ownerName/region/subtitle to project schema"
```

---

## Task 3: 编写 + 应用 migration SQL（dev DB）

**Files:**
- Create: `db/migrations/0003_project_arch_fields.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- db/migrations/0003_project_arch_fields.sql
-- 给 project 表加 4 个 nullable 列，支撑「项目架构总览」分组视图

ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "category" varchar(8);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "owner_name" varchar(64);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "region" varchar(32);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "subtitle" varchar(64);
```

- [ ] **Step 2: 确认 SSH 隧道已起**

Run: `pnpm dev:tunnel:status`
Expected: 输出隧道运行中（如显示未运行则先 `pnpm dev:tunnel`）

- [ ] **Step 3: 把 migration 应用到 dev DB**

Run:
```bash
psql 'postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' -f db/migrations/0003_project_arch_fields.sql
```

Expected: 输出 `ALTER TABLE` × 4，无错误

- [ ] **Step 4: 验证 dev DB schema 已变**

Run:
```bash
psql 'postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' -c "\d project"
```

Expected: 列表里看到 `category`, `owner_name`, `region`, `subtitle` 四列

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0003_project_arch_fields.sql
git commit -m "feat(db): migration 0003 — project arch fields"
```

---

## Task 4: 更新 seed fixtures 到 21 个项目

**Files:**
- Modify: `db/seed/fixtures.ts`

- [ ] **Step 1: 替换 `PROJECTS` 数组**

把 `db/seed/fixtures.ts` 里第 53-57 行 `const PROJECTS = [...]` 替换为下面 21 条记录。**注意保留原 `proj_dev_main` / `proj_dev_indo` / `proj_dev_india` 三个 projectUid**（已有任务的 fixtures 引用了这些 UID）：

```ts
const PROJECTS = [
  // 集团（1）— 保留原 proj_dev_main，扩字段
  { projectUid: 'proj_dev_main',   name: '公司建设',     isDefault: true,  category: 'jt', ownerName: null,           region: null,         subtitle: null },

  // 自营（8）— 保留原 indo→XL 电商 / india→XT 印度
  { projectUid: 'proj_dev_india',  name: 'XT 印度',       isDefault: false, category: 'zy', ownerName: 'Mia',          region: '印度',       subtitle: null },
  { projectUid: 'proj_dev_dfw_in', name: 'DFW 印度',      isDefault: false, category: 'zy', ownerName: 'Qi',           region: '印度',       subtitle: null },
  { projectUid: 'proj_dev_indo',   name: 'XL 电商',       isDefault: false, category: 'zy', ownerName: 'Shawn',        region: '印尼',       subtitle: null },
  { projectUid: 'proj_dev_xl_cnt', name: 'XL 内容',       isDefault: false, category: 'zy', ownerName: 'Shawn',        region: '印尼',       subtitle: null },
  { projectUid: 'proj_dev_xl_sup', name: 'XL 供应链',     isDefault: false, category: 'zy', ownerName: 'George',       region: '印尼',       subtitle: null },
  { projectUid: 'proj_dev_xt_pk',  name: 'XT 巴基斯坦',   isDefault: false, category: 'zy', ownerName: null,           region: '巴基斯坦',   subtitle: null },
  { projectUid: 'proj_dev_dfw_pk', name: 'DFW 巴基斯坦',  isDefault: false, category: 'zy', ownerName: 'Qi',           region: '巴基斯坦',   subtitle: null },
  { projectUid: 'proj_dev_xt_bd',  name: 'XT 孟加拉',     isDefault: false, category: 'zy', ownerName: '建豪',         region: '孟加拉',     subtitle: null },

  // 服务（3）
  { projectUid: 'proj_dev_xw_in',  name: 'XW 印度',       isDefault: false, category: 'fw', ownerName: 'Mia',          region: '印度',       subtitle: null },
  { projectUid: 'proj_dev_as_in',  name: 'AS 印度',       isDefault: false, category: 'fw', ownerName: 'Mia',          region: '印度',       subtitle: null },
  { projectUid: 'proj_dev_cq_in',  name: 'CQ 风控',       isDefault: false, category: 'fw', ownerName: 'Yang',         region: '印度',       subtitle: null },

  // 投资（7）
  { projectUid: 'proj_dev_kd',     name: 'KD',            isDefault: false, category: 'tz', ownerName: '建豪',         region: '巴基斯坦',   subtitle: null },
  { projectUid: 'proj_dev_lwt',    name: 'LWT',           isDefault: false, category: 'tz', ownerName: '建豪',         region: '巴基斯坦',   subtitle: null },
  { projectUid: 'proj_dev_skyd',   name: 'SkyD',          isDefault: false, category: 'tz', ownerName: '建豪',         region: '巴基斯坦',   subtitle: null },
  { projectUid: 'proj_dev_zero',   name: 'Zeropay',       isDefault: false, category: 'tz', ownerName: 'Yang',         region: '印度',       subtitle: null },
  { projectUid: 'proj_dev_allen',  name: 'allenpay',      isDefault: false, category: 'tz', ownerName: 'Yang',         region: '印度',       subtitle: null },
  { projectUid: 'proj_dev_dfw',    name: 'DFW',           isDefault: false, category: 'tz', ownerName: 'Tobi + Yang',  region: '印度',       subtitle: '联合负责' },
  { projectUid: 'proj_dev_vn_sz',  name: 'VN 深圳',       isDefault: false, category: 'tz', ownerName: 'Harvey',       region: '深圳',       subtitle: null },

  // 合作（2）
  { projectUid: 'proj_dev_cash',   name: 'cash 印度',     isDefault: false, category: 'hz', ownerName: 'Harvey',       region: '印度',       subtitle: 'NBFC × 2' },
  { projectUid: 'proj_dev_cq_bd',  name: 'CQ 孟加拉',     isDefault: false, category: 'hz', ownerName: 'Harvey',       region: '孟加拉',     subtitle: null },
];
```

合计 **21 条**（板块分布 1 / 8 / 3 / 7 / 2）。

- [ ] **Step 2: 执行 seed 重置 dev DB**

Run: `pnpm dev:seed`
Expected: 输出 `→ Inserting 21 projects` + `✓ Seed complete`

- [ ] **Step 3: 验证 DB**

Run:
```bash
psql 'postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' -c \
  "SELECT category, COUNT(*) FROM project GROUP BY category ORDER BY category"
```

Expected: 输出 5 行，分别是 fw=3, hz=2, jt=1, tz=7, zy=8

- [ ] **Step 4: Commit**

```bash
git add db/seed/fixtures.ts
git commit -m "feat(seed): expand projects to 21 with category/owner/region"
```

---

## Task 5: 后端 ProjectService 扩展（TDD — 写测试）

**Files:**
- Create: `apps/api/src/modules/project/__tests__/project.service.spec.ts`
- Test: 同上

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/modules/project/__tests__/project.service.spec.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectService } from '../project.service';
import { BusinessException } from '../../../common/exceptions/business.exception';

function createMockDb() {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    from: vi.fn(() => chain),
    values: vi.fn(() => chain),
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(),
    orderBy: vi.fn(() => chain),
  };
  return chain;
}

describe('ProjectService.create — new fields', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ProjectService;

  beforeEach(() => {
    db = createMockDb();
    service = new ProjectService(db as any);
  });

  it('persists category / ownerName / region / subtitle', async () => {
    db.returning.mockResolvedValue([{ id: 1, name: 'X', category: 'zy', ownerName: 'Mia', region: '印度', subtitle: null }]);
    const result = await service.create({
      name: 'XT 印度',
      category: 'zy',
      ownerName: 'Mia',
      region: '印度',
    });
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      name: 'XT 印度', category: 'zy', ownerName: 'Mia', region: '印度', subtitle: null,
    }));
    expect(result.category).toBe('zy');
  });

  it('rejects category not in enum', async () => {
    await expect(service.create({ name: 'X', category: 'bad' as any }))
      .rejects.toBeInstanceOf(BusinessException);
  });

  it('rejects region not in enum', async () => {
    await expect(service.create({ name: 'X', region: '火星' as any }))
      .rejects.toBeInstanceOf(BusinessException);
  });

  it('accepts only required name (other fields optional)', async () => {
    db.returning.mockResolvedValue([{ id: 2, name: '内部', category: null }]);
    await service.create({ name: '内部' });
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      name: '内部', category: null, ownerName: null, region: null, subtitle: null,
    }));
  });
});

describe('ProjectService.update — partial updates', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ProjectService;

  beforeEach(() => {
    db = createMockDb();
    service = new ProjectService(db as any);
  });

  it('updates only provided fields', async () => {
    db.returning.mockResolvedValue([{ projectUid: 'p1', name: 'old', category: 'zy' }]);
    await service.update('p1', { category: 'zy' });
    expect(db.set).toHaveBeenCalledWith({ category: 'zy' });
  });

  it('rejects category not in enum on update', async () => {
    await expect(service.update('p1', { category: 'bad' as any }))
      .rejects.toBeInstanceOf(BusinessException);
  });
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd apps/api && pnpm vitest run src/modules/project/__tests__/project.service.spec.ts`
Expected: 多个 FAIL — 因为当前 `service.create(name)` 签名只接受字符串，新签名传 object 会失败

- [ ] **Step 3: 重写 `project.service.ts` 实现**

替换 `apps/api/src/modules/project/project.service.ts` 全文：

```ts
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { project } from '@leader-sync/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  ProjectCategory,
  ProjectRegion,
  ProjectCategoryOrder,
  ProjectRegionList,
} from '@leader-sync/shared-types';

const CATEGORY_VALUES = new Set<string>(ProjectCategoryOrder);
const REGION_VALUES = new Set<string>(ProjectRegionList);

export interface ProjectInput {
  name: string;
  category?: ProjectCategory | null;
  ownerName?: string | null;
  region?: ProjectRegion | null;
  subtitle?: string | null;
}
export type ProjectPatch = Partial<ProjectInput>;

function validateInput(p: ProjectPatch) {
  if (p.category != null && !CATEGORY_VALUES.has(p.category)) {
    throw new BusinessException(1004, `Invalid category: ${p.category}`);
  }
  if (p.region != null && !REGION_VALUES.has(p.region)) {
    throw new BusinessException(1004, `Invalid region: ${p.region}`);
  }
}

@Injectable()
export class ProjectService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async list() {
    return this.db.select().from(project).orderBy(project.createdAt);
  }

  async create(input: ProjectInput) {
    validateInput(input);
    const uid = `proj_${nanoid(12)}`;
    const [result] = await this.db.insert(project).values({
      projectUid: uid,
      name: input.name,
      category: input.category ?? null,
      ownerName: input.ownerName ?? null,
      region: input.region ?? null,
      subtitle: input.subtitle ?? null,
    }).returning();
    return result;
  }

  async update(projectUid: string, patch: ProjectPatch) {
    validateInput(patch);
    const updateSet: Record<string, unknown> = {};
    if (patch.name !== undefined) updateSet.name = patch.name;
    if (patch.category !== undefined) updateSet.category = patch.category;
    if (patch.ownerName !== undefined) updateSet.ownerName = patch.ownerName;
    if (patch.region !== undefined) updateSet.region = patch.region;
    if (patch.subtitle !== undefined) updateSet.subtitle = patch.subtitle;

    const [result] = await this.db.update(project)
      .set(updateSet)
      .where(eq(project.projectUid, projectUid))
      .returning();
    if (!result) throw new BusinessException(1003, 'Project not found');
    return result;
  }

  async remove(projectUid: string) {
    const [proj] = await this.db.select().from(project).where(eq(project.projectUid, projectUid));
    if (!proj) throw new BusinessException(1003, 'Project not found');
    if (proj.isDefault) throw new BusinessException(1001, 'Cannot delete default project');
    await this.db.delete(project).where(eq(project.projectUid, projectUid));
    return { deleted: true };
  }

  async setDefault(projectUid: string) {
    await this.db.update(project).set({ isDefault: false }).where(eq(project.isDefault, true));
    const [result] = await this.db
      .update(project)
      .set({ isDefault: true })
      .where(eq(project.projectUid, projectUid))
      .returning();
    if (!result) throw new BusinessException(1003, 'Project not found');
    return result;
  }

  async getDefault() {
    const [def] = await this.db.select().from(project).where(eq(project.isDefault, true));
    return def ?? null;
  }
}
```

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `cd apps/api && pnpm vitest run src/modules/project/__tests__/project.service.spec.ts`
Expected: All passing (≥ 6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/project/project.service.ts \
        apps/api/src/modules/project/__tests__/project.service.spec.ts
git commit -m "feat(api): extend ProjectService with category/owner/region/subtitle"
```

---

## Task 6: 后端 Controller DTO 扩展

**Files:**
- Modify: `apps/api/src/modules/project/project.controller.ts`

- [ ] **Step 1: 替换 controller 全文**

```ts
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectService, ProjectInput, ProjectPatch } from './project.service';

const PROJECT_ADMIN_IDS = new Set([
  'ou_243a9225acc248c148c25f8fe0699407', // Tobi
  'ou_1c419560953e219d5876918a2b934dfb', // Harvey/王永涛
  'ou_5a06e17c2ec88a72a2ef4ce040b3d77d', // 杨平
]);

function isProjectAdmin(user: CurrentUserPayload): boolean {
  return PROJECT_ADMIN_IDS.has(user.open_id ?? '') || PROJECT_ADMIN_IDS.has(user.user_id);
}

function requireProjectAdmin(user: CurrentUserPayload): void {
  if (!isProjectAdmin(user)) {
    throw new BusinessException(1002, 'No permission', HttpStatus.FORBIDDEN);
  }
}

@Controller('api/v1/projects')
@UseGuards(AuthGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  list() {
    return this.projectService.list();
  }

  @Get('permissions')
  getPermissions(@CurrentUser() user: CurrentUserPayload) {
    return { canManage: isProjectAdmin(user) };
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() body: ProjectInput) {
    requireProjectAdmin(user);
    if (!body?.name?.trim()) {
      throw new BusinessException(1001, 'name is required');
    }
    return this.projectService.create(body);
  }

  @Patch(':project_uid')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('project_uid') projectUid: string,
    @Body() body: ProjectPatch,
  ) {
    requireProjectAdmin(user);
    return this.projectService.update(projectUid, body);
  }

  @Delete(':project_uid')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('project_uid') projectUid: string) {
    requireProjectAdmin(user);
    return this.projectService.remove(projectUid);
  }

  @Post(':project_uid/set-default')
  setDefault(@CurrentUser() user: CurrentUserPayload, @Param('project_uid') uid: string) {
    requireProjectAdmin(user);
    return this.projectService.setDefault(uid);
  }
}
```

- [ ] **Step 2: 类型检查 + 单测全跑一遍**

Run: `cd apps/api && pnpm tsc --noEmit && pnpm test`
Expected: 退出码 0，所有测试 PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/project/project.controller.ts
git commit -m "feat(api): accept new fields in project Create/Update DTOs"
```

---

## Task 7: API 集成自测（curl）

**Files:** 无（只跑 API）

- [ ] **Step 1: 起本地 API（如未跑）**

Run（新终端）:
```bash
cd apps/api && NODE_ENV=development \
  DATABASE_URL='postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' \
  pnpm dev
```

等待日志出现 `Nest application successfully started` 后保留这个终端。

- [ ] **Step 2: 获取 dev token**

Run:
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"ou_dev_harvey"}' | jq -r '.token // .data.token')
echo "TOKEN=$TOKEN"
```

Expected: `TOKEN=eyJhbGciOi...` 长字符串

- [ ] **Step 3: GET 列表确认新字段返回**

Run:
```bash
curl -s -H "Cookie: token=$TOKEN" http://localhost:3001/api/v1/projects | jq '.[0]'
```

Expected: 返回的 JSON 含 `category`、`ownerName`、`region`、`subtitle` 四个字段

- [ ] **Step 4: POST 创建一条**

Run:
```bash
curl -s -X POST http://localhost:3001/api/v1/projects \
  -H "Cookie: token=$TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"测试项目","category":"zy","ownerName":"Test","region":"印度"}' | jq
```

Expected: 200 + 含新字段的 JSON

- [ ] **Step 5: POST 非法 category 应失败**

Run:
```bash
curl -s -X POST http://localhost:3001/api/v1/projects \
  -H "Cookie: token=$TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"bad","category":"xx"}' | jq
```

Expected: 含 `Invalid category` 的错误响应

- [ ] **Step 6: 删除测试数据**

Run:
```bash
UID=$(curl -s -H "Cookie: token=$TOKEN" http://localhost:3001/api/v1/projects \
  | jq -r '.[] | select(.name=="测试项目") | .projectUid')
curl -s -X DELETE -H "Cookie: token=$TOKEN" "http://localhost:3001/api/v1/projects/$UID" | jq
```

Expected: `{"deleted":true}`

---

## Task 8: 更新字典文档（CLAUDE.md 强制）

**Files:**
- Modify: `docs/02-data/field-dictionary.md`
- Modify: `docs/02-data/enum-dictionary.md`

- [ ] **Step 1: 字段字典追加 4 条**

在 `docs/02-data/field-dictionary.md` 末尾追加（保持文件原有 markdown 风格）：

```markdown
## project 表 — 2026-05 新增字段

| 字段名 (TS) | 数据库列 | 类型 | 必填 | 含义 | 来源 |
|---|---|---|---|---|---|
| `category` | `project.category` | `varchar(8)` enum | 否 | 业务板块（`jt`/`zy`/`fw`/`tz`/`hz`） | 手填 |
| `ownerName` | `project.owner_name` | `varchar(64)` | 否 | 项目负责人显示名（自由文本，未来再升级飞书 user_id 关系） | 手填 |
| `region` | `project.region` | `varchar(32)` enum | 否 | 项目所在国家/地区 | 手填 |
| `subtitle` | `project.subtitle` | `varchar(64)` | 否 | 项目副标签（"NBFC × 2"、"联合负责" 等） | 手填 |
```

- [ ] **Step 2: 枚举字典追加 2 组**

在 `docs/02-data/enum-dictionary.md` 末尾追加：

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/02-data/field-dictionary.md docs/02-data/enum-dictionary.md
git commit -m "docs: register project category/owner/region/subtitle fields and enums"
```

---

## Task 9: 前端 Avatar 工具函数（TDD）

**Files:**
- Create: `apps/web/src/lib/avatar.ts`
- Create: `apps/web/src/lib/__tests__/avatar.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/lib/__tests__/avatar.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getAvatar, AVATAR_PALETTE } from '../avatar';

describe('getAvatar', () => {
  it('returns vacant style when name is null', () => {
    const r = getAvatar(null);
    expect(r.vacant).toBe(true);
    expect(r.initial).toBe('?');
  });

  it('returns vacant style when name is empty string', () => {
    const r = getAvatar('');
    expect(r.vacant).toBe(true);
  });

  it('uses first char for english name', () => {
    expect(getAvatar('Harvey').initial).toBe('H');
  });

  it('uses first char for chinese name', () => {
    expect(getAvatar('建豪').initial).toBe('建');
  });

  it('handles "Tobi + Yang" → T', () => {
    expect(getAvatar('Tobi + Yang').initial).toBe('T');
  });

  it('is deterministic — same name always same colors', () => {
    const a = getAvatar('Harvey');
    const b = getAvatar('Harvey');
    expect(a.bg).toBe(b.bg);
    expect(a.fg).toBe(b.fg);
  });

  it('different names usually produce different palettes', () => {
    const harvey = getAvatar('Harvey');
    const mia = getAvatar('Mia');
    // not strictly required, but expect at least one differs given hash distribution
    expect(harvey.bg !== mia.bg || harvey.fg !== mia.fg).toBe(true);
  });

  it('palette size is 8', () => {
    expect(AVATAR_PALETTE.length).toBe(8);
  });
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd apps/web && pnpm vitest run src/lib/__tests__/avatar.test.ts`
Expected: FAIL — `Cannot find module '../avatar'`

- [ ] **Step 3: 实现 avatar.ts**

创建 `apps/web/src/lib/avatar.ts`：

```ts
export interface AvatarStyle {
  initial: string;
  bg: string;
  fg: string;
  vacant: boolean;
}

export const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#0F172A', fg: '#FFFFFF' }, // harvey-style: deep slate
  { bg: '#FCE7F3', fg: '#BE185D' }, // mia-style: pink
  { bg: '#DBEAFE', fg: '#1D4ED8' }, // qi-style: blue
  { bg: '#FEF3C7', fg: '#B45309' }, // shawn-style: amber
  { bg: '#DCFCE7', fg: '#15803D' }, // george-style: green
  { bg: '#EDE9FE', fg: '#6D28D9' }, // jianhao-style: violet
  { bg: '#CFFAFE', fg: '#0E7490' }, // yang-style: cyan
  { bg: '#FFE4E6', fg: '#BE123C' }, // tobi-style: rose
];

const VACANT_STYLE: AvatarStyle = {
  initial: '?',
  bg: '#F1F5F9',
  fg: '#94A3B8',
  vacant: true,
};

export function getAvatar(name: string | null | undefined): AvatarStyle {
  if (!name || name.trim() === '') return VACANT_STYLE;
  const initial = Array.from(name.trim())[0];
  const hash = Array.from(name).reduce((acc, ch) => acc + ch.codePointAt(0)!, 0);
  const { bg, fg } = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  return { initial, bg, fg, vacant: false };
}
```

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `cd apps/web && pnpm vitest run src/lib/__tests__/avatar.test.ts`
Expected: All passing (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/avatar.ts apps/web/src/lib/__tests__/avatar.test.ts
git commit -m "feat(web): add getAvatar utility for owner avatars"
```

---

## Task 10: 前端 category 颜色 token

**Files:**
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: 查看现有 CSS 变量位置**

Run: `grep -n "^:root\|--accent-blue" apps/web/src/app/globals.css | head -10`
Expected: 找到 `:root { ... }` 块所在行

- [ ] **Step 2: 在 `:root` 块末尾追加 5 个 category token**

在 `apps/web/src/app/globals.css` 现有 `:root { }` 块的最后一个 `}` 前一行插入：

```css
  /* ---- project category (2026-05) ---- */
  --cat-jt: #475569;
  --cat-jt-soft: #F1F5F9;
  --cat-zy: #DC2626;
  --cat-zy-soft: #FEF2F2;
  --cat-fw: #EA580C;
  --cat-fw-soft: #FFF7ED;
  --cat-tz: #059669;
  --cat-tz-soft: #ECFDF5;
  --cat-hz: #2563EB;
  --cat-hz-soft: #EFF6FF;
```

如果存在 dark/light 主题分支（`[data-theme="dark"] { ... }`），同样在 dark 主题块也加这 10 行（颜色保持不变，5 个板块色在两个主题下视觉一致即可）。

- [ ] **Step 3: 验证 CSS 解析无错**

Run: `cd apps/web && pnpm build`
Expected: build 成功（如果失败说明 CSS 语法错）

> 如果 build 时间过长，可改为 `pnpm next lint` 或目视确认 globals.css 改动。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "style(web): add category color tokens (jt/zy/fw/tz/hz)"
```

---

## Task 11: 前端 ProjectModal 组件

**Files:**
- Create: `apps/web/src/components/project-modal.tsx`

- [ ] **Step 1: 实现 Modal 组件**

创建 `apps/web/src/components/project-modal.tsx`：

```tsx
'use client';
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ProjectCategory,
  ProjectCategoryLabel,
  ProjectCategoryOrder,
  ProjectRegion,
  ProjectRegionList,
} from '@leader-sync/shared-types';

export interface ProjectFormValue {
  name: string;
  category: ProjectCategory | null;
  ownerName: string | null;
  region: ProjectRegion | null;
  subtitle: string | null;
  isDefault: boolean;
}

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<ProjectFormValue>;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (value: ProjectFormValue) => Promise<void> | void;
}

const EMPTY: ProjectFormValue = {
  name: '',
  category: null,
  ownerName: '',
  region: null,
  subtitle: '',
  isDefault: false,
};

export function ProjectModal({ open, mode, initial, submitting, onClose, onSubmit }: Props) {
  const [v, setV] = useState<ProjectFormValue>(EMPTY);

  useEffect(() => {
    if (open) {
      setV({ ...EMPTY, ...initial });
    }
  }, [open, initial]);

  const canSubmit = v.name.trim() !== '' && !submitting;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      ...v,
      name: v.name.trim(),
      ownerName: v.ownerName?.trim() || null,
      subtitle: v.subtitle?.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">
            {mode === 'create' ? '新建项目' : '编辑项目'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="项目名称" required>
            <input
              value={v.name}
              onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))}
              placeholder="例如：XT 印度"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
              autoFocus
            />
          </Field>

          <Field label="业务板块">
            <div className="flex flex-wrap gap-2">
              {ProjectCategoryOrder.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setV((s) => ({ ...s, category: s.category === c ? null : c }))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
                    v.category === c
                      ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white'
                      : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)]'
                  }`}
                >
                  {ProjectCategoryLabel[c]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="负责人">
            <input
              value={v.ownerName ?? ''}
              onChange={(e) => setV((s) => ({ ...s, ownerName: e.target.value }))}
              placeholder="留空则显示「空缺」"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          <Field label="国家/地区">
            <select
              value={v.region ?? ''}
              onChange={(e) => setV((s) => ({ ...s, region: (e.target.value || null) as any }))}
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="">无</option>
              {ProjectRegionList.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>

          <Field label="副标签">
            <input
              value={v.subtitle ?? ''}
              onChange={(e) => setV((s) => ({ ...s, subtitle: e.target.value }))}
              placeholder="例如：NBFC × 2 / 联合负责"
              className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={v.isDefault}
              onChange={(e) => setV((s) => ({ ...s, isDefault: e.target.checked }))}
            />
            设为默认项目
          </label>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-full bg-[#3b82f6] px-6 py-2 text-sm font-medium text-white hover:bg-[#2563eb] disabled:opacity-50"
          >
            {submitting ? '提交中...' : (mode === 'create' ? '创建' : '保存')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
        {label}{required && <span className="text-[#ef4444] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/project-modal.tsx
git commit -m "feat(web): add ProjectModal for create/edit"
```

---

## Task 12: 重写 projects/page.tsx

**Files:**
- Modify: `apps/web/src/app/projects/page.tsx`

- [ ] **Step 1: 完全替换文件内容**

把 `apps/web/src/app/projects/page.tsx` 全文替换为：

```tsx
'use client';
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { ensureAuth } from '@/lib/auth';
import { getAvatar } from '@/lib/avatar';
import { ProjectModal, ProjectFormValue } from '@/components/project-modal';
import {
  ProjectCategory,
  ProjectCategoryLabel,
  ProjectCategoryOrder,
} from '@leader-sync/shared-types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Project {
  id: number;
  projectUid: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  category: ProjectCategory | null;
  ownerName: string | null;
  region: string | null;
  subtitle: string | null;
}

interface Permissions { canManage: boolean }

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ProjectsContent() {
  const [authed, setAuthed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  useEffect(() => { ensureAuth().then(setAuthed); }, []);

  const { data: projects, error, isLoading, mutate } = useSWR<Project[]>(
    authed ? '/api/v1/projects' : null,
    (url: string) => apiFetch<Project[]>(url),
  );
  const { data: perms } = useSWR<Permissions>(
    authed ? '/api/v1/projects/permissions' : null,
    (url: string) => apiFetch<Permissions>(url),
  );
  const canManage = perms?.canManage ?? false;

  /* ---- aggregations ---- */
  const grouped = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const c of ProjectCategoryOrder) groups.set(c, []);
    groups.set('uncategorized', []);
    for (const p of projects ?? []) {
      const key = p.category && groups.has(p.category) ? p.category : 'uncategorized';
      groups.get(key)!.push(p);
    }
    return groups;
  }, [projects]);

  const stats = useMemo(() => {
    const total = projects?.length ?? 0;
    const owners = new Set<string>();
    for (const p of projects ?? []) if (p.ownerName) owners.add(p.ownerName);
    const categories = ProjectCategoryOrder.filter((c) => (grouped.get(c)?.length ?? 0) > 0).length;
    return { total, categories, ownerCount: owners.size };
  }, [projects, grouped]);

  /* ---- handlers ---- */
  const openCreate = useCallback(() => {
    setEditingProject(null);
    setModalOpen(true);
  }, []);
  const openEdit = useCallback((p: Project) => {
    setEditingProject(p);
    setModalOpen(true);
  }, []);
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingProject(null);
  }, []);

  const handleSubmit = useCallback(async (v: ProjectFormValue) => {
    setSubmitting(true);
    try {
      if (editingProject) {
        await apiFetch(`/api/v1/projects/${editingProject.projectUid}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: v.name, category: v.category, ownerName: v.ownerName,
            region: v.region, subtitle: v.subtitle,
          }),
        });
        if (v.isDefault && !editingProject.isDefault) {
          await apiFetch(`/api/v1/projects/${editingProject.projectUid}/set-default`, { method: 'POST' });
        }
      } else {
        const created = await apiFetch<Project>('/api/v1/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: v.name, category: v.category, ownerName: v.ownerName,
            region: v.region, subtitle: v.subtitle,
          }),
        });
        if (v.isDefault) {
          await apiFetch(`/api/v1/projects/${created.projectUid}/set-default`, { method: 'POST' });
        }
      }
      closeModal();
      await mutate();
    } catch (err: any) {
      toast.error(`保存失败: ${err?.message ?? err}`);
    } finally {
      setSubmitting(false);
    }
  }, [editingProject, mutate, closeModal]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/projects/${deleteTarget.projectUid}`, { method: 'DELETE' });
      await mutate();
    } catch (err: any) {
      toast.error(`删除失败: ${err?.message ?? err}`);
    } finally {
      setSubmitting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, mutate]);

  if (!authed) return <LoadingScreen />;

  return (
    <div className="pb-16 pt-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">项目架构总览</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {stats.total} 个项目 · {stats.categories} 大业务板块 · {stats.ownerCount} 位负责人
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="rounded-full bg-[#3b82f6] px-5 py-2 text-sm font-medium text-white hover:bg-[#2563eb]"
          >
            新建项目
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-5 gap-2">
        {ProjectCategoryOrder.map((c) => (
          <div key={c} className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] px-3 py-2 text-center">
            <div className="text-xl font-bold" style={{ color: `var(--cat-${c})` }}>
              {grouped.get(c)?.length ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{ProjectCategoryLabel[c]}</div>
          </div>
        ))}
      </div>

      {isLoading && <div className="py-12 text-center text-[var(--text-muted)]">加载中...</div>}
      {error && <div className="py-12 text-center text-[#ef4444]">加载失败: {error.message}</div>}

      {/* Sections */}
      {!isLoading && !error && projects && (
        <>
          {ProjectCategoryOrder.map((c) => {
            const items = grouped.get(c) ?? [];
            return (
              <Section
                key={c}
                category={c}
                label={ProjectCategoryLabel[c]}
                items={items}
                canManage={canManage}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            );
          })}
          {(grouped.get('uncategorized')?.length ?? 0) > 0 && (
            <Section
              category={null}
              label="未分类"
              items={grouped.get('uncategorized') ?? []}
              canManage={canManage}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          )}
        </>
      )}

      <ProjectModal
        open={modalOpen}
        mode={editingProject ? 'edit' : 'create'}
        initial={editingProject ? {
          name: editingProject.name,
          category: editingProject.category,
          ownerName: editingProject.ownerName,
          region: editingProject.region as any,
          subtitle: editingProject.subtitle,
          isDefault: editingProject.isDefault,
        } : undefined}
        submitting={submitting}
        onClose={closeModal}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[var(--bg-card)] border-[var(--border)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--text-primary)]">
              确认删除项目「{deleteTarget?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--text-secondary)]">
              此操作不可撤销。该项目下的任务不会被删除，但将失去项目归属。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => { e.preventDefault(); handleDeleteConfirmed(); }}
              className="bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red)]/90"
            >
              {submitting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  category, label, items, canManage, onEdit, onDelete,
}: {
  category: ProjectCategory | null;
  label: string;
  items: Project[];
  canManage: boolean;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  if (items.length === 0) return null; // 不渲染空板块
  const catVar = category ? `var(--cat-${category})` : '#94A3B8';
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: catVar }} />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {label}
          </span>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{items.length} 个项目</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((p) => (
          <ProjectCard
            key={p.projectUid}
            project={p}
            categoryVar={catVar}
            canManage={canManage}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({
  project, categoryVar, canManage, onEdit, onDelete,
}: {
  project: Project;
  categoryVar: string;
  canManage: boolean;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const av = getAvatar(project.ownerName);
  return (
    <div
      className="group relative overflow-hidden rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4"
      style={{ borderLeft: `3px solid ${categoryVar}` }}
    >
      {/* name row */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2 flex-wrap">
            <span>{project.name}</span>
            {project.subtitle && (
              <span className="rounded-md bg-[#2563eb] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {project.subtitle}
              </span>
            )}
            {project.isDefault && (
              <span className="rounded-full border border-[#3b82f6]/20 bg-[#3b82f6]/10 px-2 py-0.5 text-[10px] text-[#3b82f6]">
                默认
              </span>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => onEdit(project)}
              className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[#3b82f6]/10 hover:text-[#3b82f6]"
              title="编辑"
            >
              <PencilIcon />
            </button>
            {!project.isDefault && (
              <button
                onClick={() => onDelete(project)}
                className="rounded-full p-1.5 text-[#ef4444] hover:bg-[#ef4444]/10"
                title="删除"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      {/* meta row */}
      <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={{
              background: av.bg,
              color: av.fg,
              ...(av.vacant ? { border: '1px dashed #CBD5E1' } : {}),
            }}
          >
            {av.initial}
          </div>
          <span className={`truncate text-sm font-semibold ${av.vacant ? 'italic text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
            {av.vacant ? '空缺' : project.ownerName}
          </span>
        </div>
        {project.region && (
          <span className="shrink-0 rounded-md bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
            {project.region}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <ProjectsContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 起本地 dev 看一眼**

Run（新终端）: `cd apps/web && pnpm dev:tee`

打开 `http://localhost:3000`，控制台执行：
```js
fetch('/api/v1/auth/dev-login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: 'ou_dev_harvey' }),
}).then(() => location.reload());
```

进入 `/projects`，目视确认：
- 5 个板块按 集团→自营→服务→投资→合作 顺序渲染
- 集团 1 / 自营 8 / 服务 3 / 投资 7 / 合作 2
- XT 巴基斯坦 显示虚线头像 + "空缺"
- DFW 卡片显示 "联合负责" 副标签
- cash 印度 显示 "NBFC × 2" 副标签

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/projects/page.tsx
git commit -m "feat(web): rebuild /projects with category grouping + cards"
```

---

## Task 13: 前端 RTL 测试

**Files:**
- Create: `apps/web/src/app/projects/__tests__/page.test.tsx`

- [ ] **Step 1: 写 RTL 测试**

创建文件：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProjectsPage from '../page';

// Mock SWR fetch
vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  ensureAuth: vi.fn(async () => true),
}));

import { apiFetch } from '@/lib/api-client';

const MOCK_PROJECTS = [
  { id: 1, projectUid: 'p1', name: '公司建设', isDefault: true,  createdAt: '2026-01-01', category: 'jt', ownerName: null,   region: null,   subtitle: null },
  { id: 2, projectUid: 'p2', name: 'XT 印度',  isDefault: false, createdAt: '2026-01-02', category: 'zy', ownerName: 'Mia', region: '印度', subtitle: null },
  { id: 3, projectUid: 'p3', name: 'XT 巴基',  isDefault: false, createdAt: '2026-01-03', category: 'zy', ownerName: null,   region: '巴基斯坦', subtitle: null },
  { id: 4, projectUid: 'p4', name: 'cash 印度', isDefault: false, createdAt: '2026-01-04', category: 'hz', ownerName: 'Harvey', region: '印度', subtitle: 'NBFC × 2' },
];

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/projects/permissions')) return Promise.resolve({ canManage: true });
      if (url === '/api/v1/projects') return Promise.resolve(MOCK_PROJECTS);
      return Promise.resolve(null);
    });
  });

  it('renders the page header with computed stats', async () => {
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText(/项目架构总览/)).toBeInTheDocument());
    expect(screen.getByText(/4 个项目/)).toBeInTheDocument();
    // 2 categories present (jt, zy, hz) — but stats text says "X 大业务板块"
    expect(screen.getByText(/位负责人/)).toBeInTheDocument();
  });

  it('groups projects by category in fixed order', async () => {
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('XT 印度')).toBeInTheDocument());
    // 集团板块标题先出现
    const sections = screen.getAllByText(/集团|自营|服务|投资|合作/);
    const labels = sections.map((n) => n.textContent);
    const jtIdx = labels.indexOf('集团');
    const zyIdx = labels.indexOf('自营');
    expect(jtIdx).toBeLessThan(zyIdx);
  });

  it('renders vacant owner state', async () => {
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('XT 巴基')).toBeInTheDocument());
    expect(screen.getByText('空缺')).toBeInTheDocument();
  });

  it('renders subtitle tag (NBFC × 2)', async () => {
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('cash 印度')).toBeInTheDocument());
    expect(screen.getByText('NBFC × 2')).toBeInTheDocument();
  });

  it('renders region tag', async () => {
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('XT 印度')).toBeInTheDocument());
    expect(screen.getAllByText('印度').length).toBeGreaterThan(0);
  });

  it('shows 新建项目 button when canManage=true', async () => {
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '新建项目' })).toBeInTheDocument());
  });

  it('hides admin actions when canManage=false', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/projects/permissions')) return Promise.resolve({ canManage: false });
      if (url === '/api/v1/projects') return Promise.resolve(MOCK_PROJECTS);
      return Promise.resolve(null);
    });
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText(/项目架构总览/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试**

Run: `cd apps/web && pnpm vitest run src/app/projects/__tests__/page.test.tsx`
Expected: All passing (7 tests)

> 如果有失败：先看 RED 信息再修组件或测试（不要盲调）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/projects/__tests__/page.test.tsx
git commit -m "test(web): add RTL tests for projects architecture page"
```

---

## Task 14: Playwright e2e + screenshot audit

**Files:**
- Modify: `apps/web/e2e/desktop.spec.ts`

- [ ] **Step 1: 替换 `03-projects` 测试并加 modal 截图**

在 `apps/web/e2e/desktop.spec.ts` 找到 `03-projects` 那段（约第 22-25 行）：

```ts
  test('03-projects', async ({ page }) => {
    await visit(page, '/projects');
    await snap(page, '03-projects');
  });
```

替换为：

```ts
  test('03-projects', async ({ page }) => {
    await visit(page, '/projects');
    await snap(page, '03-projects');
  });

  test('03b-projects-create-modal', async ({ page }) => {
    await visit(page, '/projects');
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.waitForTimeout(300);
    await snap(page, '03b-projects-create-modal');
  });

  test('03c-projects-edit-modal', async ({ page }) => {
    await visit(page, '/projects');
    // hover first card to reveal pencil button (group-hover) then click
    const firstCard = page.locator('[data-slot="dialog-overlay"]').first();
    await page.locator('text=编辑').first().click({ force: true });
    await page.waitForTimeout(300);
    await snap(page, '03c-projects-edit-modal');
  });
```

> 注：`text=编辑` 是 `title="编辑"` 的铅笔按钮。如选择器在实际页面打不到，回 task 12 step 1 给铅笔按钮加个 `aria-label="编辑项目"`。

- [ ] **Step 2: 确认前后端 dev 都在跑 + 起截图**

Run:
```bash
cd apps/web && pnpm e2e:audit --update-snapshots --grep="03-projects|03b-projects|03c-projects"
```

Expected: 3 个 spec 通过，生成 3 个 PNG 在 `apps/web/test-results/`

- [ ] **Step 3: 主动 Read 3 张截图，目视确认**

读取：
- `apps/web/e2e/desktop.spec.ts-snapshots/03-projects-desktop-linux.png`（或 mac 对应名）
- `03b-projects-create-modal-...png`
- `03c-projects-edit-modal-...png`

确认：
- 03: 5 板块分组，stats 卡，卡片视觉对齐 demo
- 03b: 新建 modal 5 个字段都可见
- 03c: 编辑 modal 预填值正确

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/desktop.spec.ts apps/web/e2e/desktop.spec.ts-snapshots/
git commit -m "test(e2e): screenshot audit for projects architecture page + modals"
```

---

## Task 15: 生产数据迁移脚本（dry-run）

**Files:**
- Create: `db/scripts/migrate-projects-prod-2026-05.ts`

- [ ] **Step 1: 写迁移脚本（含 dry-run）**

创建 `db/scripts/migrate-projects-prod-2026-05.ts`：

```ts
/**
 * One-time migration: 把生产环境 project 表迁移到「项目架构总览」字段结构。
 *
 * 步骤：
 *   1. UPDATE 公司建设 SET category='jt'
 *   2. UPDATE 印度金融 → name='XT 印度', category='zy', region='印度', owner_name='Mia'
 *   3. UPDATE 印尼电商 → name='XL 电商', category='zy', region='印尼', owner_name='Shawn'
 *   4. INSERT 18 条新项目
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx db/scripts/migrate-projects-prod-2026-05.ts           # dry-run
 *   DATABASE_URL=... pnpm tsx db/scripts/migrate-projects-prod-2026-05.ts --apply   # 真正执行
 */
import 'dotenv/config';
import { createDb } from '../src/connection';
import { project } from '../src/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

interface UpdateRow { match: string; set: Record<string, unknown>; }
const UPDATES: UpdateRow[] = [
  { match: '公司建设', set: { category: 'jt' } },
  { match: '印度金融', set: { name: 'XT 印度', category: 'zy', region: '印度', ownerName: 'Mia' } },
  { match: '印尼电商', set: { name: 'XL 电商', category: 'zy', region: '印尼', ownerName: 'Shawn' } },
];

interface InsertRow { name: string; category: string; ownerName: string | null; region: string | null; subtitle: string | null; }
const INSERTS: InsertRow[] = [
  { name: 'DFW 印度',     category: 'zy', ownerName: 'Qi',          region: '印度',      subtitle: null },
  { name: 'XL 内容',      category: 'zy', ownerName: 'Shawn',       region: '印尼',      subtitle: null },
  { name: 'XL 供应链',    category: 'zy', ownerName: 'George',      region: '印尼',      subtitle: null },
  { name: 'XT 巴基斯坦',  category: 'zy', ownerName: null,          region: '巴基斯坦',  subtitle: null },
  { name: 'DFW 巴基斯坦', category: 'zy', ownerName: 'Qi',          region: '巴基斯坦',  subtitle: null },
  { name: 'XT 孟加拉',    category: 'zy', ownerName: '建豪',        region: '孟加拉',    subtitle: null },
  { name: 'XW 印度',      category: 'fw', ownerName: 'Mia',         region: '印度',      subtitle: null },
  { name: 'AS 印度',      category: 'fw', ownerName: 'Mia',         region: '印度',      subtitle: null },
  { name: 'CQ 风控',      category: 'fw', ownerName: 'Yang',        region: '印度',      subtitle: null },
  { name: 'KD',           category: 'tz', ownerName: '建豪',        region: '巴基斯坦',  subtitle: null },
  { name: 'LWT',          category: 'tz', ownerName: '建豪',        region: '巴基斯坦',  subtitle: null },
  { name: 'SkyD',         category: 'tz', ownerName: '建豪',        region: '巴基斯坦',  subtitle: null },
  { name: 'Zeropay',      category: 'tz', ownerName: 'Yang',        region: '印度',      subtitle: null },
  { name: 'allenpay',     category: 'tz', ownerName: 'Yang',        region: '印度',      subtitle: null },
  { name: 'DFW',          category: 'tz', ownerName: 'Tobi + Yang', region: '印度',      subtitle: '联合负责' },
  { name: 'VN 深圳',      category: 'tz', ownerName: 'Harvey',      region: '深圳',      subtitle: null },
  { name: 'cash 印度',    category: 'hz', ownerName: 'Harvey',      region: '印度',      subtitle: 'NBFC × 2' },
  { name: 'CQ 孟加拉',    category: 'hz', ownerName: 'Harvey',      region: '孟加拉',    subtitle: null },
];

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL missing');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL);

  const before = await db.select().from(project);
  console.log(`Before: ${before.length} projects`);

  // Dry-run: show what would happen
  for (const u of UPDATES) {
    const hit = before.find((p) => p.name === u.match);
    if (!hit) {
      console.warn(`! UPDATE skip: name "${u.match}" not found`);
      continue;
    }
    console.log(`[update] ${u.match} → ${JSON.stringify(u.set)}`);
    if (apply) {
      await db.update(project).set(u.set as any).where(eq(project.id, hit.id));
    }
  }

  const existingNames = new Set(before.map((p) => p.name).concat(UPDATES.map((u) => u.set.name as string).filter(Boolean)));
  for (const row of INSERTS) {
    if (existingNames.has(row.name)) {
      console.log(`[insert skip] ${row.name} already exists`);
      continue;
    }
    console.log(`[insert] ${row.name}`);
    if (apply) {
      await db.insert(project).values({
        projectUid: `proj_${nanoid(12)}`,
        ...row,
      } as any);
    }
  }

  const after = await db.select().from(project);
  console.log(`After: ${after.length} projects (apply=${apply})`);
  if (!apply) {
    console.log('\n>> dry-run only. Add --apply to actually execute.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: dry-run on dev DB（验证逻辑）**

Run:
```bash
DATABASE_URL='postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' \
  pnpm tsx db/scripts/migrate-projects-prod-2026-05.ts
```

Expected: 输出 `[update skip]`（dev DB 已经迁移过了 via seed，3 条 UPDATE 都 skip）+ 18 条 `[insert skip]`（dev 已含）+ `>> dry-run only`

- [ ] **Step 3: Commit**

```bash
git add db/scripts/migrate-projects-prod-2026-05.ts
git commit -m "chore(db): one-time migration script for prod (dry-run by default)"
```

---

## Task 16: 终局自检 + 部署准备

**Files:** 无新增

- [ ] **Step 1: 全项目类型检查**

Run（项目根）:
```bash
pnpm -r lint
```
Expected: 所有包 `tsc --noEmit` 0 errors

- [ ] **Step 2: 全项目测试**

Run:
```bash
pnpm -r test
```
Expected: 所有单测 PASS

- [ ] **Step 3: 重读截图，主动确认**

Read 三张截图（Task 14 已生成的），写下"我已通过 screenshots/... 确认 UI 表现符合预期"。

- [ ] **Step 4: 生产部署清单（待用户决策后执行，本任务只列清单）**

清单写到 PR description（不入 commit）：

```
[ ] 1. 生产 DB 备份：
    ssh root@47.84.35.154 "docker exec leader-sync-postgres-1 pg_dump -U leader_sync leader_sync > /tmp/db-backup-pre-arch-migration-$(date +%F).sql"

[ ] 2. 应用 schema migration 到生产：
    psql -h ... -f db/migrations/0003_project_arch_fields.sql

[ ] 3. 在生产跑数据迁移（先 dry-run，再 --apply）：
    DATABASE_URL=... pnpm tsx db/scripts/migrate-projects-prod-2026-05.ts
    DATABASE_URL=... pnpm tsx db/scripts/migrate-projects-prod-2026-05.ts --apply

[ ] 4. 部署 API：rsync apps/api/dist + 重启
[ ] 5. 部署 Web：rsync apps/web/.next + 重启
[ ] 6. 烟雾测试：GET /api/v1/projects + 打开 /projects 页
```

- [ ] **Step 5: 最终 Commit（如有 readme 更新）**

```bash
# 如果有遗留改动
git add -A
git commit -m "chore: final cleanup for project arch overview"
```

---

## Self-Review 检查表

- ✅ Spec coverage：spec 12 章每章都对应 1+ task
  - §4 DB Schema → Task 2/3
  - §5 数据迁移 → Task 4（dev）+ Task 15（prod）
  - §6 API 变更 → Task 5/6/7
  - §7 UI 设计 → Task 9/10/11/12
  - §8 权限 → Task 12（复用现有 canManage）
  - §9 测试计划 → Task 5（unit）+ Task 7（API 自测）+ Task 13（RTL）+ Task 14（e2e）
  - §11 风险与回滚 → Task 16 step 4 清单
- ✅ Placeholder scan：无 TBD / TODO / "implement later"
- ✅ 类型一致性：
  - `ProjectInput` 在 Task 5 定义 → Task 6/12 引用同名 type
  - `ProjectFormValue` 在 Task 11 定义 → Task 12 引用
  - `getAvatar` 签名一致（Task 9 定义 → Task 12 使用）
  - `ProjectCategoryOrder` / `ProjectRegionList` 在 Task 1 export → 后续都引用同名

## Notes for executor

1. **TDD 顺序铁律**：Task 5 / 9 / 13 都是先写测试看 RED → 再写实现 → 看 GREEN。不要颠倒。
2. **dev DB 状态依赖**：Task 4 重置 dev DB 会清空所有 tasks（fixtures 重新 seed）。如果中途想保留某些 dev 数据，先 `pg_dump`。
3. **生产数据迁移**：Task 15 只是写脚本 + dry-run。**真正执行 `--apply` 必须在用户明确批准 + 备份生产 DB 之后**。
4. **screenshot audit 路径**：playwright 在 macOS 上生成的快照后缀是 `-darwin.png`，linux 是 `-linux.png`。CI 跑哪个平台就提交哪个版本的快照。
