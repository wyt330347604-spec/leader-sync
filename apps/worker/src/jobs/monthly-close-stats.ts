// 口径已收敛到 @leader-sync/shared-types（单一来源，被 api 驾驶舱共用）。
// 此文件保留为薄 re-export，兼容既有 import 路径与回归测试。
// DONE_STATUSES 是 TERMINAL_STATUSES 的历史别名。
import { TERMINAL_STATUSES } from '@leader-sync/shared-types';

export const DONE_STATUSES = TERMINAL_STATUSES;
export { clampRate, computeStats, cumulativeCounts, completionRate } from '@leader-sync/shared-types';
export type { MonthlyStats, CumulativeCounts } from '@leader-sync/shared-types';
