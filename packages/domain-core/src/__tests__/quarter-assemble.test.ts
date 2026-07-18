import { describe, it, expect } from 'vitest';
import { assembleQuarterMembers, type RawOrgRow, type RawPerfRoleRow } from '../quarter-planning';

function org(o: Partial<RawOrgRow>): RawOrgRow {
  return {
    userId: 'ou_x',
    openId: 'ou_x',
    userName: 'X',
    managerUserId: null,
    joinedAt: null,
    scoreExempt: false,
    leftAt: null,
    hiddenAt: null,
    ...o,
  };
}

describe('assembleQuarterMembers', () => {
  it('剔除 score_exempt，解析直属姓名，标记 leader 身份', () => {
    const orgRows: RawOrgRow[] = [
      org({ userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' }),
      org({ userId: 'ou_lead', openId: 'ou_lead', userName: 'Lead', managerUserId: 'ou_boss' }),
      org({ userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null, scoreExempt: true }),
    ];
    const perfRoles: RawPerfRoleRow[] = [
      { userId: 'ou_lead', openId: 'ou_lead', isLeader: true },
    ];
    const members = assembleQuarterMembers({ orgRows, perfRoles, peers: [] });

    // boss 被豁免，不入 ratee 名单
    expect(members.map((m) => m.userId).sort()).toEqual(['ou_alice', 'ou_lead']);
    const alice = members.find((m) => m.userId === 'ou_alice')!;
    expect(alice.isLeader).toBe(false);
    expect(alice.managerUserId).toBe('ou_boss');
    expect(alice.managerName).toBe('Boss'); // 直属姓名从 org 查找解析（即便直属被豁免评分也要能查名）
    const lead = members.find((m) => m.userId === 'ou_lead')!;
    expect(lead.isLeader).toBe(true);
  });

  it('同一人 emp_ 行 + ou_ 行按 open_id 去重为一名成员，字段取非空合并', () => {
    const orgRows: RawOrgRow[] = [
      org({ userId: 'emp_10001', openId: 'ou_alice', userName: '张三', managerUserId: 'ou_boss', joinedAt: null }),
      org({ userId: 'ou_alice', openId: 'ou_alice', userName: null, managerUserId: null, joinedAt: new Date('2021-01-01') }),
      org({ userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss' }),
    ];
    const members = assembleQuarterMembers({ orgRows, perfRoles: [], peers: [] });
    const alice = members.find((m) => m.userId === 'ou_alice');
    expect(alice).toBeTruthy();
    // 去重后只有 alice + boss 两人
    expect(members).toHaveLength(2);
    expect(alice!.name).toBe('张三'); // 取非空
    expect(alice!.managerUserId).toBe('ou_boss'); // 取非空
    expect(alice!.joinedAt?.toISOString().slice(0, 10)).toBe('2021-01-01');
  });

  it('指定同事从 peer_assignment 解析（按被评人规范 id）', () => {
    const orgRows: RawOrgRow[] = [
      org({ userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' }),
      org({ userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss' }),
    ];
    const members = assembleQuarterMembers({
      orgRows,
      perfRoles: [],
      peers: [{ rateeUserId: 'ou_alice', peerUserId: 'ou_bob', peerName: 'Bob' }],
    });
    const alice = members.find((m) => m.userId === 'ou_alice')!;
    expect(alice.peerUserId).toBe('ou_bob');
    expect(alice.peerName).toBe('Bob');
  });

  it('剔除离职（left_at）/隐藏（hidden_at）成员，对齐月度口径；直属仍可查名', () => {
    const orgRows: RawOrgRow[] = [
      org({ userId: 'ou_alice', openId: 'ou_alice', userName: 'Alice', managerUserId: 'ou_boss' }),
      org({
        userId: 'ou_left',
        openId: 'ou_left',
        userName: 'Left',
        managerUserId: 'ou_boss',
        leftAt: new Date('2026-06-01'),
      }),
      org({
        userId: 'ou_hidden',
        openId: 'ou_hidden',
        userName: 'Hidden',
        managerUserId: 'ou_boss',
        hiddenAt: new Date('2026-06-15'),
      }),
      org({ userId: 'ou_boss', openId: 'ou_boss', userName: 'Boss', managerUserId: null }),
    ];
    const members = assembleQuarterMembers({ orgRows, perfRoles: [], peers: [] });

    // 只剩在职未隐藏的 alice + boss；离职/隐藏成员不进花名册
    expect(members.map((m) => m.userId).sort()).toEqual(['ou_alice', 'ou_boss']);
    const alice = members.find((m) => m.userId === 'ou_alice')!;
    expect(alice.managerName).toBe('Boss');
  });
});
