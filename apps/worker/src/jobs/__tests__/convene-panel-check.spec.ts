import { describe, it, expect, vi } from 'vitest';
import { quarterCycle, quarterTask, perfRole, orgCache } from '@leader-sync/db';
import { runConvenePanelCheck } from '../convene-panel-check';

/** thenable 代理：既支持 await `.from(tbl)`，也支持 `.from(tbl).where(...)`（与 open-quarter-window.spec 同款）。 */
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

interface DbData {
  cycles: any[];
  tasks: any[];
  mgmt: any[];
  orgRows: any[];
}

function makeDb(data: DbData) {
  const updates: { values: any }[] = [];
  const db = {
    select: () => ({
      from: (tbl: any) =>
        thenable(
          tbl === quarterCycle
            ? data.cycles
            : tbl === quarterTask
              ? data.tasks
              : tbl === perfRole
                ? data.mgmt
                : tbl === orgCache
                  ? data.orgRows
                  : [],
        ),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => {
          updates.push({ values: v });
          return thenable(undefined);
        },
      }),
    }),
  };
  return { db, updates };
}

const NOW = new Date('2026-10-14T09:20:00.000Z');

function baseData(over: Partial<DbData> = {}): DbData {
  return {
    cycles: [{ cycleUid: 'qc_q3', quarter: '2026-Q3', status: 'scoring' }],
    tasks: [
      { taskUid: 'qt_a', cycleUid: 'qc_q3', enrolled: true, mgmtRequired: true, stage: 'scored' },
      { taskUid: 'qt_b', cycleUid: 'qc_q3', enrolled: true, mgmtRequired: false, stage: 'scored' },
      { taskUid: 'qt_skip', cycleUid: 'qc_q3', enrolled: false, mgmtRequired: false, stage: 'pending_self' },
    ],
    mgmt: [
      { userId: 'ou_pan', openId: 'ou_pan', isManagement: true },
      { userId: 'ou_zhang', openId: 'ou_zhang', isManagement: true },
    ],
    orgRows: [
      { userId: 'ou_pan', openId: 'ou_pan', userName: '潘安' },
      { userId: 'ou_zhang', openId: 'ou_zhang', userName: '张诗珧' },
    ],
    ...over,
  };
}

describe('runConvenePanelCheck', () => {
  it('全部 enrolled 任务已 scored → 召集：cycle 置 panel + panel_at，给管理层各发一张召集卡', async () => {
    const feishu = { sendCardMessage: vi.fn().mockResolvedValue(undefined) };
    const { db, updates } = makeDb(baseData());
    const r = await runConvenePanelCheck({ now: NOW, db: db as any, feishu });
    expect(r.convened).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ status: 'panel' });
    expect(updates[0].values.panelAt).toBeInstanceOf(Date);
    expect(r.notified).toBe(2);
    expect(feishu.sendCardMessage).toHaveBeenCalledTimes(2);
    // 卡片按钮带 cycle
    expect(JSON.stringify(feishu.sendCardMessage.mock.calls[0][1])).toContain('cycle=qc_q3');
  });

  it('存在未 scored 的 enrolled 任务 → 不召集，不改状态、不发卡', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const d = baseData({
      tasks: [
        { taskUid: 'qt_a', cycleUid: 'qc_q3', enrolled: true, mgmtRequired: true, stage: 'scored' },
        { taskUid: 'qt_b', cycleUid: 'qc_q3', enrolled: true, mgmtRequired: false, stage: 'pending_mgmt' },
      ],
    });
    const { db, updates } = makeDb(d);
    const r = await runConvenePanelCheck({ now: NOW, db: db as any, feishu });
    expect(r.convened).toBe(0);
    expect(updates).toHaveLength(0);
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });

  it('周期无 enrolled 任务 → 不召集（保守：至少一条参评任务且全 scored）', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const d = baseData({ tasks: [{ taskUid: 'qt_skip', cycleUid: 'qc_q3', enrolled: false, stage: 'pending_self' }] });
    const { db, updates } = makeDb(d);
    const r = await runConvenePanelCheck({ now: NOW, db: db as any, feishu });
    expect(r.convened).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('dry-run：计数但不改状态、不发卡', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const { db, updates } = makeDb(baseData());
    const r = await runConvenePanelCheck({ now: NOW, dryRun: true, db: db as any, feishu });
    expect(r.convened).toBe(1);
    expect(r.notified).toBe(2);
    expect(updates).toHaveLength(0);
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });

  it('无 scoring 周期 → 空转', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const { db, updates } = makeDb(baseData({ cycles: [] }));
    const r = await runConvenePanelCheck({ now: NOW, db: db as any, feishu });
    expect(r.cyclesChecked).toBe(0);
    expect(r.convened).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('无管理层成员 → 仍召集（转 panel）但发 0 张卡', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const { db, updates } = makeDb(baseData({ mgmt: [] }));
    const r = await runConvenePanelCheck({ now: NOW, db: db as any, feishu });
    expect(r.convened).toBe(1);
    expect(updates).toHaveLength(1);
    expect(r.notified).toBe(0);
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });
});
