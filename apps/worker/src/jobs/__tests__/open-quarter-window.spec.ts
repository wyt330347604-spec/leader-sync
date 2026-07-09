import { describe, it, expect, vi } from 'vitest';
import { runOpenQuarterWindow } from '../open-quarter-window';
import { quarterCycle, quarterTask, quarterSheet, orgCache, perfRole, peerAssignment, scoreTemplate } from '@leader-sync/db';

/** thenable 代理（支持链式 .where/.onConflictDoNothing 等并可 await），与 score-window.spec 同款。 */
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
  cycles?: any[];
  orgRows: any[];
  perfRoles?: any[];
  peers?: any[];
  templates?: any[];
  existingTasks?: any[];
}

function makeDb(data: DbData) {
  const inserted: Record<string, any[]> = { quarter_cycle: [], quarter_task: [], quarter_sheet: [] };
  const db = {
    select: () => ({
      from: (tbl: any) =>
        thenable(
          tbl === quarterCycle
            ? data.cycles ?? []
            : tbl === orgCache
              ? data.orgRows
              : tbl === perfRole
                ? data.perfRoles ?? []
                : tbl === peerAssignment
                  ? data.peers ?? []
                  : tbl === scoreTemplate
                    ? data.templates ?? []
                    : tbl === quarterTask
                      ? data.existingTasks ?? []
                      : [],
        ),
    }),
    insert: (tbl: any) => ({
      values: (v: any) => {
        const key =
          tbl === quarterCycle ? 'quarter_cycle' : tbl === quarterTask ? 'quarter_task' : 'quarter_sheet';
        inserted[key].push(...(Array.isArray(v) ? v : [v]));
        return thenable(undefined);
      },
    }),
  };
  return { db, inserted };
}

const QUARTER_TEMPLATES = [
  { templateUid: 'spt_q_emp', code: 'quarterly_employee', active: true },
  { templateUid: 'spt_q_leader', code: 'quarterly_leader', active: true },
];

// 10/1 08:05 → 刚结束的 Q3
const OCT1 = new Date('2026-10-01T00:05:00.000Z');

describe('runOpenQuarterWindow', () => {
  it('按 now 算出 Q3，建 cycle + 生成任务/打分表（leader/员工模板 + mgmt_required + 无 manager 计数）', async () => {
    const { db, inserted } = makeDb({
      cycles: [], // 无既有周期
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
        { userId: 'ou_lead', openId: 'ou_lead', userName: 'Lead', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
        { userId: 'ou_orphan', openId: 'ou_orphan', userName: 'Orphan', managerUserId: null, joinedAt: new Date('2020-01-01'), scoreExempt: false },
        { userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null, joinedAt: new Date('2019-01-01'), scoreExempt: true },
      ],
      perfRoles: [{ userId: 'ou_lead', openId: 'ou_lead', isLeader: true, isManagement: false }],
      templates: QUARTER_TEMPLATES,
      existingTasks: [],
    });

    const r = await runOpenQuarterWindow({ now: OCT1, db: db as any });

    expect(r.quarter).toBe('2026-Q3');
    expect(r.cycleCreated).toBe(true);
    expect(inserted.quarter_cycle).toHaveLength(1);
    // 3 名参评（boss 豁免）
    expect(r.taskCount).toBe(3);
    expect(inserted.quarter_task).toHaveLength(3);
    const lead = inserted.quarter_task.find((t) => t.rateeUserId === 'ou_lead');
    expect(lead.templateUid).toBe('spt_q_leader');
    expect(lead.mgmtRequired).toBe(true);
    const alice = inserted.quarter_task.find((t) => t.rateeUserId === 'ou_alice');
    expect(alice.templateUid).toBe('spt_q_emp');
    expect(alice.mgmtRequired).toBe(false);
    // orphan 无 manager → noManager 计数
    expect(r.noManager).toBe(1);
    // sheet：alice self+manager, lead self+manager, orphan self（无 manager）= 5
    expect(inserted.quarter_sheet).toHaveLength(5);
  });

  it('dry-run 不写库但返回将生成的数量', async () => {
    const { db, inserted } = makeDb({
      cycles: [],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
      ],
      templates: QUARTER_TEMPLATES,
    });
    const r = await runOpenQuarterWindow({ now: OCT1, dryRun: true, db: db as any });
    expect(r.dryRun).toBe(true);
    expect(r.taskCount).toBe(1);
    expect(inserted.quarter_cycle).toHaveLength(0);
    expect(inserted.quarter_task).toHaveLength(0);
    expect(inserted.quarter_sheet).toHaveLength(0);
  });

  it('显式 quarter 覆盖 now 推算', async () => {
    const { db } = makeDb({ cycles: [], orgRows: [], templates: QUARTER_TEMPLATES });
    const r = await runOpenQuarterWindow({ now: OCT1, quarter: '2026-Q2', dryRun: true, db: db as any });
    expect(r.quarter).toBe('2026-Q2');
  });

  it('幂等：cycle 已存在 + alice 任务已存在 → 只补缺失任务，复用已存在 task 的 uid 建 sheet', async () => {
    const { db, inserted } = makeDb({
      cycles: [{ cycleUid: 'qc_exist', quarter: '2026-Q3', openAt: new Date('2026-10-01') }],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
        { userId: 'ou_bob', openId: 'ou_bob', userName: 'Bob', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
      ],
      templates: QUARTER_TEMPLATES,
      existingTasks: [{ taskUid: 'qt_alice_exist', cycleUid: 'qc_exist', rateeUserId: 'ou_alice' }],
    });
    const r = await runOpenQuarterWindow({ now: OCT1, db: db as any });
    expect(r.cycleCreated).toBe(false);
    // 只新建 bob 任务
    expect(inserted.quarter_task).toHaveLength(1);
    expect(inserted.quarter_task[0].rateeUserId).toBe('ou_bob');
    // alice 的 sheet 用既有 taskUid
    const aliceSheets = inserted.quarter_sheet.filter((s) => s.rateeUserId === 'ou_alice');
    expect(aliceSheets.every((s) => s.taskUid === 'qt_alice_exist')).toBe(true);
  });

  it('sendCards=true：开窗给每个参评被评人发「待自评」卡片（按自评 sheet 跳打分页）', async () => {
    const feishu = { sendCardMessage: vi.fn().mockResolvedValue(undefined) };
    const { db } = makeDb({
      cycles: [],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
        { userId: 'ou_new', openId: 'ou_new', userName: 'Newbie', managerUserId: 'ou_boss', joinedAt: OCT1, scoreExempt: false },
      ],
      templates: QUARTER_TEMPLATES,
    });
    const r = await runOpenQuarterWindow({ now: OCT1, db: db as any, sendCards: true, feishu });
    // alice 参评发卡；new 新人不足 2 完整月不参评 → 不发
    expect(feishu.sendCardMessage).toHaveBeenCalledTimes(1);
    expect(feishu.sendCardMessage.mock.calls[0][0]).toBe('ou_alice');
    expect(JSON.stringify(feishu.sendCardMessage.mock.calls[0][1])).toContain('自评');
    expect(r.cardsSent).toBe(1);
  });

  it('sendCards 默认 false：不发卡（既有行为不变）', async () => {
    const feishu = { sendCardMessage: vi.fn() };
    const { db } = makeDb({
      cycles: [],
      orgRows: [
        { userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss', joinedAt: new Date('2020-01-01'), scoreExempt: false },
      ],
      templates: QUARTER_TEMPLATES,
    });
    await runOpenQuarterWindow({ now: OCT1, db: db as any, feishu });
    expect(feishu.sendCardMessage).not.toHaveBeenCalled();
  });
});
