// 季度串行门控的纯推导逻辑（无 I/O，可单测）
// 依据：spec 2026-07-08 performance-review-module §3.3 §5（Harvey 补充：串行打分）
//   pending_self → pending_peer_manager → pending_mgmt → scored
//   自评提交/超时(self_skipped) → 解锁 同事+直属；直属提交 → mgmt_required ? pending_mgmt : (同事也完成 ? scored : 维持)
//   无 mgmt 员工：直属+同事都提交即 scored。

export type QuarterStage = 'pending_self' | 'pending_peer_manager' | 'pending_mgmt' | 'scored';
export type QuarterSheetRole = 'self' | 'manager' | 'peer' | 'management';

export interface StageInput {
  selfSubmitted: boolean;
  selfSkipped: boolean;
  managerSheetExists: boolean;
  managerSubmitted: boolean;
  peerSheetExists: boolean;
  peerSubmitted: boolean;
  // 硬化3 · 同事超时放行：peer_skipped 视同「同事已完成」参与门控。省略=false。
  peerSkipped?: boolean;
  mgmtRequired: boolean;
  // 硬化2 · 管理层全排除回退：排除规则算完管理层评分人为空时置 true，
  //   本任务按「无 mgmt」路径走（不进 pending_mgmt，直属+同事完成即 scored）。省略=false。
  mgmtRatersEmpty?: boolean;
  // 管理层环节收口（P3）：直属提交后建管理层 sheet；这些 sheet 全部提交 + 同事已完成 → scored。
  // 兼容 P2：省略时按「未建/未全提交」处理，行为不变（停在 pending_mgmt）。
  mgmtSheetsExist?: boolean;
  allMgmtSubmitted?: boolean;
}

/**
 * 由已提交/存在的 sheet 集合推导 task.stage（幂等，每次提交后重算）。
 * 缺失的 sheet（无直属/未指定同事）视为该环节"无需等待"，不阻塞推进。
 * 硬化3：同事超时放行(peer_skipped) 视同同事已完成。
 * 硬化2：管理层评分人全排除(mgmtRatersEmpty) 时，本任务退化为「无 mgmt」路径。
 */
export function computeQuarterStage(i: StageInput): QuarterStage {
  const selfDone = i.selfSubmitted || i.selfSkipped;
  if (!selfDone) return 'pending_self';

  const managerDone = !i.managerSheetExists || i.managerSubmitted;
  const peerDone = !i.peerSheetExists || i.peerSubmitted || Boolean(i.peerSkipped);
  const mgmtActive = i.mgmtRequired && !i.mgmtRatersEmpty;

  if (mgmtActive) {
    // 管理层在直属提交后解锁（不等同事）
    if (!managerDone) return 'pending_peer_manager';
    // 管理层 sheet 全部提交 + 同事也完成 → scored；否则停在管理层窗口。
    if (i.mgmtSheetsExist && i.allMgmtSubmitted && peerDone) return 'scored';
    return 'pending_mgmt';
  }
  return managerDone && peerDone ? 'scored' : 'pending_peer_manager';
}

export interface SheetLock {
  locked: boolean;
  reason: string | null;
}

const UNLOCKED: SheetLock = { locked: false, reason: null };

/**
 * 单张 sheet 是否被串行门控锁定（用于提交校验 + my-tasks 展示）。
 *   self：仅 pending_self 可填；
 *   manager/peer：pending_self 时锁定（等自评），其后解锁；
 *   management：仅 pending_mgmt 可填（等直属）。
 */
export function computeSheetLock(
  role: QuarterSheetRole,
  stage: QuarterStage,
  selfSkipped: boolean,
): SheetLock {
  switch (role) {
    case 'self':
      if (stage === 'pending_self') return UNLOCKED;
      return { locked: true, reason: selfSkipped ? '自评已超时，系统自动跳过' : '自评环节已结束' };
    case 'manager':
    case 'peer':
      if (stage === 'pending_self') return { locked: true, reason: '等待本人完成自评' };
      return UNLOCKED;
    case 'management':
      if (stage === 'pending_mgmt') return UNLOCKED;
      if (stage === 'pending_self' || stage === 'pending_peer_manager') {
        return { locked: true, reason: '等待直属完成打分' };
      }
      return { locked: true, reason: '管理层评分环节已结束' };
    default:
      return UNLOCKED;
  }
}
