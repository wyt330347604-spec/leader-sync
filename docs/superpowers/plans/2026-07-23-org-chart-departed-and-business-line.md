# 组织架构：粘性离职标记 + 业务线分图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员能在 `/org` 手动标记离职（同步不复活）+ 管理者离职自动上并下属 + 按汇报链顶端把组织图拆成虾条/曙条/未分组。

**Architecture:** 沿用现有 org 模块四层（db schema → worker sync → api service/repo/controller → web）。核心是新增 `left_source` 列区分人工/自动离职，改造 worker 复职自愈逻辑只复活自动标记。业务线分组在 API 端计算后随 `/org/tree` 下发，前端仅按字段过滤。

**Tech Stack:** Drizzle ORM (Postgres) · NestJS · vitest · Next.js + React Flow (@xyflow/react)

## Global Constraints

- 不可变数据：service 仲裁值、repository 只写；不原地改传入对象。
- 双命名空间：所有"按 id 找人/找上级"必须 `user_id` OR `open_id` 命中；行的规范句柄用 `ouHandle(row)`（`open_id` 以 `ou_` 开头则取之，否则取 `user_id`）。
- TDD：每个业务改动先写失败测试看到 RED 再实现（QC Protocol Red-Light-First，铁律）。
- 权限：写操作限白名单 `ORG_STRUCTURE_ADMINS`（Harvey `ou_1c419560953e219d5876918a2b934dfb` / 杨平 `ou_5a06e17c2ec88a72a2ef4ce040b3d77d` / dev `ou_dev_harvey`）。
- `db` 包改 schema 后必须 `pnpm exec tsc -p tsconfig.build.json` 重建（默认 tsconfig 含 scripts/ 会报错）。
- migration 顺延：当前最新 `0023`，本计划用 `0024`。
- commit 用 `<type>: <desc>` 规范。

---

## File Structure

- `db/src/schema/org-cache.ts` — 加 `leftSource` 列（Task 1）
- `db/migrations/0024_org_left_source.sql` — 新迁移（Task 1）
- `apps/worker/src/jobs/sync-org-hierarchy.ts` — 复职自愈按 source 分流（Task 2）
- `apps/api/src/modules/org/dto/set-left.dto.ts` — 新 DTO（Task 3）
- `apps/api/src/modules/org/org.repository.ts` — `setLeft` + `reparentChildren`（Task 3）
- `apps/api/src/modules/org/org.service.ts` — `setLeft`（含自动上并）+ getTree 加 `business_line`（Task 3、4）
- `apps/api/src/modules/org/org.controller.ts` — `PATCH users/:uid/left`（Task 3）
- `apps/api/src/modules/org/org-business-line.ts` — 顶端→业务线配置 + 解析（Task 4）
- `apps/web/src/hooks/use-org-tree.ts` — `setLeft` helper + 类型加 `business_line`（Task 5）
- `apps/web/src/app/org/org-node-card.tsx` — 标记/撤销离职按钮（Task 5）
- `apps/web/src/app/org/org-canvas.tsx` + `page.tsx` — 透传 `onSetLeft`（Task 5）
- `apps/web/src/app/org/page.tsx` — 业务线标签过滤（Task 6）

---

## Task 1: DB — 新增 left_source 列

**Files:**
- Modify: `db/src/schema/org-cache.ts`
- Create: `db/migrations/0024_org_left_source.sql`

**Interfaces:**
- Produces: `orgCache.leftSource: varchar('left_source', 16)`（可空；null 视同历史 'feishu'）。Task 2/3 读写。

- [ ] **Step 1: 加 schema 列**（在 `leftAt` 定义之后插入）

```typescript
  // left_at: 飞书同步自动判定离职（NULL=在职）；sync-engine 之外由 sync-org-hierarchy 写
  leftAt: timestamp('left_at', { withTimezone: true }),
  // 离职来源：'feishu'=通讯录同步自动判定（可被复职自愈清除）| 'manual'=管理员手动标记（同步永不复活）
  // NULL 视同历史 'feishu'。migration 0024
  leftSource: varchar('left_source', { length: 16 }),
```

- [ ] **Step 2: 写迁移文件** `db/migrations/0024_org_left_source.sql`

```sql
-- 0024: org_cache 离职来源，区分人工/自动，防手动标记被通讯录同步复活
-- left_source: 'manual'=管理员手动标记（永不自动复活）| 'feishu'=同步自动判定（可复活）| NULL=历史行(视同 feishu)
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS left_source varchar(16);
```

- [ ] **Step 3: 构建 db 包并验证类型导出**

Run: `cd db && pnpm exec tsc -p tsconfig.build.json && grep -c leftSource dist/schema/org-cache.d.ts`
Expected: 退出码 0；grep 计数 ≥ 1

- [ ] **Step 4: Commit**

```bash
git add db/src/schema/org-cache.ts db/migrations/0024_org_left_source.sql
git commit -m "feat(db): org_cache 加 left_source 列 (migration 0024)"
```

---

## Task 2: Worker — 复职自愈按来源分流（手动离职粘性）

**Files:**
- Modify: `apps/worker/src/jobs/sync-org-hierarchy.ts:331-340`
- Test: `apps/worker/src/jobs/__tests__/sync-org-hierarchy.spec.ts`（既有文件，追加用例；若无则新建）

**Interfaces:**
- Consumes: `orgCache.leftSource`（Task 1）；既有 `fetched`（本次通讯录枚举 Map）、`resolvable`、`ouHandle`、`row.leftAt`、`row.id`、`db`、`now`、`dryRun`、`result.revived/markedLeft`。
- Produces: 行为变更——`left_source='manual'` 的行不被复活；自动标离职写 `left_source='feishu'`。

- [ ] **Step 1: 写失败测试**（追加到 sync-org-hierarchy 测试；沿用该文件既有 mock db / orgRows fixture 风格，fixture 每行补 `leftSource` 字段）

```typescript
describe('离职判定：手动标记粘性', () => {
  it('left_source=manual 且人仍在通讯录 → 不复活（保留 leftAt）', async () => {
    // 通讯录枚举到该人（isActive=true），但其 leftAt 是人工标记
    const { db, updates } = makeSyncDb({
      orgRows: [{ id: 1, userId: 'ou_x', openId: 'ou_x', userName: 'X',
        managerUserId: null, managerSource: 'manual',
        leftAt: new Date('2026-07-01'), leftSource: 'manual', hiddenAt: null }],
      directory: [{ open_id: 'ou_x', name: 'X', leader_user_id: null }], // 仍在通讯录
    });
    const r = await syncOrgHierarchy({ db, dryRun: false });
    expect(r.revived).toBe(0);
    expect(updates.find((u) => u.leftAt === null)).toBeUndefined(); // 没有清 leftAt 的写
  });

  it('left_source=feishu 且人回到通讯录 → 复活（清 leftAt）', async () => {
    const { db } = makeSyncDb({
      orgRows: [{ id: 2, userId: 'ou_y', openId: 'ou_y', userName: 'Y',
        managerUserId: null, managerSource: 'feishu',
        leftAt: new Date('2026-07-01'), leftSource: 'feishu', hiddenAt: null }],
      directory: [{ open_id: 'ou_y', name: 'Y', leader_user_id: null }],
    });
    const r = await syncOrgHierarchy({ db, dryRun: false });
    expect(r.revived).toBe(1);
  });

  it('自动标离职写 left_source=feishu', async () => {
    const { db, updates } = makeSyncDb({
      orgRows: [{ id: 3, userId: 'ou_z', openId: 'ou_z', userName: 'Z',
        managerUserId: null, managerSource: 'feishu',
        leftAt: null, leftSource: null, hiddenAt: null }],
      directory: [], // 不在通讯录 → 应标离职
    });
    const r = await syncOrgHierarchy({ db, dryRun: false });
    expect(r.markedLeft).toBe(1);
    expect(updates.find((u) => u.leftSource === 'feishu')).toBeDefined();
  });
});
```

> 注：`makeSyncDb` 为该 spec 既有 helper；若签名不同，按现有 fixture 构造方式适配（保持 orgRows 行补 `leftSource`，directory 决定 `fetched`）。安全阀不触发需保证 directory 数 ≥ resolvable 活跃数 × 比例——单行用例可临时下调或让活跃集含该行。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/worker && pnpm exec vitest run src/jobs/__tests__/sync-org-hierarchy.spec.ts -t 粘性`
Expected: FAIL（现逻辑无条件复活 → 第 1 例 revived=1 而非 0）

- [ ] **Step 3: 改复活/标离职逻辑**（`sync-org-hierarchy.ts` line 331-340 的 for 循环体）

```typescript
    for (const row of resolvable) {
      const h = ouHandle(row)!;
      const isActive = activeHandles.has(h);
      if (isActive && row.leftAt != null && row.leftSource !== 'manual') {
        // 仅自动标记(feishu/历史null)可复活；人工标记永不自动复活
        if (!dryRun) await db.update(orgCache).set({ leftAt: null, leftSource: null, updatedAt: now }).where(eq(orgCache.id, row.id));
        result.revived++;
      } else if (!isActive && row.leftAt == null) {
        if (!dryRun) await db.update(orgCache).set({ leftAt: now, leftSource: 'feishu', updatedAt: now }).where(eq(orgCache.id, row.id));
        result.markedLeft++;
      }
    }
```

- [ ] **Step 4: 运行测试确认通过 + 全量 worker 回归**

Run: `cd apps/worker && pnpm exec vitest run`
Expected: 全 PASS（含新 3 例 + 既有用例）

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/sync-org-hierarchy.ts apps/worker/src/jobs/__tests__/sync-org-hierarchy.spec.ts
git commit -m "feat(worker): 复职自愈按 left_source 分流，手动离职标记不被同步复活"
```

---

## Task 3: API — PATCH /left 端点 + 自动上并下属

**Files:**
- Create: `apps/api/src/modules/org/dto/set-left.dto.ts`
- Modify: `apps/api/src/modules/org/org.repository.ts`
- Modify: `apps/api/src/modules/org/org.service.ts`
- Modify: `apps/api/src/modules/org/org.controller.ts`
- Test: `apps/api/src/modules/org/org.service.spec.ts`（既有）

**Interfaces:**
- Consumes: `OrgRepository.listAll()`、`ouHandle`、`buildLookup`、`assertOrgAdmin`、`ErrorCode.ORG_USER_NOT_FOUND`。
- Produces:
  - `OrgRepository.setLeft(rowIds: number[], values: { leftAt: Date | null; leftSource: 'manual' | null; updatedAt: Date }): Promise<void>`
  - `OrgRepository.reparentChildren(childRowIds: number[], newManagerHandle: string | null, newManagerName: string | null, updatedAt: Date, updatedBy: string): Promise<void>`
  - `OrgService.setLeft(requester, targetUserId, left: boolean): Promise<{ user_id: string; left: boolean; reparented: number }>`
  - `PATCH /api/v1/org/users/:user_id/left` body `{ left: boolean }`

- [ ] **Step 1: 写 DTO** `dto/set-left.dto.ts`

```typescript
import { IsBoolean } from 'class-validator';

export class SetLeftDto {
  /** true=标记离职（人工，同步不复活） | false=撤销离职 */
  @IsBoolean()
  left!: boolean;
}
```

- [ ] **Step 2: 加 repository 方法**（`org.repository.ts`，追加到 class 内）

```typescript
  /** 按行 id 批量写离职标记（同句柄多行连带，值由 service 仲裁好） */
  async setLeft(
    rowIds: number[],
    values: { leftAt: Date | null; leftSource: 'manual' | null; updatedAt: Date },
  ): Promise<void> {
    if (rowIds.length === 0) return;
    await this.db
      .update(orgCache)
      .set({ leftAt: values.leftAt, leftSource: values.leftSource, updatedAt: values.updatedAt })
      .where(inArray(orgCache.id, rowIds));
  }

  /** 自动上并：把若干下属行的上级改到新句柄，并标 manual（防同步覆盖） */
  async reparentChildren(
    childRowIds: number[],
    newManagerHandle: string | null,
    newManagerName: string | null,
    updatedAt: Date,
    updatedBy: string,
  ): Promise<void> {
    if (childRowIds.length === 0) return;
    await this.db
      .update(orgCache)
      .set({
        managerUserId: newManagerHandle,
        managerName: newManagerName,
        managerSource: 'manual',
        managerUpdatedAt: updatedAt,
        managerUpdatedBy: updatedBy,
        updatedAt,
      })
      .where(inArray(orgCache.id, childRowIds));
  }
```

- [ ] **Step 3: 写失败测试**（`org.service.spec.ts`；沿用该文件既有 mock repository 风格）

```typescript
describe('OrgService.setLeft', () => {
  it('非管理员 → 抛 UNAUTHORIZED/403', async () => {
    const { service } = makeOrgService({ rows: [] });
    await expect(
      service.setLeft({ userId: 'emp_stranger', openId: 'ou_stranger' }, 'ou_a', true),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('标离职：写 leftSource=manual，并把下属上并到离职者的上级', async () => {
    // P(ou_p) 上级 ou_boss；C(ou_c) 上级 ou_p
    const rows = [
      { id: 1, userId: 'ou_p', openId: 'ou_p', userName: 'P', managerUserId: 'ou_boss' },
      { id: 2, userId: 'ou_c', openId: 'ou_c', userName: 'C', managerUserId: 'ou_p' },
      { id: 3, userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null },
    ];
    const { service, repo } = makeOrgService({ rows, admin: true });
    const r = await service.setLeft({ userId: 'ou_dev_harvey', openId: 'ou_dev_harvey' }, 'ou_p', true);
    expect(r.reparented).toBe(1);
    expect(repo.setLeft).toHaveBeenCalledWith([1], expect.objectContaining({ leftSource: 'manual' }));
    expect(repo.reparentChildren).toHaveBeenCalledWith([2], 'ou_boss', 'Boss', expect.any(Date), expect.any(String));
  });

  it('顶端离职：下属上级置空（成新顶端）', async () => {
    const rows = [
      { id: 1, userId: 'ou_top', openId: 'ou_top', userName: 'Top', managerUserId: null },
      { id: 2, userId: 'ou_c', openId: 'ou_c', userName: 'C', managerUserId: 'ou_top' },
    ];
    const { service, repo } = makeOrgService({ rows, admin: true });
    await service.setLeft({ userId: 'ou_dev_harvey', openId: 'ou_dev_harvey' }, 'ou_top', true);
    expect(repo.reparentChildren).toHaveBeenCalledWith([2], null, null, expect.any(Date), expect.any(String));
  });

  it('撤销离职：清 leftAt/leftSource，不动下属', async () => {
    const rows = [{ id: 1, userId: 'ou_p', openId: 'ou_p', userName: 'P', managerUserId: null, leftAt: new Date(), leftSource: 'manual' }];
    const { service, repo } = makeOrgService({ rows, admin: true });
    const r = await service.setLeft({ userId: 'ou_dev_harvey', openId: 'ou_dev_harvey' }, 'ou_p', false);
    expect(r.reparented).toBe(0);
    expect(repo.setLeft).toHaveBeenCalledWith([1], expect.objectContaining({ leftAt: null, leftSource: null }));
    expect(repo.reparentChildren).not.toHaveBeenCalled();
  });
});
```

> 注：若 `org.service.spec.ts` 无 `makeOrgService` helper，按既有测试构造方式建：`new OrgService(mockRepo)`，`mockRepo.listAll` 返回 rows（补齐字段：openId/userName/managerUserId/managerSource/leftAt/hiddenAt/leftSource），`admin:true` 时 requester 用白名单内 `ou_dev_harvey`。

- [ ] **Step 4: 运行测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/org/org.service.spec.ts -t setLeft`
Expected: FAIL（`service.setLeft` 未定义）

- [ ] **Step 5: 实现 service.setLeft**（`org.service.ts`，加到 class 内；`buildLookup`/`ouHandle` 已在文件顶部）

```typescript
  /**
   * 手动标记/撤销离职（人工，left_source='manual'，通讯录同步不复活）。仅白名单。
   * 标离职时：按句柄连带同一人所有行；并把其直属下属自动上并到离职者的上级
   * （children.manager -> P.manager，置 manual 防同步覆盖）。顶端离职则下属上级置空。
   */
  async setLeft(
    requester: OrgRequester,
    targetUserId: string,
    left: boolean,
  ): Promise<{ user_id: string; left: boolean; reparented: number }> {
    this.assertOrgAdmin(requester);

    const rows = await this.orgRepository.listAll();
    const target = buildLookup(rows).get(targetUserId);
    if (!target) {
      throw new BusinessException(
        ErrorCode.ORG_USER_NOT_FOUND,
        `用户 ${targetUserId} 不在组织缓存中`,
        HttpStatus.NOT_FOUND,
      );
    }

    const handle = ouHandle(target);
    const rowIds = (rows as any[]).filter((r) => ouHandle(r) === handle).map((r) => r.id);
    const now = new Date();

    if (!left) {
      await this.orgRepository.setLeft(rowIds, { leftAt: null, leftSource: null, updatedAt: now });
      return { user_id: target.userId, left: false, reparented: 0 };
    }

    // 自动上并：直属下属（manager 命中 P 的任一 id）改挂到 P 的上级
    const childRowIds = (rows as any[])
      .filter((r) => r.managerUserId && (r.managerUserId === target.userId || r.managerUserId === target.openId))
      .map((r) => r.id);
    const managerRow = target.managerUserId ? buildLookup(rows).get(target.managerUserId) : null;
    const newManagerHandle = managerRow ? ouHandle(managerRow) : null;
    const newManagerName = managerRow?.userName ?? null;

    await this.orgRepository.setLeft(rowIds, { leftAt: now, leftSource: 'manual', updatedAt: now });
    await this.orgRepository.reparentChildren(childRowIds, newManagerHandle, newManagerName, now, requester.userId);

    return { user_id: target.userId, left: true, reparented: childRowIds.length };
  }
```

- [ ] **Step 6: 加 controller 端点**（`org.controller.ts`，import `SetLeftDto` 后加）

```typescript
  /**
   * PATCH /api/v1/org/users/:user_id/left
   * 手动标记/撤销离职（人工，同步不复活；标记时自动上并下属）。仅白名单。
   */
  @Patch('users/:user_id/left')
  setLeft(
    @CurrentUser() user: CurrentUserPayload,
    @Param('user_id') targetUserId: string,
    @Body() dto: SetLeftDto,
  ) {
    return this.orgService.setLeft({ userId: user.user_id, openId: user.open_id }, targetUserId, dto.left);
  }
```

（文件顶部加 `import { SetLeftDto } from './dto/set-left.dto';`）

- [ ] **Step 7: 运行测试确认通过 + 全量 API 回归**

Run: `cd apps/api && pnpm exec vitest run`
Expected: 全 PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/org/
git commit -m "feat(api): PATCH /org/users/:uid/left 手动离职标记 + 自动上并下属"
```

---

## Task 4: API — /org/tree 附业务线分组

**Files:**
- Create: `apps/api/src/modules/org/org-business-line.ts`
- Modify: `apps/api/src/modules/org/org.service.ts`（`OrgTreeNode` 加字段 + getTree 计算）
- Test: `apps/api/src/modules/org/org.service.spec.ts`

**Interfaces:**
- Produces:
  - `resolveBusinessLine(row, lookup): 'xt' | 'dfw' | 'ungrouped'`（沿 manager 链爬到顶端，按配置分类）
  - `OrgTreeNode.business_line: 'xt' | 'dfw' | 'ungrouped'`

- [ ] **Step 1: 写业务线配置 + 解析** `org-business-line.ts`

```typescript
// 顶端负责人句柄 → 业务线。数据无公司/部门字段，按汇报链顶端归类。
// 2026-07-23：Tobi=虾条(2 账号)；孔德俊/祁雁飞=曙条。加新公司改此表一行。
const ROOT_TO_LINE: Record<string, 'xt' | 'dfw'> = {
  '2d2adg26': 'xt',
  ou_243a9225acc248c148c25f8fe0699407: 'xt', // Tobi
  ou_da7e2a5ae070ceb2b247569aa8acdf87: 'dfw', // 孔德俊
  ou_b23684cac81e32b5631dfcee7dbe4e27: 'dfw', // 祁雁飞
};

/** 沿 manager 链向上爬到顶端，返回顶端句柄对应业务线；爬不到已知顶端 → 'ungrouped' */
export function resolveBusinessLine(
  row: any,
  lookup: Map<string, any>,
  ouHandle: (r: any) => string,
): 'xt' | 'dfw' | 'ungrouped' {
  const seen = new Set<number>();
  let cursor: any = row;
  while (cursor) {
    if (seen.has(cursor.id)) break; // 防环
    seen.add(cursor.id);
    const line = ROOT_TO_LINE[ouHandle(cursor)];
    if (line) return line;
    const mid = cursor.managerUserId;
    if (!mid || mid === cursor.userId) break; // 到顶
    cursor = lookup.get(mid);
  }
  return 'ungrouped';
}
```

- [ ] **Step 2: 写失败测试**（`org.service.spec.ts`）

```typescript
describe('OrgService.getTree business_line', () => {
  it('Tobi 子树=xt，祁雁飞子树=dfw，断链=ungrouped', async () => {
    const rows = [
      { id: 1, userId: '2d2adg26', openId: null, userName: 'Tobi', managerUserId: null },
      { id: 2, userId: 'ou_a', openId: 'ou_a', userName: 'A', managerUserId: '2d2adg26' },
      { id: 3, userId: 'ou_b23684cac81e32b5631dfcee7dbe4e27', openId: 'ou_b23684cac81e32b5631dfcee7dbe4e27', userName: '祁雁飞', managerUserId: null },
      { id: 4, userId: 'ou_c', openId: 'ou_c', userName: 'C', managerUserId: 'ou_b23684cac81e32b5631dfcee7dbe4e27' },
      { id: 5, userId: 'ou_orphan', openId: 'ou_orphan', userName: 'Orphan', managerUserId: 'ou_missing' },
    ];
    const { service } = makeOrgService({ rows, admin: true });
    const res = await service.getTree({ userId: 'ou_dev_harvey', openId: 'ou_dev_harvey' });
    const byId = Object.fromEntries(res.users.map((u) => [u.user_id, u.business_line]));
    expect(byId['ou_a']).toBe('xt');
    expect(byId['ou_c']).toBe('dfw');
    expect(byId['ou_orphan']).toBe('ungrouped');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/org/org.service.spec.ts -t business_line`
Expected: FAIL（`business_line` 不存在）

- [ ] **Step 4: 改 OrgTreeNode 类型 + getTree**（`org.service.ts`）

`OrgTreeNode` 接口加一行：

```typescript
  hidden_at: string | null;
  business_line: 'xt' | 'dfw' | 'ungrouped';
```

文件顶部 import：`import { resolveBusinessLine } from './org-business-line';`

`getTree` 里构造 `users` 前先建 lookup，并在每个节点对象补字段：

```typescript
    const lookup = buildLookup(rows as any[]);
    const users: OrgTreeNode[] = visibleRows.map((r: any) => {
      if (r.managerSource === 'feishu' && r.managerUpdatedAt) {
        if (!lastSync || r.managerUpdatedAt > lastSync) lastSync = r.managerUpdatedAt;
      }
      return {
        user_id: r.userId,
        open_id: r.openId ?? null,
        user_name: r.userName ?? null,
        manager_user_id: r.managerUserId ?? null,
        manager_name: r.managerName ?? null,
        manager_source: r.managerSource ?? 'feishu',
        current_grade: r.currentGrade ?? null,
        left_at: r.leftAt ? new Date(r.leftAt).toISOString() : null,
        hidden_at: r.hiddenAt ? new Date(r.hiddenAt).toISOString() : null,
        business_line: resolveBusinessLine(r, lookup, ouHandle),
      };
    });
```

- [ ] **Step 5: 运行确认通过 + 全量 API 回归**

Run: `cd apps/api && pnpm exec vitest run`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/org/org-business-line.ts apps/api/src/modules/org/org.service.ts apps/api/src/modules/org/org.service.spec.ts
git commit -m "feat(api): /org/tree 按汇报链顶端附业务线分组 (xt/dfw/ungrouped)"
```

---

## Task 5: Web — 标记离职/撤销离职按钮

**Files:**
- Modify: `apps/web/src/hooks/use-org-tree.ts`（加 `setLeft` + 类型加 `business_line`）
- Modify: `apps/web/src/app/org/org-node-card.tsx`（加按钮 + `OrgNodeActions.onSetLeft`）
- Modify: `apps/web/src/app/org/org-canvas.tsx`（透传 `onSetLeft`）
- Modify: `apps/web/src/app/org/page.tsx`（wire `onSetLeft`）
- Modify: `apps/web/src/app/org/org-layout.ts`（`OrgUser` 加 `business_line?`）

**Interfaces:**
- Consumes: 现有 `OrgNodeActions`、`run()`、`apiFetch`。
- Produces: `setLeft(userId, left): Promise<void>`；`OrgNodeActions.onSetLeft`。

- [ ] **Step 1: hook 加 setLeft + 类型**（`use-org-tree.ts`）

`OrgTreeUser` 接口加：`readonly business_line?: 'xt' | 'dfw' | 'ungrouped';`
文件末尾加：

```typescript
export async function setLeft(userId: string, left: boolean): Promise<void> {
  await apiFetch(`/api/v1/org/users/${encodeURIComponent(userId)}/left`, {
    method: 'PATCH',
    body: JSON.stringify({ left }),
  });
}
```

`org-layout.ts` 的 `OrgUser` 接口加：`business_line?: 'xt' | 'dfw' | 'ungrouped';`

- [ ] **Step 2: 节点卡加按钮**（`org-node-card.tsx`）

`OrgNodeActions` 接口加：`onSetLeft: (userId: string, left: boolean) => void;`
import 图标：`import { ChevronDown, ChevronRight, RotateCcw, EyeOff, Eye, Unlink, UserMinus, UserPlus } from 'lucide-react';`
在「设为根节点」按钮块之后、展开按钮之前插入：

```tsx
      {actions.canEdit && (
        <button
          type="button"
          onClick={() => actions.onSetLeft(u.user_id, !isLeft)}
          className="nodrag shrink-0 rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={isLeft ? '撤销离职（人回到组织图）' : '标记离职（人走了，不参与绩效；同步不会复活）'}
        >
          {isLeft ? <UserPlus className="size-3" /> : <UserMinus className="size-3" />}
        </button>
      )}
```

> 注：现有 hide/reset/setRoot 按钮都带 `!isLeft` 条件（离职后隐藏）。「撤销离职」按钮须在 `isLeft` 时也可见——故上面块不加 `!isLeft`，用 `isLeft ? 撤销 : 标记` 切换。

- [ ] **Step 3: canvas 透传**（`org-canvas.tsx`）

在 `OrgCanvas` props 类型加 `onSetLeft: (userId: string, left: boolean) => void;`，并在组装 `actions`（注入 `node.data.__actions` 的 useMemo）处加 `onSetLeft`（与现有 `onSetHidden` 并列一行）。

- [ ] **Step 4: page 接线**（`page.tsx`）

import 加 `setLeft`：`import { useOrgTree, setManager, resetManagerToFeishu, setHidden, setLeft } from '@/hooks/use-org-tree';`
`<OrgCanvas>` 加 prop：

```tsx
          onSetLeft={(uid, left) => run(() => setLeft(uid, left))}
```

- [ ] **Step 5: 截图审计（QC#2）**

Run（本地 dev 栈已起）：`cd apps/web && pnpm e2e:screenshot`
然后 Read `screenshots/<timestamp>/org.png`，确认节点卡出现「标记离职/撤销离职」按钮、离职节点显示撤销态。交付报告写明已核对。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/use-org-tree.ts apps/web/src/app/org/
git commit -m "feat(web): 组织图节点加标记离职/撤销离职按钮"
```

---

## Task 6: Web — 业务线标签过滤（虾条/曙条/未分组）

**Files:**
- Modify: `apps/web/src/app/org/page.tsx`

**Interfaces:**
- Consumes: `data.users[].business_line`（Task 4）、既有 `OrgCanvas`。

- [ ] **Step 1: page 加标签状态 + 过滤**（`page.tsx`）

`useState` 区加：

```tsx
  const [line, setLine] = useState<'xt' | 'dfw' | 'ungrouped'>('xt');
```

`const users = ...` 之后按业务线过滤，并算各标签计数：

```tsx
  const allUsers = (data?.users ?? []) as OrgUser[];
  const countBy = (l: string) => allUsers.filter((u) => (u.business_line ?? 'ungrouped') === l).length;
  const users = allUsers.filter((u) => (u.business_line ?? 'ungrouped') === line);
```

（把原第 62 行 `users.length > 0` 分支内 `<OrgCanvas users={users} ...>` 的 `users` 保持为过滤后的 `users`。空态判断改用 `allUsers.length`。）

- [ ] **Step 2: 加标签栏 UI**（标题块之后、错误提示之前插入）

```tsx
      <div className="mb-3 flex gap-1">
        {([['xt','虾条'],['dfw','曙条'],['ungrouped','未分组']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setLine(key)}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              line === key
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label} ({countBy(key)})
          </button>
        ))}
      </div>
```

- [ ] **Step 3: 截图审计（QC#2）**

Run：`cd apps/web && pnpm e2e:screenshot` → Read `screenshots/<timestamp>/org.png`，确认三标签渲染、切换过滤正确、各计数与预期（虾条 49 / 曙条 29 / 未分组 0，dev 种子下数字不同但结构正确）。报告写明已核对。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/org/page.tsx
git commit -m "feat(web): /org 按业务线拆虾条/曙条/未分组标签"
```

---

## Self-Review 结论（已核）

- **Spec 覆盖**：粘性离职(Task 1+2)、离职按钮+上并(Task 3+5)、业务线分图(Task 4+6)、Albern（已在生产处理，无需任务）—— 全覆盖。
- **占位符**：无。每步含真实代码/命令/预期。
- **类型一致**：`setLeft`/`setLeft`(repo)/`reparentChildren`/`business_line`/`resolveBusinessLine` 跨任务签名一致；`left_source` 取值 `'manual'|'feishu'|null` 全程一致；worker 复活清 `leftSource:null`、自动标写 `'feishu'`、人工写 `'manual'` 一致。

## 部署（实现完成后，单独执行，非本计划任务步骤）

1. `db`：`tsc -p tsconfig.build.json` → rsync `db/dist`；apply `0024`（先备份 `leader-sync-postgres-1`）。
2. `worker`：rsync 源码（tsx 直跑）→ `systemctl restart leader-worker`。
3. `api`：`nest build` → rsync `apps/api/dist` → 按端口 `fuser 3001/tcp` 杀 + `setsid --fork` 重启。
4. `web`：`pnpm build` → rsync `.next` → 按端口 `fuser 3000/tcp` 重启。
5. 冒烟：`/org/tree` 200 带 business_line；`PATCH /left` 无 token 401；三标签截图。
6. Albern：清其 `hidden_at` 保险、置 `left_source='manual'`（同步不再能复活）。
