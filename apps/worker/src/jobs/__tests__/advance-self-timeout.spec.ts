import { describe, it, expect } from 'vitest';
import { runAdvanceSelfTimeout } from '../advance-self-timeout';

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

function makeDb(tasks: any[]) {
  const updates: { values: any }[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => thenable(tasks) }) }),
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

const NOW = new Date('2026-10-05T09:05:00.000Z'); // 自评截止 10/4 之后

function task(o: Record<string, unknown> = {}) {
  return {
    taskUid: 'qt_1',
    stage: 'pending_self',
    enrolled: true,
    selfSkipped: false,
    stageDeadlines: { self: '2026-10-04T00:00:00.000Z', peer_manager: '2026-10-09T00:00:00.000Z', mgmt: '2026-10-13T00:00:00.000Z' },
    ...o,
  };
}

describe('runAdvanceSelfTimeout', () => {
  it('自评超时 → self_skipped=true 且 stage 推进到 pending_peer_manager', async () => {
    const { db, updates } = makeDb([task()]);
    const r = await runAdvanceSelfTimeout({ now: NOW, db: db as any });
    expect(r.checked).toBe(1);
    expect(r.advanced).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ selfSkipped: true, stage: 'pending_peer_manager' });
  });

  it('未超时 → 不推进', async () => {
    const { db, updates } = makeDb([task({ stageDeadlines: { self: '2026-10-31T00:00:00.000Z' } })]);
    const r = await runAdvanceSelfTimeout({ now: NOW, db: db as any });
    expect(r.advanced).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('无 stage_deadlines → 跳过不报错', async () => {
    const { db, updates } = makeDb([task({ stageDeadlines: null })]);
    const r = await runAdvanceSelfTimeout({ now: NOW, db: db as any });
    expect(r.advanced).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('dry-run 不写库但计数', async () => {
    const { db, updates } = makeDb([task()]);
    const r = await runAdvanceSelfTimeout({ now: NOW, dryRun: true, db: db as any });
    expect(r.advanced).toBe(1);
    expect(updates).toHaveLength(0);
  });
});
