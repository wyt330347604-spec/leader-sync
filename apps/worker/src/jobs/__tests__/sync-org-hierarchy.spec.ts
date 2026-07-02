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

  it('飞书查不到的用户（离职等）跳过并计数，不中断整体', async () => {
    const { db, updates } = makeDb({
      orgRows: [
        { id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerSource: 'feishu' },
        { id: 2, userId: 'ou_gone', openId: 'ou_gone', userName: 'Gone', managerSource: 'feishu' },
      ],
    });
    const contact = makeContact({ ou_alice: { name: 'Alice', leaderOpenId: '' } });

    const r = await runSyncOrgHierarchy({ db: db as any, contact, now });

    expect(r.notFound).toBe(1);
    expect(r.updated).toBe(1);
    expect(updates).toHaveLength(1);
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

  it('权限未开时抛 OrgSyncPermissionError（带飞书后台指引），不写库', async () => {
    const { db, updates } = makeDb({
      orgRows: [{ id: 1, userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerSource: 'feishu' }],
    });
    const contact = {
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
});
