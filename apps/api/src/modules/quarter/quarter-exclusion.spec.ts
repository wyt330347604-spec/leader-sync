import { describe, it, expect } from 'vitest';
import { computeMgmtExclusions, type MgmtMember, type DeptNode, type OrgNode } from './quarter-exclusion';

// 管理层评分「关联的一级部门领导除外」规则（spec §2.3 §4）：
//   排除 = 被评人一级部门 leader + 被评人直属 + 被评人本人；
//   部门数据缺失 → 回退「管理链上的管理层成员全排除」。

function mgmt(userId: string, openId: string | null = null, name = userId): MgmtMember {
  return { raterUserId: userId, raterName: name, idForms: [userId, ...(openId ? [openId] : [])] };
}

describe('computeMgmtExclusions', () => {
  it('一级部门规则：排除该部门 leader + 直属 + 本人，其余管理层入选', () => {
    const depts = new Map<string, DeptNode>([
      ['d_root', { deptId: 'd_root', parentDeptId: '0', leaderUserId: 'ou_ceo', level: 0 }],
      ['d_tech', { deptId: 'd_tech', parentDeptId: 'd_root', leaderUserId: 'ou_cto', level: 1 }],
      ['d_be', { deptId: 'd_be', parentDeptId: 'd_tech', leaderUserId: 'ou_belead', level: 2 }],
    ]);
    const orgByAnyId = new Map<string, OrgNode>();
    const result = computeMgmtExclusions({
      ratee: { userId: 'ou_alice', openId: 'ou_alice', managerUserId: 'ou_belead', deptId: 'd_be' },
      management: [mgmt('ou_cto'), mgmt('ou_belead'), mgmt('ou_ceo'), mgmt('ou_pm')],
      deptsById: depts,
      orgByAnyId,
    });
    expect(result.rule).toBe('first_level_dept');
    // 一级部门 = d_tech（其父是 root）→ 排除 ou_cto；直属 ou_belead；本人非管理层
    expect(result.raterIds.sort()).toEqual(['ou_ceo', 'ou_pm']);
    expect(result.excludedIds.sort()).toEqual(['ou_belead', 'ou_cto']);
  });

  it('本人若在管理层名单中也排除自评自己', () => {
    const depts = new Map<string, DeptNode>([
      ['d_root', { deptId: 'd_root', parentDeptId: '0', leaderUserId: null, level: 0 }],
      ['d_tech', { deptId: 'd_tech', parentDeptId: 'd_root', leaderUserId: 'ou_cto', level: 1 }],
    ]);
    const result = computeMgmtExclusions({
      ratee: { userId: 'ou_selfmgmt', openId: 'ou_selfmgmt', managerUserId: 'ou_boss', deptId: 'd_tech' },
      management: [mgmt('ou_cto'), mgmt('ou_selfmgmt'), mgmt('ou_pm')],
      deptsById: depts,
      orgByAnyId: new Map(),
    });
    // 一级部门 = d_tech，leader ou_cto 排除；本人 ou_selfmgmt 排除；直属 ou_boss 不在管理层
    expect(result.raterIds).toEqual(['ou_pm']);
    expect(result.excludedIds.sort()).toEqual(['ou_cto', 'ou_selfmgmt']);
  });

  it('open_id 与 user_id 双命名空间：任一形态命中即排除', () => {
    const depts = new Map<string, DeptNode>([
      ['d_root', { deptId: 'd_root', parentDeptId: '0', leaderUserId: null, level: 0 }],
      ['d_tech', { deptId: 'd_tech', parentDeptId: 'd_root', leaderUserId: 'emp_cto', level: 1 }],
    ]);
    // 管理层成员以 open_id 记，但一级部门 leader 用的是员工 user_id
    const result = computeMgmtExclusions({
      ratee: { userId: 'ou_alice', openId: 'ou_alice', managerUserId: null, deptId: 'd_tech' },
      management: [mgmt('ou_cto', 'emp_cto'), mgmt('ou_pm', 'emp_pm')],
      deptsById: depts,
      orgByAnyId: new Map(),
    });
    expect(result.raterIds).toEqual(['ou_pm']);
    expect(result.excludedIds).toEqual(['ou_cto']);
  });

  it('部门数据缺失 → 回退管理链规则：排除链上的管理层成员', () => {
    // ratee 无 deptId；管理链 alice → belead → cto → ceo
    const orgByAnyId = new Map<string, OrgNode>([
      ['ou_belead', { userId: 'ou_belead', openId: 'ou_belead', managerUserId: 'ou_cto', deptId: null }],
      ['ou_cto', { userId: 'ou_cto', openId: 'ou_cto', managerUserId: 'ou_ceo', deptId: null }],
      ['ou_ceo', { userId: 'ou_ceo', openId: 'ou_ceo', managerUserId: null, deptId: null }],
    ]);
    const result = computeMgmtExclusions({
      ratee: { userId: 'ou_alice', openId: 'ou_alice', managerUserId: 'ou_belead', deptId: null },
      management: [mgmt('ou_cto'), mgmt('ou_ceo'), mgmt('ou_belead'), mgmt('ou_pm')],
      deptsById: new Map(),
      orgByAnyId,
    });
    expect(result.rule).toBe('manager_chain_fallback');
    // 链上管理层 belead/cto/ceo 全排除；ou_pm 不在链上 → 入选
    expect(result.raterIds).toEqual(['ou_pm']);
    expect(result.excludedIds.sort()).toEqual(['ou_belead', 'ou_ceo', 'ou_cto']);
  });

  it('一级部门无 leader → 回退管理链规则', () => {
    const depts = new Map<string, DeptNode>([
      ['d_root', { deptId: 'd_root', parentDeptId: '0', leaderUserId: null, level: 0 }],
      ['d_tech', { deptId: 'd_tech', parentDeptId: 'd_root', leaderUserId: null, level: 1 }],
    ]);
    const orgByAnyId = new Map<string, OrgNode>([
      ['ou_boss', { userId: 'ou_boss', openId: 'ou_boss', managerUserId: null, deptId: null }],
    ]);
    const result = computeMgmtExclusions({
      ratee: { userId: 'ou_alice', openId: 'ou_alice', managerUserId: 'ou_boss', deptId: 'd_tech' },
      management: [mgmt('ou_boss'), mgmt('ou_pm')],
      deptsById: depts,
      orgByAnyId,
    });
    expect(result.rule).toBe('manager_chain_fallback');
    expect(result.raterIds).toEqual(['ou_pm']);
    expect(result.excludedIds).toEqual(['ou_boss']);
  });
});
