import { describe, it, expect, vi } from 'vitest';
import { runSyncPerfRoles, type ChatMember } from '../sync-perf-roles';
import { orgCache, perfRole } from '@leader-sync/db';

// ---- mocks -----------------------------------------------------------------

/** 极简 thenable（同 sync-org-hierarchy.spec 模式） */
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

function makeDb(opts: { orgRows: any[]; perfRows?: any[] }) {
  const upserts: Array<{ values: any; set: any }> = [];
  const updates: Array<{ userId: string; set: any }> = [];
  const db = {
    select: (_cols?: any) => ({
      from: (tbl: any) =>
        thenable(tbl === orgCache ? opts.orgRows : tbl === perfRole ? (opts.perfRows ?? []) : []),
    }),
    insert: (_tbl: any) => ({
      values: (values: any) => ({
        onConflictDoUpdate: ({ set }: any) => {
          upserts.push({ values, set });
          return Promise.resolve();
        },
      }),
    }),
    update: (_tbl: any) => ({
      set: (set: any) => ({
        where: (_cond: any) => {
          // where 条件是 eq(perfRole.userId, row.userId)；测试用 set 里无 userId，
          // 故用调用序对齐（cleared 行按顺序 push）。记录 set 即可断言标志清零。
          updates.push({ userId: set.__userId ?? '', set });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, upserts, updates };
}

const MGMT = 'oc_mgmt';
const LEADER = 'oc_leader';

/** chat mock：chatId → 成员 open_id 列表 */
function makeChat(map: Record<string, string[]>) {
  return {
    listMembers: vi.fn(async (chatId: string): Promise<ChatMember[]> =>
      (map[chatId] ?? []).map((openId) => ({ openId, name: openId })),
    ),
  };
}

const now = new Date('2026-07-08T14:10:00.000Z');
const baseOpts = (extra: any) => ({ mgmtChatId: MGMT, leaderChatId: LEADER, now, ...extra });

// ---- tests -----------------------------------------------------------------

describe('runSyncPerfRoles 全量对账', () => {
  it('进群：leader/管理层成员 → upsert 置位（含 source_chat_ids 留痕）', async () => {
    const { db, upserts } = makeDb({
      orgRows: [
        { userId: 'emp_alice', openId: 'ou_alice' }, // OAuth 员工 ID 行，open_id 关联
        { userId: 'ou_boss', openId: 'ou_boss' },
      ],
    });
    const chat = makeChat({
      [MGMT]: ['ou_boss'],
      [LEADER]: ['ou_alice', 'ou_boss'], // boss 同时在两群
    });

    const r = await runSyncPerfRoles(baseOpts({ db: db as any, chat }));

    expect(r.mgmtCount).toBe(1);
    expect(r.leaderCount).toBe(2);
    expect(r.matched).toBe(2);
    expect(r.upserted).toBe(2);
    expect(r.notFound).toBe(0);

    // alice：open_id 对回 emp_alice，仅 leader
    const alice = upserts.find((u) => u.values.userId === 'emp_alice');
    expect(alice!.values).toMatchObject({ isLeader: true, isManagement: false, openId: 'ou_alice' });
    expect(alice!.values.sourceChatIds).toEqual([LEADER]);

    // boss：两群都在 → 两标志 + 两 chat id
    const boss = upserts.find((u) => u.values.userId === 'ou_boss');
    expect(boss!.values).toMatchObject({ isLeader: true, isManagement: true });
    expect(boss!.values.sourceChatIds).toEqual([MGMT, LEADER]);
    expect(boss!.values.syncedAt).toEqual(now);
  });

  it('退群：已在库带标志、但两群都不在 → 清零（置 false）', async () => {
    const { db, upserts, updates } = makeDb({
      orgRows: [{ userId: 'ou_alice', openId: 'ou_alice' }],
      perfRows: [
        { userId: 'ou_gone', isLeader: true, isManagement: false }, // 已退群
        { userId: 'ou_alice', isLeader: true, isManagement: false }, // 仍在群
      ],
    });
    const chat = makeChat({ [MGMT]: [], [LEADER]: ['ou_alice'] });

    const r = await runSyncPerfRoles(baseOpts({ db: db as any, chat }));

    expect(r.upserted).toBe(1); // alice 仍在
    expect(r.cleared).toBe(1); // gone 被清零
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ isLeader: false, isManagement: false });
    expect(updates[0].set.sourceChatIds).toEqual([]);
    // alice 不应被清零（在 upserts 里）
    expect(upserts.some((u) => u.values.userId === 'ou_alice')).toBe(true);
  });

  it('查无此人：群成员 open_id 不在 org_cache → notFound++ 且不写身份', async () => {
    const { db, upserts } = makeDb({
      orgRows: [{ userId: 'ou_alice', openId: 'ou_alice' }],
    });
    const chat = makeChat({ [MGMT]: ['ou_ghost'], [LEADER]: ['ou_alice'] });

    const r = await runSyncPerfRoles(baseOpts({ db: db as any, chat }));

    expect(r.notFound).toBe(1);
    expect(r.matched).toBe(1); // 仅 alice
    expect(upserts.every((u) => u.values.userId !== 'ou_ghost')).toBe(true);
  });

  it('dryRun：只统计不写库', async () => {
    const { db, upserts, updates } = makeDb({
      orgRows: [{ userId: 'ou_alice', openId: 'ou_alice' }],
      perfRows: [{ userId: 'ou_gone', isLeader: true, isManagement: false }],
    });
    const chat = makeChat({ [MGMT]: [], [LEADER]: ['ou_alice'] });

    const r = await runSyncPerfRoles(baseOpts({ db: db as any, chat, dryRun: true }));

    expect(r.upserted).toBe(1);
    expect(r.cleared).toBe(1);
    expect(upserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
