# 组织架构离职/隐藏生命周期 + 交互式画布树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 org_cache 引入"离职/隐藏"生命周期，飞书同步自动判定离职并全局隐藏离职/隐藏人员，同时把 `/org` 页从 CSS 树重写为可缩放平移的交互式画布。

**Architecture:** org_cache 加 3 列（`left_at`/`hidden_at`/`hidden_by`），不物理删除。worker 同步作业用"本次枚举到的在职集合"做差集自动标离职（带 50% 安全阀 + 复职自愈）。三个人员目录出口（组织树 / 人员搜索 / 打分花名册）过滤在册；历史任务/打分记录不动。前端用 `@xyflow/react` + `d3-hierarchy` 重写组织架构画布。

**Tech Stack:** PostgreSQL + Drizzle ORM · NestJS(vitest) · worker(tsx+vitest) · Next.js 15 + React 19 + `@xyflow/react` v12 + `d3-hierarchy` v3

## Global Constraints

- **spec 主权**：`docs/superpowers/specs/2026-07-17-org-member-lifecycle-and-canvas-tree-design.md`。任何与 spec 冲突先停下报告，不静默改。
- **在册口径（canonical）**：`left_at IS NULL AND hidden_at IS NULL`。
- **不物理删除**：离职/隐藏只打标记；历史任务、打分记录、org_cache 行全部保留。
- **不可变**：纯函数返回新对象/新数组，不原地改入参。
- **TDD 铁律**：先写测试看到 RED，再写实现看到 GREEN，严禁未见 RED 就改业务逻辑。
- **db schema 改动必 rebuild**：改 `db/src/schema/*` 后必须 `pnpm --filter @leader-sync/db build`，否则 API/worker 运行时引用旧 dist。
- **错误码**（`packages/shared-types/src/api.ts`，已存在，勿改值）：`UNAUTHORIZED=1002`、`ORG_USER_NOT_FOUND=1016`、`ORG_INVALID_MANAGER=1017`。
- **组织编辑白名单**：沿用 `org.service.ts` 的 `ORG_STRUCTURE_ADMINS`（Harvey `ou_1c419560953e219d5876918a2b934dfb` / 杨平 `ou_5a06e17c2ec88a72a2ef4ce040b3d77d` / dev `ou_dev_harvey`）。
- **安全阀阈值常量**：`LEAVE_SAFETY_MIN_RATIO = 0.5`。
- **提交规范**：`<type>: <desc>`（feat/fix/test/docs/refactor/chore），无 attribution 尾注（全局关闭）。
- **命令目录**：所有命令在仓库根 `/Users/harvey/Documents/AI-APP/task-manger/leader-sync` 下执行。

---

## File Structure

**新建：**
- `db/migrations/0023_org_member_lifecycle.sql` — 加 3 列
- `apps/api/src/modules/org/dto/set-hidden.dto.ts` — 隐藏开关 DTO
- `apps/web/src/app/org/org-layout.ts` — 纯函数：去重 + 森林 + d3 布局 → React Flow nodes/edges
- `apps/web/src/app/org/org-node-card.tsx` — React Flow 自定义节点卡片
- `apps/web/src/app/org/org-canvas.tsx` — React Flow 画布容器
- `apps/web/src/app/org/__tests__/org-layout.spec.ts` — 布局纯函数单测
- `apps/web/e2e/org-canvas-audit.spec.ts` — 截图审计

**修改：**
- `db/src/schema/org-cache.ts` — 加 `leftAt`/`hiddenAt`/`hiddenBy`
- `apps/worker/src/jobs/sync-org-hierarchy.ts` — 离职判定 + 安全阀 + result 字段
- `apps/worker/src/jobs/__tests__/sync-org-hierarchy.spec.ts` — 更新 1 例 + 新增 5 例
- `apps/worker/src/jobs/score-window.ts` — 花名册滤离职/隐藏
- `apps/api/src/modules/org/org.repository.ts` — `setHidden`
- `apps/api/src/modules/org/org.service.ts` — getTree 过滤 + `setHidden` + OrgTreeNode 加字段
- `apps/api/src/modules/org/org.controller.ts` — `include_hidden` query + PATCH hidden
- `apps/api/src/modules/org/org.service.spec.ts` — 新增用例
- `apps/api/src/modules/user/user.controller.ts` — 搜索滤离职/隐藏
- `apps/web/src/app/org/page.tsx` — 重写为画布壳
- `apps/web/package.json` — 加依赖
- `docs/02-data/field-dictionary.md`、`docs/02-data/enum-dictionary.md`、`docs/04-process/state-machine.md`、`docs/05-permissions/permission-matrix.md`、`docs/03-sync/*` — 文档联动

---

## Task 1: DB 迁移 + schema 三列

**Files:**
- Create: `db/migrations/0023_org_member_lifecycle.sql`
- Modify: `db/src/schema/org-cache.ts:33`（在 `updatedAt` 前加三列）

**Interfaces:**
- Produces: `orgCache.leftAt: Date | null`、`orgCache.hiddenAt: Date | null`、`orgCache.hiddenBy: string | null`（Drizzle timestamp/varchar 列，供 Task 2/3/4/5/6 读写）。

- [ ] **Step 1: 写迁移 SQL**

Create `db/migrations/0023_org_member_lifecycle.sql`:

```sql
-- 0023: org_cache 成员生命周期（离职/隐藏），不物理删除
-- left_at: 飞书同步自动判定离职（NULL=在职）
-- hidden_at / hidden_by: 管理员手动隐藏（在职但不入目录，如豁免/双账号）
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE org_cache ADD COLUMN IF NOT EXISTS hidden_by varchar(128);

-- 在册查询高频（组织树/人员搜索/花名册）：部分索引覆盖在册行
CREATE INDEX IF NOT EXISTS idx_org_cache_active
  ON org_cache (id) WHERE left_at IS NULL AND hidden_at IS NULL;
```

- [ ] **Step 2: 改 Drizzle schema**

In `db/src/schema/org-cache.ts`, 在 `currentGrade` 行之后、`updatedAt` 之前插入：

```ts
  // 成员生命周期（migration 0023）——不物理删除，仅打标记
  // left_at: 飞书同步自动判定离职（NULL=在职）；sync-engine 之外由 sync-org-hierarchy 写
  leftAt: timestamp('left_at', { withTimezone: true }),
  // hidden_at / hidden_by: 管理员手动隐藏（在职但不入目录）
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenBy: varchar('hidden_by', { length: 128 }),
```

- [ ] **Step 3: build db 包并验证类型导出**

Run: `pnpm --filter @leader-sync/db build`
Expected: 构建成功，无 TS 错误。

- [ ] **Step 4: 验证 schema 列名**

Run: `grep -n "leftAt\|hiddenAt\|hiddenBy" db/dist/schema/org-cache.js`
Expected: 三个字段都出现在编译产物里（`left_at`/`hidden_at`/`hidden_by`）。

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0023_org_member_lifecycle.sql db/src/schema/org-cache.ts
git commit -m "feat(db): org_cache 加离职/隐藏生命周期列 (migration 0023)"
```

---

## Task 2: worker 离职自动判定 + 安全阀

**Files:**
- Modify: `apps/worker/src/jobs/sync-org-hierarchy.ts`（顶部加常量；`OrgSyncResult` 加字段；`runSyncOrgHierarchy` 写入循环后加离职判定）
- Test: `apps/worker/src/jobs/__tests__/sync-org-hierarchy.spec.ts`

**Interfaces:**
- Consumes: `orgCache.leftAt`（Task 1）；现有 `fetched: Map<string, ContactUser>`（在职集合）、`orgRows: any[]`、`ouHandle(row)`、`now`、`dryRun`、`db`。
- Produces: `OrgSyncResult` 新增 `markedLeft: number`、`revived: number`、`safetyValveTriggered: boolean`。

- [ ] **Step 1: 写失败测试（更新 1 例 + 新增 5 例）**

在 `apps/worker/src/jobs/__tests__/sync-org-hierarchy.spec.ts` 中，**替换**现有 `it('飞书查不到的用户（离职等）跳过并计数，不中断整体', ...)` 整个块为：

```ts
  it('飞书查不到的用户（离职等）：计入 notFound 且自动标离职', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerSource: 'feishu' },
        { id: 2, userId: 'ou_gone', openId: 'ou_gone', userName: 'Gone', managerSource: 'feishu' },
      ],
    });
    const contact = makeContact({ ou_alice: { name: 'Alice', leaderOpenId: '' } });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.notFound).toBe(1);
    expect(r.updated).toBe(1); // alice 的 manager 写入
    expect(r.markedLeft).toBe(1); // gone 被标离职
    const goneLeft = updates.find((u) => u.vals.leftAt != null && u.vals.leftAt !== undefined);
    expect(goneLeft).toBeDefined();
  });
```

在 `describe` 块末尾（最后一个 `it` 之后、`});` 之前）**新增**：

```ts
  it('离职判定：不在通讯录枚举内的在册行被标 left_at', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_a', openId: 'ou_a', userName: 'A', managerSource: 'feishu' },
        { id: 2, userId: 'ou_b', openId: 'ou_b', userName: 'B', managerSource: 'feishu' },
        { id: 3, userId: 'ou_gone', openId: 'ou_gone', userName: 'Gone', managerSource: 'feishu' },
      ],
    });
    const contact = makeContact({
      ou_a: { name: 'A', leaderOpenId: '' },
      ou_b: { name: 'B', leaderOpenId: '' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.safetyValveTriggered).toBe(false);
    expect(r.markedLeft).toBe(1);
    const goneLeft = updates.find((u) => u.vals.leftAt != null);
    expect(goneLeft).toBeDefined();
  });

  it('复职自愈：已标离职但本次通讯录又出现 → 清 left_at', async () => {
    const oldLeft = new Date('2026-01-01T00:00:00.000Z');
    const { db, updates } = makeDb({
      orgRows: [{ id: 1, userId: 'ou_back', openId: 'ou_back', userName: 'Back', managerSource: 'feishu', leftAt: oldLeft }],
    });
    const contact = makeContact({ ou_back: { name: 'Back', leaderOpenId: '' } });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.revived).toBe(1);
    const revived = updates.find((u) => u.vals.leftAt === null);
    expect(revived).toBeDefined();
  });

  it('安全阀：通讯录枚举数 < 在册行数一半 → 跳过离职判定，不误标', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_a', openId: 'ou_a', userName: 'A', managerSource: 'feishu' },
        { id: 2, userId: 'ou_b', openId: 'ou_b', userName: 'B', managerSource: 'feishu' },
        { id: 3, userId: 'ou_c', openId: 'ou_c', userName: 'C', managerSource: 'feishu' },
        { id: 4, userId: 'ou_d', openId: 'ou_d', userName: 'D', managerSource: 'feishu' },
      ],
    });
    // 通讯录只枚举到 1 人（模拟飞书 API 半途故障）
    const contact = makeContact({ ou_a: { name: 'A', leaderOpenId: '' } });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.safetyValveTriggered).toBe(true);
    expect(r.markedLeft).toBe(0);
    expect(updates.some((u) => u.vals.leftAt != null)).toBe(false);
  });

  it('幂等：已离职且仍不在通讯录 → 不重复写 left_at', async () => {
    const oldLeft = new Date('2026-01-01T00:00:00.000Z');
    const { db, updates } = makeDb({
      orgRows: [{ id: 1, userId: 'ou_gone', openId: 'ou_gone', userName: 'Gone', managerSource: 'feishu', leftAt: oldLeft }],
    });
    const contact = makeContact({}); // 空通讯录

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.markedLeft).toBe(0);
    expect(r.revived).toBe(0);
    expect(updates.some((u) => 'leftAt' in u.vals)).toBe(false);
  });

  it('双命名空间：同一人两行都被标离职', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_a', openId: 'ou_a', userName: 'A', managerSource: 'feishu' },
        { id: 2, userId: 'ou_b', openId: 'ou_b', userName: 'B', managerSource: 'feishu' },
        { id: 3, userId: 'ou_zhang', openId: 'ou_zhang', userName: '张三', managerSource: 'feishu' },
        { id: 4, userId: 'emp_zhang', openId: 'ou_zhang', userName: '张三', managerSource: 'feishu' },
      ],
    });
    const contact = makeContact({
      ou_a: { name: 'A', leaderOpenId: '' },
      ou_b: { name: 'B', leaderOpenId: '' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.safetyValveTriggered).toBe(false);
    expect(r.markedLeft).toBe(2); // 张三两行都标
    expect(updates.filter((u) => u.vals.leftAt != null)).toHaveLength(2);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @leader-sync/worker vitest run src/jobs/__tests__/sync-org-hierarchy.spec.ts`
Expected: FAIL —— `markedLeft`/`revived`/`safetyValveTriggered` 未定义（现 result 无这些字段）。

- [ ] **Step 3: 加常量 + result 字段**

In `apps/worker/src/jobs/sync-org-hierarchy.ts`，在 `import` 之后（约 line 22 之后）加常量：

```ts
/** 安全阀：本次通讯录枚举数不足在册行数此比例 → 判定飞书 API 故障，跳过离职判定 */
const LEAVE_SAFETY_MIN_RATIO = 0.5;
```

在 `OrgSyncResult` interface（约 line 154）末尾（`dryRun: boolean;` 之前）加：

```ts
  /** 本次新标离职的行数 */
  markedLeft: number;
  /** 本次自愈复职（清 left_at）的行数 */
  revived: number;
  /** 安全阀触发（枚举数过低，跳过离职判定） */
  safetyValveTriggered: boolean;
```

在 `result` 初始化对象（约 line 180）里，`dryRun,` 之前加：

```ts
    markedLeft: 0,
    revived: 0,
    safetyValveTriggered: false,
```

- [ ] **Step 4: 加离职判定逻辑**

In `apps/worker/src/jobs/sync-org-hierarchy.ts`，在写入循环结束后（`for (const [ou, u] of fetched) { ... }` 闭合之后，`console.log(...)` 之前）插入：

```ts
  // 4. 离职判定：fetched 即本次通讯录枚举到的在职集合，做差集。
  //    安全阀：枚举数不足在册可解析行数一半 → 判定飞书 API 故障，跳过标记，防误判全员离职。
  const activeHandles = new Set<string>(fetched.keys());
  const resolvable = orgRows.filter((r) => ouHandle(r) !== null);
  const resolvableActive = resolvable.filter((r) => r.leftAt == null);
  if (fetched.size < resolvableActive.length * LEAVE_SAFETY_MIN_RATIO) {
    result.safetyValveTriggered = true;
    console.warn(
      `  [sync-org] SAFETY VALVE: directory=${fetched.size} < ${LEAVE_SAFETY_MIN_RATIO} * active=${resolvableActive.length} → 跳过离职判定`,
    );
  } else {
    for (const row of resolvable) {
      const h = ouHandle(row)!;
      const isActive = activeHandles.has(h);
      if (isActive && row.leftAt != null) {
        if (!dryRun) await db.update(orgCache).set({ leftAt: null, updatedAt: now }).where(eq(orgCache.id, row.id));
        result.revived++;
      } else if (!isActive && row.leftAt == null) {
        if (!dryRun) await db.update(orgCache).set({ leftAt: now, updatedAt: now }).where(eq(orgCache.id, row.id));
        result.markedLeft++;
      }
    }
  }
```

在 `console.log(...)` 那行的模板字符串里，`${dryRun ? ' [DRY-RUN]' : ''}` 之前追加离职计数：

```ts
      `manual-skipped=${result.skippedManual} not-found=${result.notFound} no-open-id=${result.noOpenId} ` +
      `marked-left=${result.markedLeft} revived=${result.revived} safety-valve=${result.safetyValveTriggered}` +
```

（替换原本 `no-open-id=${result.noOpenId}` 结尾那段，把新计数拼进去。）

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @leader-sync/worker vitest run src/jobs/__tests__/sync-org-hierarchy.spec.ts`
Expected: PASS，全部用例绿。

- [ ] **Step 6: 全量 worker 测试回归**

Run: `pnpm --filter @leader-sync/worker vitest run`
Expected: 全绿（既有用例不受影响）。

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/jobs/sync-org-hierarchy.ts apps/worker/src/jobs/__tests__/sync-org-hierarchy.spec.ts
git commit -m "feat(worker): 通讯录同步自动判定离职 + 复职自愈 + 安全阀"
```

---

## Task 3: API 组织树过滤离职/隐藏 + include_hidden

**Files:**
- Modify: `apps/api/src/modules/org/org.service.ts`（`OrgTreeNode` 加字段；`getTree` 加 `includeHidden` 参数 + 过滤 + hidden_count）
- Modify: `apps/api/src/modules/org/org.controller.ts:16-19`（getTree 加 `@Query('include_hidden')`）
- Test: `apps/api/src/modules/org/org.service.spec.ts`

**Interfaces:**
- Consumes: `orgCache.leftAt`/`hiddenAt`（Task 1）；现有 `OrgRepository.listAll()`（返回全部行，不过滤）、`buildLookup`、`ouHandle`、`canEditOrg`。
- Produces: `getTree(requester, includeHidden?: boolean)` 返回 `{ users, last_feishu_sync_at, can_edit, hidden_count }`；`OrgTreeNode` 新增 `left_at: string | null`、`hidden_at: string | null`。

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/modules/org/org.service.spec.ts` 里找到 getTree 相关 describe（若无则在文件末尾 `describe('OrgService', ...)` 内）新增。先确认现有 mock repo 的 `listAll` 返回结构，然后加：

```ts
  describe('getTree 离职/隐藏过滤', () => {
    const rows = [
      { id: 1, userId: 'ou_a', openId: 'ou_a', userName: 'A', managerSource: 'feishu', leftAt: null, hiddenAt: null },
      { id: 2, userId: 'ou_left', openId: 'ou_left', userName: 'Left', managerSource: 'feishu', leftAt: new Date(), hiddenAt: null },
      { id: 3, userId: 'ou_hidden', openId: 'ou_hidden', userName: 'Hidden', managerSource: 'feishu', leftAt: null, hiddenAt: new Date() },
    ];
    const makeService = () => {
      const repo = { listAll: vi.fn(async () => rows) } as any;
      return new OrgService(repo);
    };
    const admin = { userId: 'ou_dev_harvey', openId: 'ou_dev_harvey' };
    const plain = { userId: 'ou_a', openId: 'ou_a' };

    it('默认只返回在册（滤离职+隐藏）', async () => {
      const svc = makeService();
      const res = await svc.getTree(plain);
      expect(res.users.map((u) => u.user_id)).toEqual(['ou_a']);
      expect(res.hidden_count).toBe(1); // 手动隐藏 1 人（离职不算 hidden_count）
    });

    it('管理员 include_hidden=true 返回全部并带 left_at/hidden_at', async () => {
      const svc = makeService();
      const res = await svc.getTree(admin, true);
      expect(res.users.map((u) => u.user_id).sort()).toEqual(['ou_a', 'ou_hidden', 'ou_left']);
      const hidden = res.users.find((u) => u.user_id === 'ou_hidden');
      expect(hidden!.hidden_at).not.toBeNull();
    });

    it('非管理员传 include_hidden=true 仍只拿在册（防越权）', async () => {
      const svc = makeService();
      const res = await svc.getTree(plain, true);
      expect(res.users.map((u) => u.user_id)).toEqual(['ou_a']);
    });
  });
```

（若 spec 文件顶部未 import `vi`，补 `import { describe, it, expect, vi } from 'vitest';`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @leader-sync/api vitest run src/modules/org/org.service.spec.ts`
Expected: FAIL —— `getTree` 不接受第二参数 / 返回无 `hidden_count`。

- [ ] **Step 3: 改 OrgTreeNode + getTree**

In `apps/api/src/modules/org/org.service.ts`，`OrgTreeNode` interface（line 24-32）末尾加：

```ts
  left_at: string | null;
  hidden_at: string | null;
```

替换 `getTree` 方法（line 54-81）为：

```ts
  /** 组织树数据。默认只返回在册；管理员传 includeHidden 可见离职/隐藏。任意登录可读。 */
  async getTree(
    requester: OrgRequester,
    includeHidden = false,
  ): Promise<{
    users: OrgTreeNode[];
    last_feishu_sync_at: string | null;
    can_edit: boolean;
    hidden_count: number;
  }> {
    const rows = await this.orgRepository.listAll();
    const effectiveIncludeHidden = includeHidden && canEditOrg(requester);

    // 手动隐藏人数（按句柄去重，供前端「显示已隐藏 (N)」徽章；离职不计入）
    const hiddenHandles = new Set<string>();
    for (const r of rows as any[]) {
      if (r.hiddenAt) hiddenHandles.add(ouHandle(r));
    }

    let lastSync: Date | null = null;
    const visibleRows = (rows as any[]).filter((r) =>
      effectiveIncludeHidden ? true : !r.leftAt && !r.hiddenAt,
    );
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
      };
    });

    return {
      users,
      last_feishu_sync_at: lastSync ? (lastSync as Date).toISOString() : null,
      can_edit: canEditOrg(requester),
      hidden_count: hiddenHandles.size,
    };
  }
```

- [ ] **Step 4: 改 controller getTree**

In `apps/api/src/modules/org/org.controller.ts`，第 1 行 import 加 `Query`（已有 `Get, Patch, Post, Param, Body, UseGuards`，追加 `Query`），替换 getTree（line 16-19）：

```ts
  @Get('tree')
  getTree(@CurrentUser() user: CurrentUserPayload, @Query('include_hidden') includeHidden?: string) {
    return this.orgService.getTree(
      { userId: user.user_id, openId: user.open_id },
      includeHidden === '1',
    );
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @leader-sync/api vitest run src/modules/org/org.service.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/org/org.service.ts apps/api/src/modules/org/org.controller.ts apps/api/src/modules/org/org.service.spec.ts
git commit -m "feat(api): 组织树默认滤离职/隐藏，管理员 include_hidden 可见"
```

---

## Task 4: API 手动隐藏端点

**Files:**
- Create: `apps/api/src/modules/org/dto/set-hidden.dto.ts`
- Modify: `apps/api/src/modules/org/org.repository.ts`（加 `setHidden`）
- Modify: `apps/api/src/modules/org/org.service.ts`（加 `setHidden`）
- Modify: `apps/api/src/modules/org/org.controller.ts`（加 PATCH hidden）
- Test: `apps/api/src/modules/org/org.service.spec.ts`

**Interfaces:**
- Consumes: `OrgRepository.listAll()`、`buildLookup`、`ouHandle`、`assertOrgAdmin`（Task 3 之后）、错误码 `ORG_USER_NOT_FOUND`。
- Produces: `OrgRepository.setHidden(rowIds: number[], values: { hiddenAt: Date | null; hiddenBy: string | null; updatedAt: Date }): Promise<void>`；`OrgService.setHidden(requester, targetUserId, hidden: boolean): Promise<{ user_id: string; hidden: boolean }>`；端点 `PATCH /api/v1/org/users/:user_id/hidden`。

- [ ] **Step 1: 写失败测试**

在 `org.service.spec.ts` 新增：

```ts
  describe('setHidden 手动隐藏', () => {
    const admin = { userId: 'ou_dev_harvey', openId: 'ou_dev_harvey' };
    const plain = { userId: 'ou_a', openId: 'ou_a' };
    // Albern 式双账号：同一 open_id 两行
    const rows = [
      { id: 10, userId: 'ou_albern', openId: 'ou_albern', userName: 'Albern', managerSource: 'feishu' },
      { id: 11, userId: 'emp_albern', openId: 'ou_albern', userName: 'Albern', managerSource: 'feishu' },
    ];
    const makeService = () => {
      const setHidden = vi.fn(async () => {});
      const repo = { listAll: vi.fn(async () => rows), setHidden } as any;
      return { svc: new OrgService(repo), setHidden };
    };

    it('非白名单 → 抛 UNAUTHORIZED(403)', async () => {
      const { svc } = makeService();
      await expect(svc.setHidden(plain, 'ou_albern', true)).rejects.toMatchObject({ code: 1002 });
    });

    it('隐藏：写 hidden_at/hidden_by，按句柄连带双行', async () => {
      const { svc, setHidden } = makeService();
      const res = await svc.setHidden(admin, 'ou_albern', true);
      expect(res).toEqual({ user_id: 'ou_albern', hidden: true });
      const [rowIds, values] = setHidden.mock.calls[0];
      expect(rowIds.sort()).toEqual([10, 11]);
      expect(values.hiddenAt).toBeInstanceOf(Date);
      expect(values.hiddenBy).toBe('ou_dev_harvey');
    });

    it('取消隐藏：清 hidden_at/hidden_by', async () => {
      const { svc, setHidden } = makeService();
      await svc.setHidden(admin, 'ou_albern', false);
      const [, values] = setHidden.mock.calls[0];
      expect(values.hiddenAt).toBeNull();
      expect(values.hiddenBy).toBeNull();
    });

    it('目标不存在 → ORG_USER_NOT_FOUND(404)', async () => {
      const { svc } = makeService();
      await expect(svc.setHidden(admin, 'ou_ghost', true)).rejects.toMatchObject({ code: 1016 });
    });
  });
```

（`BusinessException` 需暴露 `code`——现有 setManager 测试若已断言 code 即沿用同 pattern；否则改断言为 `.rejects.toThrow()` 并单独断言 HttpStatus。先看现有 spec 里 setManager 越权用例怎么断言，保持一致。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @leader-sync/api vitest run src/modules/org/org.service.spec.ts`
Expected: FAIL —— `svc.setHidden` 不存在。

- [ ] **Step 3: 加 DTO**

Create `apps/api/src/modules/org/dto/set-hidden.dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

export class SetHiddenDto {
  /** true=隐藏（在职但不入目录） | false=取消隐藏 */
  @IsBoolean()
  hidden!: boolean;
}
```

- [ ] **Step 4: 加 repository.setHidden**

In `apps/api/src/modules/org/org.repository.ts`，第 5 行 import 从 `import { eq } from 'drizzle-orm';` 改为 `import { eq, inArray } from 'drizzle-orm';`，在 `setManagerSource` 之后加：

```ts
  /** 按行 id 批量写隐藏标记（同句柄多行连带，值由 service 仲裁好） */
  async setHidden(
    rowIds: number[],
    values: { hiddenAt: Date | null; hiddenBy: string | null; updatedAt: Date },
  ): Promise<void> {
    if (rowIds.length === 0) return;
    await this.db
      .update(orgCache)
      .set({ hiddenAt: values.hiddenAt, hiddenBy: values.hiddenBy, updatedAt: values.updatedAt })
      .where(inArray(orgCache.id, rowIds));
  }
```

- [ ] **Step 5: 加 service.setHidden**

In `apps/api/src/modules/org/org.service.ts`，在 `resetManagerToFeishu` 之后、`assertOrgAdmin` 之前加：

```ts
  /**
   * 手动隐藏/取消隐藏成员（在职但不入目录，如豁免账号/双账号）。仅白名单。
   * 按 ou_ 句柄连带同一人的所有行（Albern 式双账号）。
   */
  async setHidden(
    requester: OrgRequester,
    targetUserId: string,
    hidden: boolean,
  ): Promise<{ user_id: string; hidden: boolean }> {
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
    const rowIds = rows.filter((r: any) => ouHandle(r) === handle).map((r: any) => r.id);
    const now = new Date();
    await this.orgRepository.setHidden(rowIds, {
      hiddenAt: hidden ? now : null,
      hiddenBy: hidden ? requester.userId : null,
      updatedAt: now,
    });

    return { user_id: target.userId, hidden };
  }
```

- [ ] **Step 6: 加 controller 端点**

In `apps/api/src/modules/org/org.controller.ts`，import 加 `SetHiddenDto`（`import { SetHiddenDto } from './dto/set-hidden.dto';`），在 `resetManager` 之后加：

```ts
  /**
   * PATCH /api/v1/org/users/:user_id/hidden
   * 手动隐藏/取消隐藏成员。仅白名单（Harvey/杨平）。
   */
  @Patch('users/:user_id/hidden')
  setHidden(
    @CurrentUser() user: CurrentUserPayload,
    @Param('user_id') targetUserId: string,
    @Body() dto: SetHiddenDto,
  ) {
    return this.orgService.setHidden({ userId: user.user_id, openId: user.open_id }, targetUserId, dto.hidden);
  }
```

- [ ] **Step 7: 运行测试确认通过 + 全量 API 回归**

Run: `pnpm --filter @leader-sync/api vitest run src/modules/org/org.service.spec.ts`
Expected: PASS。

Run: `pnpm --filter @leader-sync/api vitest run`
Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/org/
git commit -m "feat(api): 组织成员手动隐藏端点 PATCH /org/users/:uid/hidden"
```

---

## Task 5: 人员搜索过滤离职/隐藏

**Files:**
- Modify: `apps/api/src/modules/user/user.controller.ts:31-39`
- Test: `apps/api/src/modules/user/user.controller.spec.ts`（若无则新建）

**Interfaces:**
- Consumes: `orgCache.leftAt`/`hiddenAt`（Task 1）；现有 `search(query)` 内存匹配。
- Produces: search 结果排除 `leftAt != null || hiddenAt != null` 的行（协作人/负责人/PIC 选择器共用此端点）。

- [ ] **Step 1: 写失败测试**

确认是否已有 `apps/api/src/modules/user/user.controller.spec.ts`。若无，Create：

```ts
import { describe, it, expect } from 'vitest';
import { UserController } from './user.controller';

function makeController(rows: any[]) {
  const db = { select: () => ({ from: async () => rows }) } as any;
  return new UserController(db);
}

describe('UserController.search 过滤离职/隐藏', () => {
  const rows = [
    { userId: 'ou_a', openId: 'ou_a', userName: '张三', deptName: 'X', leftAt: null, hiddenAt: null },
    { userId: 'ou_left', openId: 'ou_left', userName: '张离职', deptName: 'X', leftAt: new Date(), hiddenAt: null },
    { userId: 'ou_hid', openId: 'ou_hid', userName: '张隐藏', deptName: 'X', leftAt: null, hiddenAt: new Date() },
  ];

  it('离职/隐藏成员不出现在搜索结果', async () => {
    const ctrl = makeController(rows);
    const res = await ctrl.search('张');
    expect(res.map((u) => u.userId)).toEqual(['ou_a']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @leader-sync/api vitest run src/modules/user/user.controller.spec.ts`
Expected: FAIL —— 现在会返回 3 条（未过滤）。

- [ ] **Step 3: 加过滤**

In `apps/api/src/modules/user/user.controller.ts`，`const allUsers = await this.db.select().from(orgCache);`（line 31）之后立即加：

```ts
    // 在册口径：离职/隐藏成员不进人员目录（协作人/负责人/PIC 选择器共用）
    const rosterUsers = allUsers.filter((u: any) => !u.leftAt && !u.hiddenAt);
```

并把下一行 `const matched = allUsers.filter(...)` 的 `allUsers` 改为 `rosterUsers`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @leader-sync/api vitest run src/modules/user/user.controller.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/user/
git commit -m "feat(api): 人员搜索过滤离职/隐藏成员"
```

---

## Task 6: 打分花名册过滤离职/隐藏

**Files:**
- Modify: `apps/worker/src/jobs/score-window.ts`（`ScoreWindowResult` 加字段 + 循环加过滤）
- Test: `apps/worker/src/jobs/__tests__/score-window.spec.ts`

**Interfaces:**
- Consumes: `orgCache.leftAt`/`hiddenAt`（Task 1）；现有 roster 循环 `for (const orgRow of orgRows)`（line 199），已有 `scoreExempt` 跳过。
- Produces: `ScoreWindowResult` 新增 `skippedLeftOrHidden: number`。

- [ ] **Step 1: 写失败测试**

在 `apps/worker/src/jobs/__tests__/score-window.spec.ts` 找到一个现有"生成草稿"用例，仿其 mock 加一例（若 mock 结构不同，按该文件既有 makeDb pattern 调整）：

```ts
  it('离职/隐藏成员不生成打分草稿', async () => {
    // orgRows: 在册 alice（有 manager）+ 离职 gone + 隐藏 hid（都有 manager）
    // 期望：只为 alice 生成草稿，gone/hid 计入 skippedLeftOrHidden
    // （按本文件既有 makeDb/contact mock 构造；断言 result.draftCount 与 result.skippedLeftOrHidden）
    const result = await runScoreWindowForTest({
      orgRows: [
        { id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', scoreExempt: false, leftAt: null, hiddenAt: null },
        { id: 2, userId: 'ou_gone', openId: 'ou_gone', userName: 'Gone', managerUserId: 'ou_boss', scoreExempt: false, leftAt: new Date(), hiddenAt: null },
        { id: 3, userId: 'ou_hid', openId: 'ou_hid', userName: 'Hid', managerUserId: 'ou_boss', scoreExempt: false, leftAt: null, hiddenAt: new Date() },
      ],
    });
    expect(result.skippedLeftOrHidden).toBe(2);
    expect(result.draftCount).toBe(1);
  });
```

> 注：`runScoreWindowForTest` 是占位——用该文件已有的调用封装（大概率是直接 `runScoreWindow({ db, ... })`）。实现前先读 `score-window.spec.ts` 顶部的 mock helper，套用同一构造方式。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @leader-sync/worker vitest run src/jobs/__tests__/score-window.spec.ts`
Expected: FAIL —— `skippedLeftOrHidden` 未定义。

- [ ] **Step 3: 加 result 字段**

In `apps/worker/src/jobs/score-window.ts`，`ScoreWindowResult` interface（line 55 起）里 `skippedExempt` 之后加：

```ts
  /** 因离职/隐藏跳过的员工数 */
  skippedLeftOrHidden: number;
```

`result` 初始化对象（line 133 起）里 `skippedExempt: 0,` 之后加：

```ts
    skippedLeftOrHidden: 0,
```

- [ ] **Step 4: 加循环过滤**

In `apps/worker/src/jobs/score-window.ts`，在 roster 循环里 `if (orgRow.scoreExempt) { ... continue; }`（line 200-203）**之后**、`const raterUserId` 之前加：

```ts
    if (orgRow.leftAt || orgRow.hiddenAt) {
      result.skippedLeftOrHidden++;
      continue;
    }
```

- [ ] **Step 5: 运行测试确认通过 + 全量回归**

Run: `pnpm --filter @leader-sync/worker vitest run src/jobs/__tests__/score-window.spec.ts`
Expected: PASS。

Run: `pnpm --filter @leader-sync/worker vitest run`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/jobs/score-window.ts apps/worker/src/jobs/__tests__/score-window.spec.ts
git commit -m "feat(worker): 打分花名册过滤离职/隐藏成员"
```

---

## Task 7: 前端布局纯函数 + 依赖

**Files:**
- Modify: `apps/web/package.json`（加 `@xyflow/react`、`d3-hierarchy`、`@types/d3-hierarchy`）
- Create: `apps/web/src/app/org/org-layout.ts`
- Test: `apps/web/src/app/org/__tests__/org-layout.spec.ts`

**Interfaces:**
- Consumes: 组织树数据（`OrgUser` 形如 Task 3 的 `OrgTreeNode`）。
- Produces:
  - `OrgUser`、`OrgTreeDatum` 类型
  - `dedupeUsers(users: readonly OrgUser[]): OrgUser[]`
  - `subtreeIds(users, rootUserId): Set<string>`（防环预检用）
  - `buildFlowGraph(users: readonly OrgUser[], collapsed: Set<string>): { nodes: Node<OrgTreeDatum>[]; edges: Edge[] }`

- [ ] **Step 1: 加依赖**

Run:
```bash
pnpm --filter @leader-sync/web add @xyflow/react@^12 d3-hierarchy@^3
pnpm --filter @leader-sync/web add -D @types/d3-hierarchy@^3
```
Expected: `apps/web/package.json` 出现三个依赖；`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 写失败测试**

Create `apps/web/src/app/org/__tests__/org-layout.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dedupeUsers, buildFlowGraph, subtreeIds, type OrgUser } from '../org-layout';

const u = (over: Partial<OrgUser>): OrgUser => ({
  user_id: over.user_id!,
  open_id: over.open_id ?? over.user_id!,
  user_name: over.user_name ?? over.user_id!,
  manager_user_id: over.manager_user_id ?? null,
  manager_name: over.manager_name ?? null,
  manager_source: over.manager_source ?? 'feishu',
  current_grade: over.current_grade ?? null,
  left_at: over.left_at ?? null,
  hidden_at: over.hidden_at ?? null,
});

describe('dedupeUsers', () => {
  it('同一人多行按信息量保留最全的一行', () => {
    const rows = [
      u({ user_id: 'ou_a', manager_user_id: null }),
      u({ user_id: 'emp_a', open_id: 'ou_a', manager_user_id: 'ou_boss', manager_source: 'manual' }),
    ];
    const out = dedupeUsers(rows);
    expect(out).toHaveLength(1);
    expect(out[0].manager_user_id).toBe('ou_boss');
  });
});

describe('buildFlowGraph', () => {
  const users = [
    u({ user_id: 'ou_boss' }),
    u({ user_id: 'ou_a', manager_user_id: 'ou_boss' }),
    u({ user_id: 'ou_b', manager_user_id: 'ou_boss' }),
  ];

  it('生成 3 节点 2 边，上级在上方（y 更小）', () => {
    const { nodes, edges } = buildFlowGraph(users, new Set());
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    const boss = nodes.find((n) => n.id === 'ou_boss')!;
    const a = nodes.find((n) => n.id === 'ou_a')!;
    expect(boss.position.y).toBeLessThan(a.position.y);
    expect(boss.data.childCount).toBe(2);
  });

  it('折叠父节点：子节点不出现，父带 collapsed + hiddenDescendantCount', () => {
    const { nodes, edges } = buildFlowGraph(users, new Set(['ou_boss']));
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(nodes[0].data.collapsed).toBe(true);
    expect(nodes[0].data.hiddenDescendantCount).toBe(2);
  });

  it('多根：两个无上级的人各成一棵树', () => {
    const multi = [u({ user_id: 'ou_x' }), u({ user_id: 'ou_y' })];
    const { nodes, edges } = buildFlowGraph(multi, new Set());
    expect(nodes.map((n) => n.id).sort()).toEqual(['ou_x', 'ou_y']);
    expect(edges).toHaveLength(0);
  });

  it('上级指向不存在的人 → 挂根 + unresolvedManager', () => {
    const orphan = [u({ user_id: 'ou_z', manager_user_id: 'ou_ghost' })];
    const { nodes } = buildFlowGraph(orphan, new Set());
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.unresolvedManager).toBe(true);
  });
});

describe('subtreeIds', () => {
  it('返回自己 + 全部后代的 id（防环预检）', () => {
    const users = [
      u({ user_id: 'ou_boss' }),
      u({ user_id: 'ou_a', manager_user_id: 'ou_boss' }),
      u({ user_id: 'ou_a1', manager_user_id: 'ou_a' }),
    ];
    const ids = subtreeIds(users, 'ou_boss');
    expect([...ids].sort()).toEqual(['ou_a', 'ou_a1', 'ou_boss']);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @leader-sync/web vitest run src/app/org/__tests__/org-layout.spec.ts`
Expected: FAIL —— `../org-layout` 不存在。

- [ ] **Step 4: 写 org-layout.ts**

Create `apps/web/src/app/org/org-layout.ts`:

```ts
import { hierarchy, tree } from 'd3-hierarchy';
import type { Node, Edge } from '@xyflow/react';

export interface OrgUser {
  user_id: string;
  open_id: string | null;
  user_name: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  manager_source: string;
  current_grade: string | null;
  left_at?: string | null;
  hidden_at?: string | null;
}

export interface OrgTreeDatum {
  user: OrgUser;
  childCount: number;
  hiddenDescendantCount: number;
  collapsed: boolean;
  unresolvedManager: boolean;
  [key: string]: unknown;
}

const NODE_W = 240;
const NODE_H = 84;
const H_GAP = 28;
const V_GAP = 64;

function canonicalId(u: OrgUser): string {
  if (u.open_id && u.open_id.startsWith('ou_')) return u.open_id;
  if (u.user_id && u.user_id.startsWith('ou_')) return u.user_id;
  return u.user_id;
}

function richness(u: OrgUser): number {
  let s = 0;
  if (u.manager_user_id) s += 4;
  if (u.manager_source === 'manual') s += 2;
  if (u.current_grade) s += 1;
  if (u.user_name) s += 1;
  return s;
}

export function dedupeUsers(users: readonly OrgUser[]): OrgUser[] {
  const byCanon = new Map<string, OrgUser>();
  for (const u of users) {
    const k = canonicalId(u);
    const prev = byCanon.get(k);
    if (!prev || richness(u) > richness(prev)) byCanon.set(k, u);
  }
  return [...byCanon.values()];
}

interface RawNode {
  user: OrgUser;
  children: RawNode[];
  unresolvedManager: boolean;
}

function buildForest(rawUsers: readonly OrgUser[]): RawNode[] {
  const users = dedupeUsers(rawUsers);
  const nodes: RawNode[] = users.map((user) => ({ user, children: [], unresolvedManager: false }));
  const byKey = new Map<string, RawNode>();
  for (const n of nodes) {
    if (n.user.user_id) byKey.set(n.user.user_id, n);
    if (n.user.open_id && !byKey.has(n.user.open_id)) byKey.set(n.user.open_id, n);
  }
  const roots: RawNode[] = [];
  for (const n of nodes) {
    const mid = n.user.manager_user_id;
    const parent = mid ? byKey.get(mid) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else {
      n.unresolvedManager = Boolean(mid && !parent);
      roots.push(n);
    }
  }
  const byName = (a: RawNode, b: RawNode) =>
    (a.user.user_name ?? '').localeCompare(b.user.user_name ?? '', 'zh');
  const sortRec = (list: RawNode[]) => {
    list.sort(byName);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function countDescendants(n: RawNode): number {
  let c = 0;
  for (const child of n.children) c += 1 + countDescendants(child);
  return c;
}

/** 自己 + 全部后代的 key 集合（拖拽防环客户端预检） */
export function subtreeIds(rawUsers: readonly OrgUser[], rootUserId: string): Set<string> {
  const forest = buildForest(rawUsers);
  const ids = new Set<string>();
  const find = (list: RawNode[]): RawNode | null => {
    for (const n of list) {
      if (n.user.user_id === rootUserId || n.user.open_id === rootUserId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const walk = (n: RawNode) => {
    ids.add(n.user.user_id);
    if (n.user.open_id) ids.add(n.user.open_id);
    n.children.forEach(walk);
  };
  const root = find(forest);
  if (root) walk(root);
  return ids;
}

/** 森林 → d3 tidy-tree 布局 → React Flow nodes/edges。collapsed 里的节点不展开子级。 */
export function buildFlowGraph(
  rawUsers: readonly OrgUser[],
  collapsed: Set<string>,
): { nodes: Node<OrgTreeDatum>[]; edges: Edge[] } {
  const forest = buildForest(rawUsers);
  // 隐形虚拟根挂所有森林根，统一布局；输出时跳过虚拟根
  const vroot: RawNode = { user: null as unknown as OrgUser, children: forest, unresolvedManager: false };
  const root = hierarchy<RawNode>(vroot, (d) => {
    if (!d.user) return d.children; // 虚拟根
    if (collapsed.has(d.user.user_id)) return []; // 折叠 → 不展开子级
    return d.children;
  });
  const layout = tree<RawNode>().nodeSize([NODE_W + H_GAP, NODE_H + V_GAP]);
  layout(root);

  const nodes: Node<OrgTreeDatum>[] = [];
  const edges: Edge[] = [];
  root.each((n) => {
    if (!n.data.user) return; // 跳过虚拟根
    const key = n.data.user.user_id;
    const allChildren = n.data.children.length;
    const isCollapsed = collapsed.has(key) && allChildren > 0;
    nodes.push({
      id: key,
      type: 'orgCard',
      position: { x: n.x, y: n.y },
      data: {
        user: n.data.user,
        childCount: allChildren,
        hiddenDescendantCount: isCollapsed ? countDescendants(n.data) : 0,
        collapsed: isCollapsed,
        unresolvedManager: n.data.unresolvedManager,
      },
    });
    if (n.parent && n.parent.data.user) {
      edges.push({
        id: `${n.parent.data.user.user_id}->${key}`,
        source: n.parent.data.user.user_id,
        target: key,
        type: 'smoothstep',
      });
    }
  });
  return { nodes, edges };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @leader-sync/web vitest run src/app/org/__tests__/org-layout.spec.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/app/org/org-layout.ts apps/web/src/app/org/__tests__/org-layout.spec.ts
git commit -m "feat(web): 组织架构画布布局纯函数 + React Flow/d3 依赖"
```

---

## Task 8: 前端画布组件 + 页面重写 + 截图审计

**Files:**
- Create: `apps/web/src/app/org/org-node-card.tsx`
- Create: `apps/web/src/app/org/org-canvas.tsx`
- Modify: `apps/web/src/app/org/page.tsx`（整页重写为画布壳）
- Modify: `apps/web/src/hooks/use-org-tree.ts`（加 `setHidden`、`include_hidden` 参数、类型加 `left_at`/`hidden_at`/`hidden_count`）
- Create: `apps/web/e2e/org-canvas-audit.spec.ts`

**Interfaces:**
- Consumes: `buildFlowGraph`、`subtreeIds`、`OrgUser`、`OrgTreeDatum`（Task 7）；`GET /api/v1/org/tree?include_hidden=`、`PATCH /api/v1/org/users/:uid/manager`、`POST .../manager/reset`、`PATCH .../hidden`（Task 3/4）。
- Produces: 可缩放平移的 `/org` 画布页。

- [ ] **Step 1: 扩展 use-org-tree hook**

先读 `apps/web/src/hooks/use-org-tree.ts` 现有导出。改动：
1. `OrgTreeUser` 类型加 `left_at?: string | null; hidden_at?: string | null;`。
2. `useOrgTree` 接受可选 `includeHidden: boolean`，请求 URL 加 `?include_hidden=1`；返回数据类型加 `hidden_count: number`。
3. 加导出 `setHidden(userId: string, hidden: boolean): Promise<void>`（`PATCH /api/v1/org/users/${userId}/hidden` body `{ hidden }`），与现有 `setManager` 同 fetch 封装。

具体按该文件现有 `setManager`/`resetManagerToFeishu` 的写法照抄一份 `setHidden`。

- [ ] **Step 2: 写节点卡片组件**

Create `apps/web/src/app/org/org-node-card.tsx`:

```tsx
'use client';
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, RotateCcw, EyeOff, Eye } from 'lucide-react';
import { getAvatar } from '@/lib/avatar';
import type { OrgTreeDatum } from './org-layout';

export interface OrgNodeActions {
  canEdit: boolean;
  collapsed: boolean;
  onToggle: (key: string) => void;
  onReset: (userId: string) => void;
  onSetHidden: (userId: string, hidden: boolean) => void;
}

/** React Flow 自定义节点：一个人的卡片。actions 经 node.data.__actions 注入。 */
function OrgNodeCardImpl({ data }: NodeProps) {
  const datum = data as OrgTreeDatum;
  const actions = (data as any).__actions as OrgNodeActions;
  const u = datum.user;
  const avatar = getAvatar(u.user_name);
  const isLeft = Boolean(u.left_at);
  const isHidden = Boolean(u.hidden_at);
  const hasChildren = datum.childCount > 0;

  return (
    <div
      data-testid={`org-node-${u.user_id}`}
      className={`org-card flex items-center gap-2 rounded-xl border px-3 py-2 ${
        isLeft || isHidden ? 'opacity-50 border-dashed' : ''
      } border-[var(--border)] bg-[var(--bg-card)]`}
      style={{ width: 240 }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: avatar.bg, color: avatar.fg }}
      >
        {avatar.initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {u.user_name ?? u.user_id}
          </span>
          {u.current_grade && (
            <span className="rounded border border-[var(--border)] px-1 py-0.5 text-[10px] text-[var(--text-secondary)]">
              {u.current_grade}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {hasChildren && (
            <span className="text-[10px] text-[var(--text-muted)]">
              {datum.collapsed ? `+${datum.hiddenDescendantCount}` : `${datum.childCount} 名下属`}
            </span>
          )}
          {u.manager_source === 'manual' && (
            <span className="rounded bg-[color-mix(in_srgb,var(--tag-private)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--tag-private)]">
              手动
            </span>
          )}
          {datum.unresolvedManager && (
            <span className="rounded bg-[color-mix(in_srgb,var(--accent-orange)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--accent-orange)]">
              上级未识别
            </span>
          )}
          {isLeft && (
            <span className="rounded bg-[color-mix(in_srgb,var(--accent-orange)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--accent-orange)]">
              离职
            </span>
          )}
          {isHidden && (
            <span className="rounded bg-[color-mix(in_srgb,var(--text-muted)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">
              已隐藏
            </span>
          )}
        </span>
      </span>

      {actions.canEdit && u.manager_source === 'manual' && !isLeft && (
        <button
          type="button"
          onClick={() => actions.onReset(u.user_id)}
          className="nodrag shrink-0 rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title="恢复为飞书通讯录的上级"
        >
          <RotateCcw className="size-3" />
        </button>
      )}
      {actions.canEdit && !isLeft && (
        <button
          type="button"
          onClick={() => actions.onSetHidden(u.user_id, !isHidden)}
          className="nodrag shrink-0 rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={isHidden ? '取消隐藏' : '隐藏（不入目录）'}
        >
          {isHidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
      )}
      {hasChildren && (
        <button
          type="button"
          onClick={() => actions.onToggle(u.user_id)}
          className="nodrag shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label={datum.collapsed ? '展开' : '收起'}
        >
          {datum.collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      )}
    </div>
  );
}

export const OrgNodeCard = memo(OrgNodeCardImpl);
```

- [ ] **Step 3: 写画布容器组件**

Create `apps/web/src/app/org/org-canvas.tsx`:

```tsx
'use client';
import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildFlowGraph, subtreeIds, type OrgUser, type OrgTreeDatum } from './org-layout';
import { OrgNodeCard, type OrgNodeActions } from './org-node-card';

interface Props {
  users: OrgUser[];
  canEdit: boolean;
  onSetManager: (userId: string, managerId: string | null) => void;
  onReset: (userId: string) => void;
  onSetHidden: (userId: string, hidden: boolean) => void;
}

const nodeTypes = { orgCard: OrgNodeCard };

export function OrgCanvas({ users, canEdit, onSetManager, onReset, onSetHidden }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const actions: OrgNodeActions = useMemo(
    () => ({ canEdit, collapsed: false, onToggle: toggle, onReset, onSetHidden }),
    [canEdit, toggle, onReset, onSetHidden],
  );

  const { nodes, edges } = useMemo(() => {
    const g = buildFlowGraph(users, collapsed);
    // 把交互回调注入每个节点 data（React Flow 节点渲染只拿 data）
    const nodesWithActions = g.nodes.map((n) => ({
      ...n,
      draggable: canEdit,
      data: { ...(n.data as OrgTreeDatum), __actions: actions },
    })) as Node<OrgTreeDatum>[];
    return { nodes: nodesWithActions, edges: g.edges as Edge[] };
  }, [users, collapsed, canEdit, actions]);

  // 拖拽落定：命中的目标节点 = 新上级；落到自己子树内则忽略（防环）
  const onNodeDragStop: OnNodeDrag = useCallback(
    (evt, node) => {
      if (!canEdit) return;
      const forbidden = subtreeIds(users, node.id);
      const dropX = node.position.x;
      const dropY = node.position.y;
      // 找与拖拽终点重叠、且不在自己子树里的节点作为新上级
      const target = nodes.find(
        (n) =>
          n.id !== node.id &&
          !forbidden.has(n.id) &&
          Math.abs(n.position.x - dropX) < 200 &&
          Math.abs(n.position.y - dropY) < 60,
      );
      if (target) onSetManager(node.id, target.id);
    },
    [canEdit, users, nodes, onSetManager],
  );

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 220px)' }} data-testid="org-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 4: 重写 page.tsx**

Replace `apps/web/src/app/org/page.tsx` 全文为：

```tsx
'use client';
import { useState } from 'react';
import { useOrgTree, setManager, resetManagerToFeishu, setHidden } from '@/hooks/use-org-tree';
import { OrgCanvas } from './org-canvas';
import type { OrgUser } from './org-layout';

export default function OrgPage() {
  const [includeHidden, setIncludeHidden] = useState(false);
  const { data, error, isLoading, mutate } = useOrgTree(includeHidden);
  const canEdit = data?.can_edit ?? false;
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setErrMsg(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setErrMsg((e as Error).message || '操作失败');
    }
  };

  const users = (data?.users ?? []) as OrgUser[];

  return (
    <div className="pb-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">组织架构</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {data?.last_feishu_sync_at
              ? `飞书通讯录最近同步：${new Date(data.last_feishu_sync_at).toLocaleString('zh-CN')}（每日 07:00 自动）`
              : '尚未从飞书通讯录同步过上下级关系'}
            {canEdit && ' · 拖拽卡片到新上级上调整汇报线 · 滚轮缩放、拖空白平移'}
          </p>
        </div>
        {canEdit && (data?.hidden_count ?? 0) >= 0 && (
          <button
            type="button"
            onClick={() => setIncludeHidden((v) => !v)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {includeHidden ? '隐藏已离职/隐藏成员' : `显示已隐藏 (${data?.hidden_count ?? 0})`}
          </button>
        )}
      </div>

      {errMsg && (
        <div className="mb-3 rounded-lg border border-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] px-3 py-2 text-xs text-[var(--accent-red)]">
          {errMsg}
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--text-secondary)]">加载中…</p>}
      {error && <p className="text-sm text-[var(--accent-red)]">组织数据加载失败，请刷新重试</p>}
      {!isLoading && !error && users.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
          暂无组织数据。成员首次登录系统或飞书通讯录同步后会出现在这里。
        </div>
      )}

      {!isLoading && !error && users.length > 0 && (
        <OrgCanvas
          users={users}
          canEdit={canEdit}
          onSetManager={(uid, mid) => run(() => setManager(uid, mid))}
          onReset={(uid) => run(() => resetManagerToFeishu(uid))}
          onSetHidden={(uid, hidden) => run(() => setHidden(uid, hidden))}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: typecheck + 单测回归**

Run: `pnpm --filter @leader-sync/web exec tsc --noEmit`
Expected: 0 错误。

Run: `pnpm --filter @leader-sync/web vitest run src/app/org/`
Expected: 布局单测仍绿。

- [ ] **Step 6: 写截图审计 e2e**

Create `apps/web/e2e/org-canvas-audit.spec.ts`（仿现有 `e2e/perm-audit.spec.ts` 的 dev-login + 截图 pattern；先读该文件确认登录与截图辅助函数）：

```ts
import { test, expect } from '@playwright/test';

// 以 Harvey（admin，组织编辑白名单）登录后截 /org 画布
test('org canvas renders (admin, light+dark)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'ou_dev_harvey' }),
    });
  });
  await page.goto('/org');
  await expect(page.getByTestId('org-canvas')).toBeVisible();
  await page.screenshot({ path: `screenshots/org-canvas-audit/canvas-default.png`, fullPage: true });

  // 展示已隐藏
  const toggle = page.getByRole('button', { name: /显示已隐藏/ });
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `screenshots/org-canvas-audit/canvas-with-hidden.png`, fullPage: true });
  }
});
```

- [ ] **Step 7: 起本地栈跑截图**

按 CLAUDE.md「Local Dev」：`pnpm dev:tunnel` → `pnpm dev:up` → 起 API/Web dev → `cd apps/web && pnpm e2e:screenshot`（或直接 `pnpm exec playwright test e2e/org-canvas-audit.spec.ts --config=playwright.perm.config.ts`）。

Run: `cd apps/web && pnpm exec playwright test e2e/org-canvas-audit.spec.ts`
Expected: PASS，生成 `screenshots/org-canvas-audit/canvas-default.png`。

- [ ] **Step 8: 主动 Read 截图确认**

Read `apps/web/screenshots/org-canvas-audit/canvas-default.png`（及 with-hidden）。确认：树自上而下、连接线正确、卡片信息完整、缩放控件+minimap 在位、隐藏成员灰态+离职/已隐藏徽章。若渲染异常，回到 Step 2-4 修，重截。

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/org/ apps/web/src/hooks/use-org-tree.ts apps/web/e2e/org-canvas-audit.spec.ts
git commit -m "feat(web): /org 重写为交互式画布树 + 离职/隐藏可视化"
```

---

## Task 9: 文档联动 + 部署

**Files:**
- Modify: `docs/02-data/field-dictionary.md`、`docs/02-data/enum-dictionary.md`、`docs/04-process/state-machine.md`、`docs/05-permissions/permission-matrix.md`、`docs/03-sync/`（相关同步文档）

**Interfaces:**
- Consumes: 前 8 个 task 的全部落地。

- [ ] **Step 1: 更新文档**

- `field-dictionary.md`：org_cache 加 `left_at` / `hidden_at` / `hidden_by` 三行；定义"在册口径 = 两者皆空"。
- `enum-dictionary.md`：新增成员生命周期状态（在册 / 离职 / 隐藏）+ 安全阀阈值 `LEAVE_SAFETY_MIN_RATIO=0.5`。
- `state-machine.md`：加 org_cache 成员生命周期（在职↔离职自愈；手动隐藏正交于离职）。
- `permission-matrix.md`：`PATCH /org/users/:uid/hidden` 仅 ORG_STRUCTURE_ADMINS；`GET /org/tree?include_hidden=1` 仅管理员生效。
- `docs/03-sync/`：sync-org-hierarchy 增加"离职判定 + 安全阀"小节。

- [ ] **Step 2: Commit 文档**

```bash
git add docs/
git commit -m "docs: 组织成员离职/隐藏生命周期文档联动（字段/枚举/状态机/权限/同步）"
```

- [ ] **Step 3: 全量测试 + 构建（交付前）**

Run:
```bash
pnpm --filter @leader-sync/shared-types build
pnpm --filter @leader-sync/db build
pnpm --filter @leader-sync/api vitest run
pnpm --filter @leader-sync/worker vitest run
pnpm --filter @leader-sync/web vitest run
pnpm --filter @leader-sync/api exec nest build
cd apps/web && pnpm build && cd ../..
```
Expected: 测试全绿、构建成功。

- [ ] **Step 4: 生产迁移 0023**

先备份 + 应用（Harvey.pem 在仓库根）：
```bash
ssh -i Harvey.pem root@47.84.35.154 'docker exec leader-sync-postgres-1 pg_dump -U leader_sync leader_sync' > /tmp/db-backup-pre-0023.sql
ssh -i Harvey.pem root@47.84.35.154 'docker exec -i leader-sync-postgres-1 psql -U leader_sync -d leader_sync' < db/migrations/0023_org_member_lifecycle.sql
```
Expected: `ALTER TABLE` / `CREATE INDEX` 成功（IF NOT EXISTS 幂等）。

- [ ] **Step 5: 生产装依赖（新增 React Flow/d3）**

```bash
rsync -avz -e "ssh -i Harvey.pem" pnpm-lock.yaml apps/web/package.json root@47.84.35.154:/opt/leader-sync/  # package.json 注意路径
ssh -i Harvey.pem root@47.84.35.154 'cd /opt/leader-sync && pnpm install --frozen-lockfile'
```
（apps/web/package.json rsync 到 `/opt/leader-sync/apps/web/package.json`，一文件一行，勿多源。）

- [ ] **Step 6: rsync dist + 重启**

按 memory 部署口径逐个 rsync（一文件一行）：`packages/shared-types/dist` → `db/dist` → `apps/api/dist` → `apps/worker/src`（worker 跑源码）→ `apps/web/.next`。
重启：`ssh ... 'systemctl restart leader-worker'`；api/web 按端口 `fuser <port>/tcp` 查 PID kill + `setsid --fork` 重启（**不用 pkill -f 含命令串**）。

- [ ] **Step 7: 手动触发一次 org sync 验证离职判定**

```bash
ssh -i Harvey.pem root@47.84.35.154 'cd /opt/leader-sync && pnpm --filter @leader-sync/worker exec tsx src/scripts/run-org-sync-once.ts --dry-run'
```
Expected: 日志出 `marked-left=N revived=M safety-valve=false`；核对 directoryCount 合理（未触发安全阀）。dry-run 确认后去掉 `--dry-run` 正式跑一次。
验证：`docker exec ... psql -c "SELECT user_name, left_at FROM org_cache WHERE left_at IS NOT NULL"` 应含 Roselinda / 刘国军 / 周佳玮。

- [ ] **Step 8: 手动隐藏豁免账号**

通过 UI（/org 管理员）或 API 隐藏：Albern@China（3 账号 handle）、陈明、李星。
```bash
# 示例（对每个 handle 调一次）：
curl -s -X PATCH "https://www.harveywang.xyz/api/v1/org/users/<ou_handle>/hidden" \
  -H "Content-Type: application/json" -H "Cookie: <admin-jwt>" -d '{"hidden":true}'
```

- [ ] **Step 9: 冒烟**

```bash
curl -s -o /dev/null -w "%{http_code}" https://www.harveywang.xyz/org            # 200
curl -s -o /dev/null -w "%{http_code}" https://www.harveywang.xyz/api/v1/org/tree # 401（无 token）
```
Expected: /org 200、/api/v1/org/tree 401。UI 确认离职/隐藏成员已从画布消失，管理员「显示已隐藏」可见灰态。

---

## Self-Review

**1. Spec coverage：**
- §2 数据模型 → Task 1 ✅
- §3 离职自动判定 + 安全阀 → Task 2 ✅
- §4 手动隐藏（API + 前端） → Task 4（API）+ Task 8（前端开关）✅
- §5 全局过滤：组织树 → Task 3；人员搜索 → Task 5；打分花名册 → Task 6；历史不动 → 无 task（正确，不改）✅
- §6 交互式画布 → Task 7（布局）+ Task 8（组件/页面）✅
- §7 测试 → 各 task 内嵌 TDD + Task 8 截图审计 ✅
- §8 文档联动 → Task 9 ✅
- §9 部署顺序 → Task 9 Step 4-9 ✅
- §10 风险（防环用非过滤查询）→ Task 3/4 用 `listAll()`（全量）做防环/句柄连带，getTree 内存过滤，一致 ✅

**2. Placeholder scan：** Task 6 的 `runScoreWindowForTest` 明确标注为"按该文件既有 mock helper 套用"——因 score-window.spec.ts 的 mock 结构未在本计划中读取，此处指示实现者先读再套，非空占位。其余步骤均有完整代码。

**3. Type consistency：**
- `OrgSyncResult` 新字段 `markedLeft`/`revived`/`safetyValveTriggered` — Task 2 定义与测试一致 ✅
- `getTree(requester, includeHidden?)` 返回 `hidden_count` — Task 3 service/controller/test 一致 ✅
- `setHidden(rowIds, values)`（repo）/ `setHidden(requester, targetUserId, hidden)`（service）/ `setHidden(userId, hidden)`（hook）三层签名区分清楚 ✅
- `buildFlowGraph(users, collapsed)` / `subtreeIds(users, rootUserId)` / `dedupeUsers(users)` — Task 7 定义与 Task 8 消费一致 ✅
- `OrgTreeDatum` 字段 `childCount`/`hiddenDescendantCount`/`collapsed`/`unresolvedManager` — Task 7 布局与 Task 8 卡片消费一致 ✅
