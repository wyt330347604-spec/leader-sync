import { describe, it, expect, vi } from 'vitest';
import { runScoreWindowSetup } from '../score-window';
import { monthlySnapshot, orgCache, scoreTemplate, perfRole } from '@leader-sync/db';

// ---- helpers（与 monthly-close.spec 同款 thenable 代理 mock）---------------

/** 极简 thenable，支持任意链式方法 (.where/.limit/.onConflictDoNothing) 并可 await */
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

function mkSnapshot(overrides: Record<string, any> = {}): any {
  return {
    snapshotUid: `snap_${Math.random().toString(36).slice(2)}`,
    snapshotMonth: '2026-06',
    roleScope: 'employee',
    isLatest: true,
    ownerUserId: 'ou_alice',
    ownerName: 'Alice',
    ...overrides,
  };
}

function makeDb(opts: { snapshots: any[]; orgRows: any[]; templates?: any[]; perfRoles?: any[] }) {
  const inserted: any[] = [];
  const db = {
    select: () => ({
      from: (tbl: any) =>
        thenable(
          tbl === monthlySnapshot
            ? opts.snapshots
            : tbl === orgCache
              ? opts.orgRows
              : tbl === scoreTemplate
                ? opts.templates ?? []
                : tbl === perfRole
                  ? opts.perfRoles ?? []
                  : [],
        ),
    }),
    insert: (_tbl: any) => ({
      values: (v: any) => {
        inserted.push(v);
        return thenable(undefined);
      },
    }),
  };
  return { db, inserted };
}

/** 两个 active 月度模板（stamping 用）。 */
const MONTHLY_TEMPLATES = [
  { templateUid: 'spt_monthly_employee', code: 'monthly_employee', active: true },
  { templateUid: 'spt_monthly_leader', code: 'monthly_leader', active: true },
];

const now = new Date('2026-07-02T04:00:00.000Z');

describe('runScoreWindowSetup', () => {
  it('花名册口径：为每个有 manager 的在册员工生成草稿；无 manager 的（含顶层）跳过并计数', async () => {
    const { db, inserted } = makeDb({
      snapshots: [
        mkSnapshot({ ownerUserId: 'ou_alice', ownerName: 'Alice' }),
        mkSnapshot({ ownerUserId: 'ou_bob', ownerName: 'Bob' }),
      ],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', managerName: 'Boss' },
        { userId: 'ou_bob', openId: 'ou_bob', userName: 'Bob', managerUserId: null },
        { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null },
      ],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: db as any, feishu });

    expect(r.rosterCount).toBe(3);
    expect(r.draftCount).toBe(1);
    // bob(mgr=null) + boss(mgr=null) 两人无直属 → 跳过
    expect(r.skippedNoManager).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      scoreMonth: '2026-06',
      rateeUserId: 'ou_alice',
      raterUserId: 'ou_boss',
      status: 'draft',
      createdBy: 'system',
    });
  });

  it('双 key 命中：org_cache.user_id 是员工 ID、open_id 是 ou_，快照 owner 用 ou_ 仍能解析 rater', async () => {
    const { db, inserted } = makeDb({
      snapshots: [mkSnapshot({ ownerUserId: 'ou_alice_open' })],
      orgRows: [
        // user_id 与快照 ownerUserId 不同命名空间，只有 open_id 能对上
        { userId: 'emp_10001', openId: 'ou_alice_open', userName: 'Alice', managerUserId: 'ou_boss' },
      ],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: db as any, feishu });

    expect(r.draftCount).toBe(1);
    expect(inserted[0]).toMatchObject({ rateeUserId: 'ou_alice_open', raterUserId: 'ou_boss' });
  });

  it('sendCards=false 不发卡片；sendCards=true 按 rater 聚合各发一张', async () => {
    const mk = () =>
      makeDb({
        snapshots: [
          mkSnapshot({ ownerUserId: 'ou_alice' }),
          mkSnapshot({ ownerUserId: 'ou_bob' }),
          mkSnapshot({ ownerUserId: 'ou_carol' }),
        ],
        orgRows: [
          { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' },
          { userId: 'ou_bob', openId: 'ou_bob', userName: 'Bob', managerUserId: 'ou_boss' },
          { userId: 'ou_carol', openId: 'ou_carol', userName: 'Carol', managerUserId: 'ou_pmo' },
          { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null },
          { userId: 'ou_pmo', openId: 'ou_pmo', userName: 'Pmo', managerUserId: null },
        ],
      });

    const silent = { sendCardMessage: vi.fn() };
    await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: mk().db as any, feishu: silent });
    expect(silent.sendCardMessage).not.toHaveBeenCalled();

    const loud = { sendCardMessage: vi.fn() };
    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: true, db: mk().db as any, feishu: loud });
    // ou_boss 管 2 人、ou_pmo 管 1 人 → 2 张卡
    expect(loud.sendCardMessage).toHaveBeenCalledTimes(2);
    expect(r.cardsSent).toBe(2);
    const targets = loud.sendCardMessage.mock.calls.map((c) => c[0]).sort();
    expect(targets).toEqual(['ou_boss', 'ou_pmo']);
  });

  it('rater 本身非 ou_ 时，用其 org_cache 行的 open_id 发卡片', async () => {
    const { db } = makeDb({
      snapshots: [mkSnapshot({ ownerUserId: 'ou_alice' })],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'emp_boss_01' },
        { userId: 'emp_boss_01', openId: 'ou_boss_open', userName: 'Boss', managerUserId: null },
      ],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: true, db: db as any, feishu });

    expect(r.cardsSent).toBe(1);
    expect(feishu.sendCardMessage).toHaveBeenCalledWith('ou_boss_open', expect.anything());
  });

  it('dryRun=true 不写库、不发卡，但返回将生成的数量', async () => {
    const { db, inserted } = makeDb({
      snapshots: [mkSnapshot({ ownerUserId: 'ou_alice' })],
      orgRows: [{ userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' }],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: true, dryRun: true, db: db as any, feishu });

    expect(r.draftCount).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });

  it('同一人两份快照（ou_ / 员工 ID 双命名空间）→ 只生成 1 条草稿，ratee 规范化为 ou_，名字与 rater_name 兜底填充', async () => {
    const { db, inserted } = makeDb({
      snapshots: [
        mkSnapshot({ ownerUserId: 'ou_alice_open', ownerName: null }),
        mkSnapshot({ ownerUserId: 'emp_10001', ownerName: null }),
      ],
      orgRows: [
        // 同一人两行：员工 ID 行 + ou_ 行，共享 open_id
        { userId: 'emp_10001', openId: 'ou_alice_open', userName: '张三', managerUserId: 'ou_boss' },
        { userId: 'ou_alice_open', openId: 'ou_alice_open', userName: '张三', managerUserId: 'ou_boss' },
        { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null },
      ],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: db as any, feishu });

    expect(r.draftCount).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      rateeUserId: 'ou_alice_open',
      rateeName: '张三',
      raterUserId: 'ou_boss',
      raterName: 'Boss',
    });
  });

  it('score_exempt=true 的被评人不生成草稿（豁免计数）', async () => {
    const { db, inserted } = makeDb({
      snapshots: [
        mkSnapshot({ ownerUserId: 'ou_alice' }),
        mkSnapshot({ ownerUserId: 'ou_albern' }),
      ],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', scoreExempt: false },
        { userId: 'ou_albern', openId: 'ou_albern', userName: 'Albern', managerUserId: 'ou_boss', scoreExempt: true },
        { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null },
      ],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: db as any, feishu });

    expect(r.draftCount).toBe(1);
    expect(r.skippedExempt).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].rateeUserId).toBe('ou_alice');
  });

  it('leftAt/hiddenAt 的在册成员不生成打分草稿（离职/隐藏计数）', async () => {
    const { db, inserted } = makeDb({
      snapshots: [],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', scoreExempt: false, leftAt: null, hiddenAt: null },
        { userId: 'ou_gone', openId: 'ou_gone', userName: 'Gone', managerUserId: 'ou_boss', scoreExempt: false, leftAt: new Date(), hiddenAt: null },
        { userId: 'ou_hid', openId: 'ou_hid', userName: 'Hid', managerUserId: 'ou_boss', scoreExempt: false, leftAt: null, hiddenAt: new Date() },
      ],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: db as any, feishu });

    expect(r.draftCount).toBe(1);
    expect(r.skippedLeftOrHidden).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].rateeUserId).toBe('ou_alice');
  });

  it('花名册为空时安全返回 0，不抛错', async () => {
    const { db, inserted } = makeDb({ snapshots: [], orgRows: [] });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: true, db: db as any, feishu });

    expect(r.rosterCount).toBe(0);
    expect(r.draftCount).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  // ── V1.4：开窗盖章 template_uid（按被评人 perf_role.is_leader）───────────────
  it('perf_role.is_leader → 盖 monthly_leader 模板；无 perf_role 行 → 视为员工盖 monthly_employee', async () => {
    const { db, inserted } = makeDb({
      snapshots: [
        mkSnapshot({ ownerUserId: 'ou_alice' }), // leader
        mkSnapshot({ ownerUserId: 'ou_bob' }),   // 无 perf_role 行 → 员工
      ],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' },
        { userId: 'ou_bob', openId: 'ou_bob', userName: 'Bob', managerUserId: 'ou_boss' },
        { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null },
      ],
      templates: MONTHLY_TEMPLATES,
      perfRoles: [{ userId: 'ou_alice', openId: 'ou_alice', isLeader: true, isManagement: false }],
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: db as any, feishu });

    expect(r.draftCount).toBe(2);
    const alice = inserted.find((i) => i.rateeUserId === 'ou_alice');
    const bob = inserted.find((i) => i.rateeUserId === 'ou_bob');
    expect(alice.templateUid).toBe('spt_monthly_leader');
    expect(bob.templateUid).toBe('spt_monthly_employee');
  });

  it('无模板（未 seed）时 template_uid 兜底为 null，不抛错', async () => {
    const { db, inserted } = makeDb({
      snapshots: [mkSnapshot({ ownerUserId: 'ou_alice' })],
      orgRows: [{ userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' }],
      // templates 缺省 = []
    });
    const feishu = { sendCardMessage: vi.fn() };

    const r = await runScoreWindowSetup({ month: '2026-06', now, sendCards: false, db: db as any, feishu });

    expect(r.draftCount).toBe(1);
    expect(inserted[0].templateUid).toBeNull();
  });
});
