import { describe, it, expect } from 'vitest';
import { quarterTask } from '@leader-sync/db';
import { runAdvancePeerTimeout } from '../advance-peer-timeout';

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

// select().from(table) 按表返回不同数据集（task vs sheet）；update() 记录写入。
function makeDb(tasks: any[], sheets: any[]) {
  const updates: { values: any }[] = [];
  const db = {
    select: () => ({
      from: (table: any) => ({
        where: () => thenable(table === quarterTask ? tasks : sheets),
      }),
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

const NOW = new Date('2026-10-10T09:10:00.000Z'); // 同事/直属截止 10/9 之后

function task(o: Record<string, unknown> = {}) {
  return {
    taskUid: 'qt_1',
    stage: 'pending_peer_manager',
    enrolled: true,
    peerSkipped: false,
    mgmtRequired: false,
    stageDeadlines: { self: '2026-10-04T00:00:00.000Z', peer_manager: '2026-10-09T00:00:00.000Z', mgmt: '2026-10-13T00:00:00.000Z' },
    ...o,
  };
}

describe('runAdvancePeerTimeout', () => {
  it('超时 + 非 mgmt + 直属已交 + 同事未交 → peer_skipped=true 且 stage=scored', async () => {
    const { db, updates } = makeDb(
      [task()],
      [
        { taskUid: 'qt_1', raterRole: 'manager', status: 'submitted' },
        { taskUid: 'qt_1', raterRole: 'peer', status: 'draft' },
      ],
    );
    const r = await runAdvancePeerTimeout({ now: NOW, db: db as any });
    expect(r.checked).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.scored).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ peerSkipped: true, stage: 'scored' });
  });

  it('超时 + mgmt_required（直属尚未提交）→ peer_skipped=true 但 stage 维持 pending_peer_manager', async () => {
    const { db, updates } = makeDb(
      [task({ mgmtRequired: true })],
      [
        { taskUid: 'qt_1', raterRole: 'manager', status: 'draft' },
        { taskUid: 'qt_1', raterRole: 'peer', status: 'draft' },
      ],
    );
    const r = await runAdvancePeerTimeout({ now: NOW, db: db as any });
    expect(r.skipped).toBe(1);
    expect(r.scored).toBe(0);
    expect(updates[0].values).toMatchObject({ peerSkipped: true, stage: 'pending_peer_manager' });
  });

  it('未超时 → 不放行', async () => {
    const { db, updates } = makeDb(
      [task({ stageDeadlines: { peer_manager: '2026-10-31T00:00:00.000Z' } })],
      [{ taskUid: 'qt_1', raterRole: 'peer', status: 'draft' }],
    );
    const r = await runAdvancePeerTimeout({ now: NOW, db: db as any });
    expect(r.skipped).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('未指定同事（无 peer sheet）→ 跳过不放行', async () => {
    const { db, updates } = makeDb([task()], [{ taskUid: 'qt_1', raterRole: 'manager', status: 'submitted' }]);
    const r = await runAdvancePeerTimeout({ now: NOW, db: db as any });
    expect(r.skipped).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('同事已提交 → 跳过不放行', async () => {
    const { db, updates } = makeDb(
      [task()],
      [
        { taskUid: 'qt_1', raterRole: 'manager', status: 'submitted' },
        { taskUid: 'qt_1', raterRole: 'peer', status: 'submitted' },
      ],
    );
    const r = await runAdvancePeerTimeout({ now: NOW, db: db as any });
    expect(r.skipped).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('已放行(peer_skipped=true) → 幂等不重复', async () => {
    const { db, updates } = makeDb(
      [task({ peerSkipped: true })],
      [{ taskUid: 'qt_1', raterRole: 'peer', status: 'draft' }],
    );
    const r = await runAdvancePeerTimeout({ now: NOW, db: db as any });
    expect(r.skipped).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('dry-run 不写库但计数', async () => {
    const { db, updates } = makeDb(
      [task()],
      [
        { taskUid: 'qt_1', raterRole: 'manager', status: 'submitted' },
        { taskUid: 'qt_1', raterRole: 'peer', status: 'draft' },
      ],
    );
    const r = await runAdvancePeerTimeout({ now: NOW, dryRun: true, db: db as any });
    expect(r.skipped).toBe(1);
    expect(r.scored).toBe(1);
    expect(updates).toHaveLength(0);
  });
});
