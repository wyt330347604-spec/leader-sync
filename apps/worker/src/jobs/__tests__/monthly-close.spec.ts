import { describe, it, expect, vi } from 'vitest';
import { computeStats, clampRate, DONE_STATUSES } from '../monthly-close-stats';
import { runMonthlyClose } from '../monthly-close';
import { task, orgCache, externalMapping, monthlySnapshot } from '@leader-sync/db';

// ---- helpers -------------------------------------------------------------

const monthStart = new Date('2026-05-01T00:00:00.000Z');
const monthEnd = new Date('2026-05-31T23:59:59.999Z');

function mkTask(overrides: Record<string, any> = {}): any {
  return {
    taskUid: `task_${Math.random().toString(36).slice(2)}`,
    status: 'in_progress',
    monthBucket: '2026-05',
    sourceMonth: null,
    carryOverCount: 0,
    assigneeUserId: 'ou_alice',
    assigneeName: 'Alice',
    title: 'T',
    priority: 'important_urgent',
    taskType: 'monthly_new',
    createdAt: new Date('2026-05-02T00:00:00.000Z'),
    dueAt: new Date('2026-05-15T00:00:00.000Z'),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

// ---- pure stats (累计口径 / cumulative) ----------------------------------

describe('computeStats — cumulative (累计) 口径', () => {
  it('overdueRate 永远 <= 1，即使跨月积压远多于本月到期 (复现 1251% overflow 场景)', () => {
    const tasks = [
      // 50 条往月积压、逾期未完成 (due 在 monthStart 之前)
      ...Array.from({ length: 50 }, () =>
        mkTask({ dueAt: new Date('2026-03-10T00:00:00.000Z'), status: 'in_progress' }),
      ),
      // 3 条本月到期未完成
      ...Array.from({ length: 3 }, () =>
        mkTask({ dueAt: new Date('2026-05-20T00:00:00.000Z'), status: 'not_started' }),
      ),
    ];
    const s = computeStats(tasks, monthStart, monthEnd);
    // 旧（错误）口径: overdue(53) / dueInMonth(3) = 17.7 → numeric(5,4) 溢出
    // 新（累计）口径: overdue(53) / dueCumulative(53) = 1.0
    expect(s.monthOverdueCount).toBe(53);
    expect(s.monthDueCount).toBe(53);
    expect(s.overdueRate).toBeLessThanOrEqual(1);
    expect(s.overdueRate).toBeCloseTo(1, 5);
  });

  it('完成率 + 延期率 ≈ 1（分母统一为累计应完成全集）', () => {
    const tasks = [
      ...Array.from({ length: 6 }, () => mkTask({ status: 'done', dueAt: new Date('2026-04-10T00:00:00.000Z') })),
      ...Array.from({ length: 4 }, () => mkTask({ status: 'in_progress', dueAt: new Date('2026-04-10T00:00:00.000Z') })),
    ];
    const s = computeStats(tasks, monthStart, monthEnd);
    expect(s.monthDueCount).toBe(10);
    expect(s.monthDoneCount).toBe(6);
    expect(s.monthOverdueCount).toBe(4);
    expect(s.doneRate + s.overdueRate).toBeCloseTo(1, 5);
  });

  it('shelved 不计入应完成分母；done/shelved/closed 不计入继承候选', () => {
    const tasks = [
      mkTask({ status: 'shelved' }),
      mkTask({ status: 'done' }),
      mkTask({ status: 'closed' }),
      mkTask({ status: 'in_progress' }),
      mkTask({ status: 'not_started' }),
    ];
    const s = computeStats(tasks, monthStart, monthEnd);
    expect(s.carryOverCandidates.map((t: any) => t.status).sort()).toEqual(['in_progress', 'not_started']);
    // shelved 被排除出应完成全集
    expect(s.monthDueCount).toBe(4);
  });

  it('应完成全集为 0 时 rate 为 0，不产生 NaN/Infinity', () => {
    const s = computeStats([mkTask({ status: 'shelved' })], monthStart, monthEnd);
    expect(s.monthDueCount).toBe(0);
    expect(s.doneRate).toBe(0);
    expect(s.overdueRate).toBe(0);
  });
});

describe('clampRate', () => {
  it('把 >9.9999 的值钳到 9.9999 (numeric(5,4) 兜底)', () => {
    expect(clampRate(12.5152)).toBe(9.9999);
  });
  it('负值钳到 0，NaN/Infinity 归 0', () => {
    expect(clampRate(-1)).toBe(0);
    expect(clampRate(NaN)).toBe(0);
    expect(clampRate(Infinity)).toBe(9.9999);
  });
  it('正常区间值原样返回', () => {
    expect(clampRate(0.75)).toBe(0.75);
  });
});

// ---- orchestration: 故障隔离 + dryRun/skipNotifications ------------------

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

function makeMockDb(opts: { failSnapshotInsert?: boolean; tasks: any[]; updates: any[] }) {
  const rowsFor = (tbl: any): any[] => {
    if (tbl === task) return opts.tasks;
    if (tbl === orgCache) return [{ userId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' }];
    if (tbl === externalMapping) return [];
    return [];
  };
  return {
    select: () => ({ from: (tbl: any) => thenable(rowsFor(tbl)) }),
    insert: (tbl: any) => ({
      values: () => {
        if (tbl === monthlySnapshot && opts.failSnapshotInsert) {
          const p = Promise.reject(new Error('numeric field overflow'));
          p.catch(() => {});
          return { then: (res: any, rej: any) => p.then(res, rej), catch: (rej: any) => p.catch(rej) };
        }
        return thenable(undefined);
      },
    }),
    update: () => ({
      set: (vals: any) => ({
        where: () => {
          opts.updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
  };
}

const now = new Date('2026-06-01T00:00:00.000Z'); // lastMonth = 2026-05

describe('runMonthlyClose — 故障隔离 (核心回归)', () => {
  it('快照 insert 抛错时，继承移动 (task.update→2026-06) 仍对全部未完成任务执行', async () => {
    const tasks = [
      mkTask({ taskUid: 'a', status: 'in_progress' }),
      mkTask({ taskUid: 'b', status: 'not_started' }),
      mkTask({ taskUid: 'c', status: 'done' }), // 不应继承
    ];
    const updates: any[] = [];
    const db = makeMockDb({ failSnapshotInsert: true, tasks, updates });
    const feishu = { sendCardMessage: vi.fn(), updateBitableRecord: vi.fn() };

    await expect(
      runMonthlyClose({ now, skipNotifications: true, db: db as any, feishu: feishu as any }),
    ).resolves.toBeDefined();

    // 2 条未完成任务被移动到 2026-06（过滤掉 isLatest 翻转的 snapshot update）
    const carryUpdates = updates.filter((u) => u.monthBucket === '2026-06');
    expect(carryUpdates).toHaveLength(2);
    for (const u of carryUpdates) {
      expect(u.isCarriedOver).toBe(true);
    }
    // #1: 快照插入前应先把旧 isLatest 置为 false
    expect(updates.some((u) => u.isLatest === false)).toBe(true);
  });

  it('skipNotifications=true 时不发任何飞书卡片', async () => {
    const updates: any[] = [];
    const db = makeMockDb({ tasks: [mkTask({ status: 'in_progress' })], updates });
    const feishu = { sendCardMessage: vi.fn(), updateBitableRecord: vi.fn() };
    await runMonthlyClose({ now, skipNotifications: true, db: db as any, feishu: feishu as any });
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });

  it('dryRun=true 时不写库 (无 task.update)', async () => {
    const updates: any[] = [];
    const db = makeMockDb({ tasks: [mkTask({ status: 'in_progress' })], updates });
    const feishu = { sendCardMessage: vi.fn(), updateBitableRecord: vi.fn() };
    await runMonthlyClose({ now, dryRun: true, db: db as any, feishu: feishu as any });
    expect(updates).toHaveLength(0);
  });
});

describe('DONE_STATUSES', () => {
  it('包含 done/shelved/closed', () => {
    expect(DONE_STATUSES).toEqual(expect.arrayContaining(['done', 'shelved', 'closed']));
  });
});
