import { describe, it, expect } from 'vitest';
import { computeQuarterStage, computeSheetLock } from './quarter-logic';

// ── 串行门控状态推导（spec §3.3 §5，Harvey 补充：串行打分） ──────────────────
describe('computeQuarterStage', () => {
  const base = {
    selfSubmitted: false,
    selfSkipped: false,
    managerSheetExists: true,
    managerSubmitted: false,
    peerSheetExists: true,
    peerSubmitted: false,
    mgmtRequired: false,
  };

  it('自评未完成 → pending_self', () => {
    expect(computeQuarterStage(base)).toBe('pending_self');
  });

  it('自评提交后解锁同事+直属 → pending_peer_manager', () => {
    expect(computeQuarterStage({ ...base, selfSubmitted: true })).toBe('pending_peer_manager');
  });

  it('自评超时跳过也算完成，解锁下一环 → pending_peer_manager', () => {
    expect(computeQuarterStage({ ...base, selfSkipped: true })).toBe('pending_peer_manager');
  });

  it('无 mgmt 员工：直属+同事都提交 → scored', () => {
    expect(
      computeQuarterStage({ ...base, selfSubmitted: true, managerSubmitted: true, peerSubmitted: true }),
    ).toBe('scored');
  });

  it('无 mgmt 员工：仅直属提交（同事未提交）→ 仍 pending_peer_manager', () => {
    expect(
      computeQuarterStage({ ...base, selfSubmitted: true, managerSubmitted: true, peerSubmitted: false }),
    ).toBe('pending_peer_manager');
  });

  it('无 peer sheet（未指定同事）时，直属提交即 scored', () => {
    expect(
      computeQuarterStage({
        ...base,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSheetExists: false,
      }),
    ).toBe('scored');
  });

  it('mgmt_required：直属提交后解锁管理层 → pending_mgmt（不等同事）', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: false,
      }),
    ).toBe('pending_mgmt');
  });

  it('mgmt_required：直属未提交 → pending_peer_manager', () => {
    expect(
      computeQuarterStage({ ...base, mgmtRequired: true, selfSubmitted: true }),
    ).toBe('pending_peer_manager');
  });

  it('mgmt_required：管理层 sheet 全部提交 + 同事已提交 → scored', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: true,
        mgmtSheetsExist: true,
        allMgmtSubmitted: true,
      }),
    ).toBe('scored');
  });

  it('mgmt_required：管理层 sheet 存在但未全部提交 → 仍 pending_mgmt', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: true,
        mgmtSheetsExist: true,
        allMgmtSubmitted: false,
      }),
    ).toBe('pending_mgmt');
  });

  it('mgmt_required：管理层已全提交但同事未提交 → 仍 pending_mgmt（等同事）', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: false,
        mgmtSheetsExist: true,
        allMgmtSubmitted: true,
      }),
    ).toBe('pending_mgmt');
  });

  it('mgmt_required：直属刚提交、管理层 sheet 尚未建 → pending_mgmt', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: true,
        mgmtSheetsExist: false,
      }),
    ).toBe('pending_mgmt');
  });

  // ── 硬化3 · 同事超时放行：peer_skipped 视同「同事已完成」参与门控 ──
  it('硬化3：无 mgmt 员工，直属已交 + 同事超时放行(peer_skipped) → scored', () => {
    expect(
      computeQuarterStage({
        ...base,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: false,
        peerSkipped: true,
      }),
    ).toBe('scored');
  });

  it('硬化3：mgmt_required，管理层全提交 + 同事超时放行 → scored（不再等同事）', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: false,
        peerSkipped: true,
        mgmtSheetsExist: true,
        allMgmtSubmitted: true,
      }),
    ).toBe('scored');
  });

  // ── 硬化2 · 管理层全排除回退：mgmtRatersEmpty 时按无 mgmt 路径走 ──
  it('硬化2：mgmt_required 但管理层评分人全排除(mgmtRatersEmpty) → 直属+同事完成即 scored', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        mgmtRatersEmpty: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: true,
      }),
    ).toBe('scored');
  });

  it('硬化2：mgmt_required + 全排除，直属已交但同事未完成 → pending_peer_manager（等同事，不进 pending_mgmt）', () => {
    expect(
      computeQuarterStage({
        ...base,
        mgmtRequired: true,
        mgmtRatersEmpty: true,
        selfSubmitted: true,
        managerSubmitted: true,
        peerSubmitted: false,
      }),
    ).toBe('pending_peer_manager');
  });
});

// ── 单张 sheet 的锁定门控 ────────────────────────────────────────────────────
describe('computeSheetLock', () => {
  it('self：pending_self 阶段解锁', () => {
    expect(computeSheetLock('self', 'pending_self', false).locked).toBe(false);
  });
  it('self：已过自评阶段则锁定', () => {
    const r = computeSheetLock('self', 'pending_peer_manager', false);
    expect(r.locked).toBe(true);
    expect(r.reason).toBeTruthy();
  });
  it('manager：pending_self 时锁定（等自评）', () => {
    const r = computeSheetLock('manager', 'pending_self', false);
    expect(r.locked).toBe(true);
    expect(r.reason).toContain('自评');
  });
  it('manager：pending_peer_manager 时解锁', () => {
    expect(computeSheetLock('manager', 'pending_peer_manager', false).locked).toBe(false);
  });
  it('peer：pending_self 时锁定，pending_peer_manager 时解锁', () => {
    expect(computeSheetLock('peer', 'pending_self', false).locked).toBe(true);
    expect(computeSheetLock('peer', 'pending_peer_manager', false).locked).toBe(false);
  });
  it('management：仅 pending_mgmt 解锁', () => {
    expect(computeSheetLock('management', 'pending_peer_manager', false).locked).toBe(true);
    expect(computeSheetLock('management', 'pending_mgmt', false).locked).toBe(false);
    expect(computeSheetLock('management', 'pending_self', false).reason).toContain('直属');
  });
});
