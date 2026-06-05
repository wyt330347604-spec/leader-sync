import { describe, it, expect, vi } from 'vitest';
import { runSyncOutbound } from '../sync-outbound';

// 自包含 mock db：覆盖 runSyncOutbound 用到的 select/insert/update/delete 链。
function makeMockDb(rows: any[], sink: { inserts: any[]; updates: any[]; deletes: number }) {
  return {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => { sink.inserts.push(v); return Promise.resolve(); },
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => { sink.updates.push(v); return Promise.resolve(); },
      }),
    }),
    delete: () => ({
      where: () => { sink.deletes++; return Promise.resolve(); },
    }),
  } as any;
}

function mkRow(overrides: { task?: any; mapping?: any } = {}) {
  return {
    task: {
      taskUid: 'task_x',
      title: 'T',
      status: 'in_progress',
      priority: 'urgent_important',
      taskType: 'new',
      monthBucket: '2026-06',
      assigneeUserId: 'ou_a',
      visibility: 'public',
      deletedAt: null,
      updatedAt: new Date('2026-06-03T00:00:00Z'),
      ...overrides.task,
    },
    mapping: overrides.mapping === null ? null : {
      id: 1,
      taskUid: 'task_x',
      externalObjectId: 'recOLD',
      lastSyncHash: 'STALE_HASH',   // 与计算出的 hash 不同 → 触发推送
      lastSyncAt: null,
      ...overrides.mapping,
    },
  };
}

describe('runSyncOutbound — RecordIdNotFound 自愈', () => {
  it('记录已删（RecordIdNotFound）→ 删除失效映射 + 重建，不再永久 failed', async () => {
    const sink = { inserts: [] as any[], updates: [] as any[], deletes: 0 };
    const db = makeMockDb([mkRow()], sink);
    const feishu = {
      updateBitableRecord: vi.fn().mockRejectedValue(new Error('Update record error: RecordIdNotFound')),
      createBitableRecords: vi.fn().mockResolvedValue(['recNEW']),
    };

    await runSyncOutbound({ db, feishu });

    // 旧映射被删
    expect(sink.deletes).toBe(1);
    // 重建：调 create + 插入新映射（指向 recNEW, success）
    expect(feishu.createBitableRecords).toHaveBeenCalledOnce();
    expect(sink.inserts).toHaveLength(1);
    expect(sink.inserts[0].externalObjectId).toBe('recNEW');
    expect(sink.inserts[0].syncStatus).toBe('success');
    // 不应再把映射置为 failed
    expect(sink.updates.some((u) => u.syncStatus === 'failed')).toBe(false);
  });

  it('其它错误（非 RecordIdNotFound）→ 仍标记 failed，不删不重建', async () => {
    const sink = { inserts: [] as any[], updates: [] as any[], deletes: 0 };
    const db = makeMockDb([mkRow()], sink);
    const feishu = {
      updateBitableRecord: vi.fn().mockRejectedValue(new Error('Update record error: InternalError')),
      createBitableRecords: vi.fn(),
    };

    await runSyncOutbound({ db, feishu });

    expect(sink.deletes).toBe(0);
    expect(feishu.createBitableRecords).not.toHaveBeenCalled();
    expect(sink.updates.some((u) => u.syncStatus === 'failed')).toBe(true);
  });

  it('无映射 → 正常新建记录 + 映射', async () => {
    const sink = { inserts: [] as any[], updates: [] as any[], deletes: 0 };
    const db = makeMockDb([mkRow({ mapping: null })], sink);
    const feishu = {
      updateBitableRecord: vi.fn(),
      createBitableRecords: vi.fn().mockResolvedValue(['recCREATED']),
    };

    await runSyncOutbound({ db, feishu });

    expect(feishu.updateBitableRecord).not.toHaveBeenCalled();
    expect(sink.inserts[0].externalObjectId).toBe('recCREATED');
  });
});
