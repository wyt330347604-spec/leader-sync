import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { orgCache, userRoleBinding } from '@leader-sync/db';

/**
 * 身份源头回归：OAuth 登录的 org_cache upsert 曾按员工 ID（feishuUser.user_id）
 * onConflict(userId) 插入——同一人若已有 ou_ 键的行（通讯录同步/历史创建），
 * 会插出第二行。双行是全系统 user_id/open_id 双命名空间问题的根源。
 * 新语义：先按 open_id / user_id 匹配既有行并更新，匹配不到才插入。
 */

const FEISHU_USER = {
  user_id: 'emp_62cb4f82',
  open_id: 'ou_alice_open',
  name: '张三',
  department_ids: ['od-1'],
};

function makeDb(opts: { orgRows: any[]; roleRows?: any[] }) {
  const updates: any[] = [];
  const inserted: any[] = [];
  const whereConds: any[] = [];
  const db = {
    whereConds,
    select: () => ({
      from: (tbl: any) => ({
        where: (cond: any) => {
          whereConds.push(cond);
          return Promise.resolve(tbl === orgCache ? opts.orgRows : tbl === userRoleBinding ? (opts.roleRows ?? []) : []);
        },
      }),
    }),
    update: (_tbl: any) => ({
      set: (vals: any) => ({
        where: () => {
          updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
    insert: (_tbl: any) => ({
      values: (v: any) => {
        inserted.push(v);
        return { onConflictDoNothing: () => Promise.resolve(), then: (r: any) => Promise.resolve().then(r) };
      },
    }),
  };
  return { db, updates, inserted };
}

describe('AuthService — 登录身份写入（双行根因回归）', () => {
  let jwt: { signAsync: ReturnType<typeof vi.fn> };
  let feishuAuth: { getUserAccessToken: ReturnType<typeof vi.fn>; getUserInfo: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwt = { signAsync: vi.fn().mockResolvedValue('tok') };
    feishuAuth = {
      getUserAccessToken: vi.fn().mockResolvedValue('uat'),
      getUserInfo: vi.fn().mockResolvedValue(FEISHU_USER),
    };
  });

  it('已存在 ou_ 键的行（open_id 命中）→ 更新该行，不新插行', async () => {
    const { db, updates, inserted } = makeDb({
      orgRows: [{ id: 7, userId: 'ou_alice_open', openId: 'ou_alice_open', userName: '张三' }],
    });
    const svc = new AuthService(db as any, jwt as any, feishuAuth as any);

    await svc.loginWithCode('code');

    expect(inserted).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ openId: 'ou_alice_open', userName: '张三' });
  });

  it('同一人历史双行（ou_ 行 + 员工 ID 行）→ 两行都刷新，不再插第三行', async () => {
    const { db, updates, inserted } = makeDb({
      orgRows: [
        { id: 7, userId: 'ou_alice_open', openId: 'ou_alice_open' },
        { id: 8, userId: 'emp_62cb4f82', openId: 'ou_alice_open' },
      ],
    });
    const svc = new AuthService(db as any, jwt as any, feishuAuth as any);

    await svc.loginWithCode('code');

    expect(inserted).toHaveLength(0);
    expect(updates).toHaveLength(2);
  });

  it('全新用户（无任何既有行）→ 插入一行', async () => {
    const { db, updates, inserted } = makeDb({ orgRows: [] });
    const svc = new AuthService(db as any, jwt as any, feishuAuth as any);

    await svc.loginWithCode('code');

    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ userId: 'emp_62cb4f82', openId: 'ou_alice_open', userName: '张三' });
  });
});

describe('AuthService — getMe 双命名空间', () => {
  it('JWT user_id 是员工 ID、org 行键是 ou_（仅 open_id 命中）→ 仍能返回 profile', async () => {
    const { db } = makeDb({
      orgRows: [{ id: 7, userId: 'ou_alice_open', openId: 'ou_alice_open', userName: '张三', deptId: 'od-1' }],
      roleRows: [{ role: 'leader' }],
    });
    const svc = new AuthService(db as any, { signAsync: vi.fn() } as any, {} as any);

    const me = await svc.getMe('emp_62cb4f82');

    expect(me).toMatchObject({ user_name: '张三', role: 'leader', open_id: 'ou_alice_open' });
    // 查询条件必须同时按 user_id 和 open_id 匹配（谓词盲 mock 的补强断言）
    const colNames: string[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (typeof n.name === 'string' && n.table) colNames.push(n.name);
      for (const k of (n.queryChunks ?? (Array.isArray(n) ? n : []))) walk(k);
    };
    walk((db as any).whereConds[0]);
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('open_id');
  });
});
