import { describe, it, expect } from 'vitest';
import {
  quarterBounds,
  quarterForDate,
  previousQuarter,
  endedQuarterOn,
  halfForQuarter,
  quartersForHalf,
  planQuarterTasks,
  DEFAULT_STAGE_OFFSETS,
  type QuarterMemberInput,
} from '../quarter-planning';
import { InvalidQuarterFormatError, InvalidHalfFormatError } from '../perf-scoring';

// ── 日期与季度换算（全 UTC） ──────────────────────────────────────────────
describe('quarterBounds', () => {
  it('Q3 2026 = 7/1 – 9/30', () => {
    const b = quarterBounds('2026-Q3');
    expect(b.start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(b.end.toISOString().slice(0, 10)).toBe('2026-09-30');
  });
  it('Q1 2026 = 1/1 – 3/31（含闰月边界）', () => {
    const b = quarterBounds('2026-Q1');
    expect(b.start.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(b.end.toISOString().slice(0, 10)).toBe('2026-03-31');
  });
  it('非法格式抛 InvalidQuarterFormatError', () => {
    expect(() => quarterBounds('2026-Q5')).toThrow(InvalidQuarterFormatError);
    expect(() => quarterBounds('nope')).toThrow(InvalidQuarterFormatError);
  });
});

describe('quarterForDate', () => {
  it('10 月 1 日属于 Q4', () => {
    expect(quarterForDate(new Date('2026-10-01T08:05:00.000Z'))).toBe('2026-Q4');
  });
  it('7 月 1 日属于 Q3', () => {
    expect(quarterForDate(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-Q3');
  });
});

describe('previousQuarter', () => {
  it('Q3 → Q2', () => expect(previousQuarter('2026-Q3')).toBe('2026-Q2'));
  it('Q1 → 上一年 Q4', () => expect(previousQuarter('2026-Q1')).toBe('2025-Q4'));
});

describe('endedQuarterOn', () => {
  it('季度结束次日（10/1）算出刚结束的 Q3', () => {
    expect(endedQuarterOn(new Date('2026-10-01T08:05:00.000Z'))).toBe('2026-Q3');
  });
  it('1/1 算出上一年 Q4', () => {
    expect(endedQuarterOn(new Date('2027-01-01T08:05:00.000Z'))).toBe('2026-Q4');
  });
});

describe('halfForQuarter', () => {
  it('Q3/Q4 → 下半年 H2', () => {
    expect(halfForQuarter('2026-Q3')).toBe('2026-H2');
    expect(halfForQuarter('2026-Q4')).toBe('2026-H2');
  });
  it('Q1/Q2 → 上半年 H1', () => {
    expect(halfForQuarter('2026-Q1')).toBe('2026-H1');
    expect(halfForQuarter('2026-Q2')).toBe('2026-H1');
  });
});

describe('quartersForHalf', () => {
  it('H1 → 前季 Q1、后季 Q2', () => {
    expect(quartersForHalf('2026-H1')).toEqual({ prev: '2026-Q1', curr: '2026-Q2' });
  });
  it('H2 → 前季 Q3、后季 Q4', () => {
    expect(quartersForHalf('2026-H2')).toEqual({ prev: '2026-Q3', curr: '2026-Q4' });
  });
  it('非法格式抛 InvalidHalfFormatError', () => {
    expect(() => quartersForHalf('2026-H3')).toThrow(InvalidHalfFormatError);
    expect(() => quartersForHalf('2026-Q1')).toThrow(InvalidHalfFormatError);
    expect(() => quartersForHalf('nope')).toThrow(InvalidHalfFormatError);
  });
});

// ── 任务规划（纯函数，worker 开窗 + API 手动开周期共用） ───────────────────
const OPEN_AT = new Date('2026-10-01T00:00:00.000Z');

function member(overrides: Partial<QuarterMemberInput> = {}): QuarterMemberInput {
  return {
    userId: 'ou_alice',
    name: 'Alice',
    joinedAt: new Date('2020-01-01T00:00:00.000Z'), // 老员工，必参评
    isLeader: false,
    managerUserId: 'ou_boss',
    managerName: 'Boss',
    peerUserId: 'ou_bob',
    peerName: 'Bob',
    ...overrides,
  };
}

function planOne(m: QuarterMemberInput) {
  return planQuarterTasks({
    quarter: '2026-Q3',
    openAt: OPEN_AT,
    members: [m],
    employeeTemplateUid: 'spt_q_emp',
    leaderTemplateUid: 'spt_q_leader',
  })[0];
}

describe('planQuarterTasks', () => {
  it('员工默认：employee 模板、mgmt_required=false、三张 sheet（self/manager/peer）', () => {
    const t = planOne(member());
    expect(t.sheetType).toBe('employee');
    expect(t.templateUid).toBe('spt_q_emp');
    expect(t.mgmtRequired).toBe(false);
    expect(t.enrolled).toBe(true);
    expect(t.stage).toBe('pending_self');
    const roles = t.sheets.map((s) => s.raterRole).sort();
    expect(roles).toEqual(['manager', 'peer', 'self']);
    const self = t.sheets.find((s) => s.raterRole === 'self')!;
    expect(self.raterUserId).toBe('ou_alice'); // 自评人 = 被评人本人
    const mgr = t.sheets.find((s) => s.raterRole === 'manager')!;
    expect(mgr.raterUserId).toBe('ou_boss');
    const peer = t.sheets.find((s) => s.raterRole === 'peer')!;
    expect(peer.raterUserId).toBe('ou_bob');
    expect(t.warnings).toEqual([]);
  });

  it('leader：leader 模板、mgmt_required 恒 true', () => {
    const t = planOne(member({ isLeader: true }));
    expect(t.sheetType).toBe('leader');
    expect(t.templateUid).toBe('spt_q_leader');
    expect(t.mgmtRequired).toBe(true);
  });

  it('员工被勾选进管理层评分：mgmt_required=true 且保留理由', () => {
    const t = planOne(member({ mgmtRequiredOverride: true, mgmtReason: '晋级申请' }));
    expect(t.mgmtRequired).toBe(true);
    expect(t.mgmtReason).toBe('晋级申请');
  });

  it('无直属：warning no-manager，且不建 manager sheet', () => {
    const t = planOne(member({ managerUserId: null, managerName: null }));
    expect(t.warnings).toContain('no-manager');
    expect(t.sheets.some((s) => s.raterRole === 'manager')).toBe(false);
    expect(t.sheets.map((s) => s.raterRole).sort()).toEqual(['peer', 'self']);
  });

  it('未指定同事：warning no-peer，任务照建但缺 peer sheet', () => {
    const t = planOne(member({ peerUserId: null, peerName: null }));
    expect(t.warnings).toContain('no-peer');
    expect(t.sheets.some((s) => s.raterRole === 'peer')).toBe(false);
  });

  it('新人不足 2 完整月：enrolled=false、skip_reason、无 sheet', () => {
    // 入职 2026-09（季度最后一个月）→ 完整月 0
    const t = planOne(member({ joinedAt: new Date('2026-09-05T00:00:00.000Z') }));
    expect(t.enrolled).toBe(false);
    expect(t.skipReason).toBeTruthy();
    expect(t.sheets).toEqual([]);
  });

  it('stage_deadlines 按 openAt + 默认偏移（self+3 / peer_manager+8 / mgmt+12 天）', () => {
    const t = planOne(member());
    expect(t.stageDeadlines.self).toBe('2026-10-04T00:00:00.000Z');
    expect(t.stageDeadlines.peer_manager).toBe('2026-10-09T00:00:00.000Z');
    expect(t.stageDeadlines.mgmt).toBe('2026-10-13T00:00:00.000Z');
    expect(DEFAULT_STAGE_OFFSETS).toEqual({ self: 3, peerManager: 8, mgmt: 12 });
  });

  it('模板未 seed 时 templateUid 透传 null，不抛错', () => {
    const t = planQuarterTasks({
      quarter: '2026-Q3',
      openAt: OPEN_AT,
      members: [member()],
      employeeTemplateUid: null,
      leaderTemplateUid: null,
    })[0];
    expect(t.templateUid).toBeNull();
  });
});
