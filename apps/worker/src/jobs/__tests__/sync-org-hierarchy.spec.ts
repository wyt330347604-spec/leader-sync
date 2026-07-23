import { describe, it, expect, vi } from 'vitest';
import { runSyncOrgHierarchy, OrgSyncPermissionError } from '../sync-org-hierarchy';
import { orgCache, task } from '@leader-sync/db';

// ---- mocks -----------------------------------------------------------------

/** 极简 thenable（同 monthly-close.spec 模式） */
function thenable(value: any): any {
  const p = Promise.resolve(value);
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => p.then(res, rej);
      if (prop === 'catch') return (rej: any) => p.catch(rej);
      if (prop === 'finally') return (f: any) => p.finally(f);
      return () => thenable(value);
    },
    apply() {
      return thenable(value);
    },
  });
}

function makeDb(opts: { orgRows: any[]; taskAssignees?: string[] }) {
  const updates: Array<{ vals: any }> = [];
  const inserted: any[] = [];
  const db = {
    select: (_cols?: any) => ({
      from: (tbl: any) =>
        thenable(
          tbl === orgCache
            ? opts.orgRows
            : tbl === task
              ? (opts.taskAssignees ?? []).map((id) => ({ assigneeUserId: id }))
              : [],
        ),
    }),
    update: (_tbl: any) => ({
      set: (vals: any) => ({
        where: () => {
          updates.push({ vals });
          return Promise.resolve();
        },
      }),
    }),
    insert: (_tbl: any) => ({
      values: (v: any) => {
        inserted.push(v);
        return thenable(undefined);
      },
    }),
  };
  return { db, updates, inserted };
}

/** contact mock：directory = open_id → { name, leaderOpenId }，无此人返回 null */
function makeContact(directory: Record<string, { name: string; leaderOpenId: string }>) {
  return {
    listAllUsers: vi.fn(async () =>
      Object.entries(directory).map(([openId, u]) => ({ openId, name: u.name, leaderOpenId: u.leaderOpenId })),
    ),
    getUser: vi.fn(async (openId: string) => {
      const u = directory[openId];
      if (!u) return null;
      return { openId, name: u.name, leaderOpenId: u.leaderOpenId };
    }),
  };
}

const now = new Date('2026-07-02T04:00:00.000Z');

// ---- tests -----------------------------------------------------------------

describe('runSyncOrgHierarchy', () => {
  it('为 org_cache 行写入 manager（来源 feishu + 审计字段）', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerSource: 'feishu' },
        { id: 2, userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerSource: 'feishu' },
      ],
    });
    const contact = makeContact({
      ou_alice: { name: 'Alice', leaderOpenId: 'ou_boss' },
      ou_boss: { name: 'Boss', leaderOpenId: '' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.updated).toBe(2);
    const aliceUpdate = updates.find((u) => u.vals.managerUserId === 'ou_boss');
    expect(aliceUpdate).toBeDefined();
    expect(aliceUpdate!.vals).toMatchObject({
      managerUserId: 'ou_boss',
      managerName: 'Boss',
      managerSource: 'feishu',
      managerUpdatedBy: 'system:sync',
    });
    expect(aliceUpdate!.vals.managerUpdatedAt).toEqual(now);
    // Boss 无 leader → manager 置 null（根节点）
    const bossUpdate = updates.find((u) => u.vals.managerUserId === null);
    expect(bossUpdate).toBeDefined();
  });

  it('manager_source=manual 的行跳过，不被同步覆盖', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        {
          id: 1,
          userId: 'ou_alice',
          openId: 'ou_alice',
          userName: 'Alice',
          managerUserId: 'ou_handpicked',
          managerSource: 'manual',
        },
      ],
    });
    const contact = makeContact({ ou_alice: { name: 'Alice', leaderOpenId: 'ou_boss' } });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.skippedManual).toBe(1);
    expect(r.updated).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('活跃任务负责人不在 org_cache → 新建行（user_id=open_id=ou_，含 manager）', async () => {
    const { db, inserted } = makeDb({
      orgRows: [{ id: 1, userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerSource: 'feishu' }],
      taskAssignees: ['ou_newguy', 'ou_boss'],
    });
    const contact = makeContact({
      ou_boss: { name: 'Boss', leaderOpenId: '' },
      ou_newguy: { name: 'New Guy', leaderOpenId: 'ou_boss' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.created).toBe(1);
    expect(inserted[0]).toMatchObject({
      userId: 'ou_newguy',
      openId: 'ou_newguy',
      userName: 'New Guy',
      managerUserId: 'ou_boss',
      managerName: 'Boss',
      managerSource: 'feishu',
    });
  });

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

  it('无 ou_ 句柄的行跳过并计数（无法查通讯录）', async () => {
    const { db } = makeDb({
      orgRows: [{ id: 1, userId: 'emp_123', openId: null, userName: 'Legacy', managerSource: 'feishu' }],
    });
    const contact = makeContact({});

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.noOpenId).toBe(1);
    expect(contact.getUser).not.toHaveBeenCalled();
  });

  it('leader 不在本批用户集合内时补拉其姓名', async () => {
    const { db, updates } = makeDb({
      orgRows: [{ id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerSource: 'feishu' }],
    });
    const contact = makeContact({
      ou_alice: { name: 'Alice', leaderOpenId: 'ou_outside_boss' },
      ou_outside_boss: { name: 'Outside Boss', leaderOpenId: '' },
    });

    await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(updates[0].vals).toMatchObject({ managerUserId: 'ou_outside_boss', managerName: 'Outside Boss' });
  });

  it('同一人两行（员工 ID 行 + ou_ 行共享 open_id）→ 两行都更新 manager', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        // 生产实况：历史手工 SQL 造的 ou_ 行 + OAuth 登录造的员工 ID 行
        { id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: '张三', managerSource: 'feishu' },
        { id: 2, userId: 'emp_zhang', openId: 'ou_alice', userName: '张三', managerSource: 'feishu' },
      ],
    });
    const contact = makeContact({
      ou_alice: { name: '张三', leaderOpenId: 'ou_boss' },
      ou_boss: { name: 'Boss', leaderOpenId: '' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    // 张三两行都写 manager，另有 leader ou_boss 新建 1 行
    const managerWrites = updates.filter((u) => u.vals.managerUserId === 'ou_boss');
    expect(managerWrites).toHaveLength(2);
    expect(r.updated).toBe(2);
  });

  it('通讯录全量：从未登录且无任务的目录用户也新建入库（含 leader）', async () => {
    const { db, inserted } = makeDb({ orgRows: [] });
    const contact = makeContact({
      ou_never_seen: { name: '新同事', leaderOpenId: 'ou_boss' },
      ou_boss: { name: 'Boss', leaderOpenId: '' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.directoryCount).toBe(2);
    expect(r.created).toBe(2);
    const row = inserted.find((v) => v.userId === 'ou_never_seen');
    expect(row).toMatchObject({ userName: '新同事', managerUserId: 'ou_boss', managerName: 'Boss' });
  });

  it('权限未开时抛 OrgSyncPermissionError（带飞书后台指引），不写库', async () => {
    const { db, updates } = makeDb({
      orgRows: [{ id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerSource: 'feishu' }],
    });
    const contact = {
      listAllUsers: vi.fn(async () => {
        throw new OrgSyncPermissionError('99991672 no permission');
      }),
      getUser: vi.fn(async () => {
        throw new OrgSyncPermissionError('99991672 no permission');
      }),
    };

    await expect(runSyncOrgHierarchy({ db: db as any, contact, now })).rejects.toThrow(OrgSyncPermissionError);
    expect(updates).toHaveLength(0);
  });

  it('dryRun=true 不写库，只统计', async () => {
    const { db, updates, inserted } = makeDb({
      orgRows: [{ id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerSource: 'feishu' }],
      taskAssignees: ['ou_newguy'],
    });
    const contact = makeContact({
      ou_alice: { name: 'Alice', leaderOpenId: 'ou_boss' },
      ou_newguy: { name: 'New Guy', leaderOpenId: '' },
      ou_boss: { name: 'Boss', leaderOpenId: '' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now, dryRun: true });

    expect(r.updated).toBe(1);
    // ou_newguy（任务负责人）+ ou_boss（沿 leader 链发现）都会新建
    expect(r.created).toBe(2);
    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

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

  it('安全阀分母按人（distinct handle）去重，不被同一人多行冲高', async () => {
    // person1 有 3 行共享 ou_p1（历史多账号残留），person2/person3 各 1 行，全部在职。
    // 通讯录只枚举到 ou_p1 + ou_p2（person3 已离职，飞书通讯录查不到）。
    //
    // 旧代码（行数分母）：resolvableActive.length = 5（3+1+1）
    //   fetched.size(2) < 5*0.5=2.5 → true → 安全阀误触发 → markedLeft 应为 0（本测试要证伪的错误行为）
    // 新代码（distinct handle 分母）：resolvableActiveHandles.size = 3（ou_p1/ou_p2/ou_p3）
    //   fetched.size(2) < 3*0.5=1.5 → false → 不触发 → 正常走离职判定 → person3 唯一一行被标离职 markedLeft=1
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_p1', openId: 'ou_p1', userName: 'P1', managerSource: 'feishu' },
        { id: 2, userId: 'emp_p1_a', openId: 'ou_p1', userName: 'P1', managerSource: 'feishu' },
        { id: 3, userId: 'emp_p1_b', openId: 'ou_p1', userName: 'P1', managerSource: 'feishu' },
        { id: 4, userId: 'ou_p2', openId: 'ou_p2', userName: 'P2', managerSource: 'feishu' },
        { id: 5, userId: 'ou_p3', openId: 'ou_p3', userName: 'P3', managerSource: 'feishu' },
      ],
    });
    const contact = makeContact({
      ou_p1: { name: 'P1', leaderOpenId: '' },
      ou_p2: { name: 'P2', leaderOpenId: '' },
    });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.safetyValveTriggered).toBe(false);
    expect(r.markedLeft).toBe(1);
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

  it('离职判定：手动标记粘性 — left_source=manual 且人仍在通讯录 → 不复活（保留 leftAt）', async () => {
    const manualLeft = new Date('2026-07-01T00:00:00.000Z');
    const { db, updates } = makeDb({
      orgRows: [
        {
          id: 1,
          userId: 'ou_x',
          openId: 'ou_x',
          userName: 'X',
          managerSource: 'feishu',
          leftAt: manualLeft,
          leftSource: 'manual',
        },
      ],
    });
    const contact = makeContact({ ou_x: { name: 'X', leaderOpenId: '' } }); // 仍在通讯录

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.revived).toBe(0);
    expect(updates.find((u) => u.vals.leftAt === null)).toBeUndefined(); // 没有清 leftAt 的写
  });

  it('离职判定：手动标记粘性 — left_source=feishu 且人回到通讯录 → 复活（清 leftAt）', async () => {
    const autoLeft = new Date('2026-07-01T00:00:00.000Z');
    const { db, updates } = makeDb({
      orgRows: [
        {
          id: 2,
          userId: 'ou_y',
          openId: 'ou_y',
          userName: 'Y',
          managerSource: 'feishu',
          leftAt: autoLeft,
          leftSource: 'feishu',
        },
      ],
    });
    const contact = makeContact({ ou_y: { name: 'Y', leaderOpenId: '' } });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.revived).toBe(1);
    const revived = updates.find((u) => u.vals.leftAt === null);
    expect(revived).toBeDefined();
    expect(revived!.vals.leftSource).toBeNull();
  });

  it('离职判定：手动标记粘性 — 自动标离职写 left_source=feishu', async () => {
    // 另加两个仍在通讯录的活跃行，避免分母过低触发安全阀（同现有'不在通讯录枚举内'用例的结构）。
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_a', openId: 'ou_a', userName: 'A', managerSource: 'feishu', leftAt: null, leftSource: null },
        { id: 2, userId: 'ou_b', openId: 'ou_b', userName: 'B', managerSource: 'feishu', leftAt: null, leftSource: null },
        {
          id: 3,
          userId: 'ou_z',
          openId: 'ou_z',
          userName: 'Z',
          managerSource: 'feishu',
          leftAt: null,
          leftSource: null,
        },
      ],
    });
    const contact = makeContact({
      ou_a: { name: 'A', leaderOpenId: '' },
      ou_b: { name: 'B', leaderOpenId: '' },
    }); // ou_z 不在通讯录 → 应标离职

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.safetyValveTriggered).toBe(false);
    expect(r.markedLeft).toBe(1);
    const marked = updates.find((u) => u.vals.leftSource === 'feishu');
    expect(marked).toBeDefined();
    expect(marked!.vals.leftAt).toEqual(now);
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
});
