import { describe, it, expect, vi } from 'vitest';
import { quarterCycle, quarterTask, quarterSheet, orgCache } from '@leader-sync/db';
import { runQuarterDeadlineReminder } from '../quarter-deadline-reminder';

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

function makeDb(data: { cycles: any[]; tasks: any[]; sheets: any[]; orgRows: any[] }) {
  const db = {
    select: () => ({
      from: (tbl: any) => ({
        where: () =>
          thenable(
            tbl === quarterCycle
              ? data.cycles
              : tbl === quarterTask
                ? data.tasks
                : tbl === quarterSheet
                  ? data.sheets
                  : tbl === orgCache
                    ? data.orgRows
                    : [],
          ),
      }),
    }),
  };
  return db;
}

// now = 10/8 09:20；peer_manager 截止 10/9（T-1d，落在 T-2d 催办窗）
const NOW = new Date('2026-10-08T09:20:00.000Z');
const DEADLINES = { self: '2026-10-04T00:00:00.000Z', peer_manager: '2026-10-09T00:00:00.000Z', mgmt: '2026-10-13T00:00:00.000Z' };

function baseData(over: Partial<{ cycles: any[]; tasks: any[]; sheets: any[]; orgRows: any[] }> = {}) {
  return {
    cycles: [{ cycleUid: 'qc_q3', quarter: '2026-Q3', status: 'scoring' }],
    tasks: [
      { taskUid: 'qt_1', cycleUid: 'qc_q3', rateeName: '张三', stage: 'pending_peer_manager', enrolled: true, stageDeadlines: DEADLINES },
    ],
    sheets: [
      { taskUid: 'qt_1', raterUserId: 'ou_bob', raterRole: 'peer', status: 'draft' },
      { taskUid: 'qt_1', raterUserId: 'ou_boss', raterRole: 'manager', status: 'draft' },
    ],
    orgRows: [
      { userId: 'ou_bob', openId: 'ou_bob', userName: 'Bob' },
      { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss' },
    ],
    ...over,
  };
}

describe('runQuarterDeadlineReminder', () => {
  it('T-2d 窗内：给当前环节未提交 sheet 的人各发一张催办卡', async () => {
    const feishu = { sendCardMessage: vi.fn().mockResolvedValue(undefined) };
    const r = await runQuarterDeadlineReminder({ now: NOW, db: makeDb(baseData()) as any, feishu });
    expect(r.remindersSent).toBe(2); // peer + manager
    expect(feishu.sendCardMessage).toHaveBeenCalledTimes(2);
    const targets = feishu.sendCardMessage.mock.calls.map((c) => c[0]);
    expect(targets).toEqual(expect.arrayContaining(['ou_bob', 'ou_boss']));
  });

  it('截止在 2 天以外 → 不催办', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const far = baseData({
      tasks: [{ taskUid: 'qt_1', cycleUid: 'qc_q3', stage: 'pending_peer_manager', enrolled: true, stageDeadlines: { ...DEADLINES, peer_manager: '2026-10-31T00:00:00.000Z' } }],
    });
    const r = await runQuarterDeadlineReminder({ now: NOW, db: makeDb(far) as any, feishu });
    expect(r.remindersSent).toBe(0);
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });

  it('已提交的 sheet 不催办；已 scored 任务不催办', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const d = baseData({
      sheets: [
        { taskUid: 'qt_1', raterUserId: 'ou_bob', raterRole: 'peer', status: 'submitted' },
        { taskUid: 'qt_1', raterUserId: 'ou_boss', raterRole: 'manager', status: 'draft' },
      ],
    });
    const r = await runQuarterDeadlineReminder({ now: NOW, db: makeDb(d) as any, feishu });
    expect(r.remindersSent).toBe(1); // 仅 manager
  });

  it('dry-run 不发卡但计数', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const r = await runQuarterDeadlineReminder({ now: NOW, dryRun: true, db: makeDb(baseData()) as any, feishu });
    expect(r.remindersSent).toBe(2);
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });
});
