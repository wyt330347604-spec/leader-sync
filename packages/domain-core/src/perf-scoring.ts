// 绩效计分引擎（纯函数，零 I/O、零 DB 依赖）
// 依据：docs/superpowers/specs/2026-07-08-performance-review-module.md §4 计分引擎 + §10 决策记录
// 约定：内部全精度计算，仅在对外输出的总分/综合系数处四舍五入；所有函数不修改入参。

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

// --- 常量（不写死于逻辑中，便于对照规格） ---
const RAW_MIN = 1;
const RAW_MAX = 10;
const RAW_SCALE = 10; // dim_score = raw / 10 × weight

// 软项合成权重（硬化1，Harvey 2026-07-08）：按「管理层在场 × 同事在场」四分支，
// 缺席方权重并入直属。四组权重之和恒为 1。
const W_MANAGER_BOTH = 0.55; // 管理层在 + 同事在：直属
const W_MGMT_BOTH = 0.35; //                    管理层
const W_PEER_BOTH = 0.1; //                      同事
const W_MANAGER_NO_PEER = 0.65; // 管理层在 + 同事缺：直属（吸收同事 0.10）
const W_MGMT_NO_PEER = 0.35; //                     管理层
const W_MANAGER_NO_MGMT = 0.9; // 管理层缺 + 同事在：直属（吸收管理层 0.35 中的份额）
const W_PEER_NO_MGMT = 0.1; //                     同事
const W_MANAGER_SOLO = 1.0; // 管理层缺 + 同事缺：直属独占

// 半年合成权重
const W_PREV_QUARTER = 0.4;
const W_CURR_QUARTER = 0.6;

const MAX_CONSECUTIVE_PEER_QUARTERS = 2; // 同一 peer 最多连续两季
const MIN_COMPLETE_MONTHS_TO_ENROLL = 2; // 新人 ≥2 完整月才参评

const QUARTER_PATTERN = /^(\d{4})-Q([1-4])$/;
const QUARTERS_PER_YEAR = 4;
const MONTHS_PER_YEAR = 12;

// --- 错误类型 ---
export class InvalidRawScoreError extends Error {
  constructor(raw: number) {
    super(`raw score must be an integer between ${RAW_MIN} and ${RAW_MAX}, got ${raw}`);
    this.name = 'InvalidRawScoreError';
  }
}

export class InvalidQuarterFormatError extends Error {
  constructor(quarter: string) {
    super(`quarter must match 'YYYY-QN' (N in 1-4), got "${quarter}"`);
    this.name = 'InvalidQuarterFormatError';
  }
}

export class InvalidHalfFormatError extends Error {
  constructor(half: string) {
    super(`half must match 'YYYY-HN' (N in 1-2), got "${half}"`);
    this.name = 'InvalidHalfFormatError';
  }
}

// --- 舍入辅助（半值进位；用指数字符串规避浮点表示误差） ---
function roundHalfUp(value: number, decimals: number): number {
  const shifted = Number(`${value}e${decimals}`);
  return Number(`${Math.round(shifted)}e${-decimals}`);
}

// =============== 月度 ===============

export interface MonthlyDimension {
  readonly coefficient: number; // 手写系数，1.0 以上不封顶
  readonly weight: number;
}

export interface MonthlyTotalResult {
  readonly total: number; // Σ(系数×权重)，可 >100，四舍五入 1 位小数
  readonly composite: number; // total / 100，四舍五入 2 位小数
}

/**
 * 月度总分与综合系数。
 * total = Σ(coefficient × weight)，可 >100；composite = total / 100（挂激励）。
 * 内部按全精度求和，仅在输出处舍入：total 1 位小数、composite 2 位小数。
 */
export function monthlyTotal(dims: readonly MonthlyDimension[]): MonthlyTotalResult {
  const rawTotal = dims.reduce((sum, d) => sum + d.coefficient * d.weight, 0);
  return {
    total: roundHalfUp(rawTotal, 1),
    composite: roundHalfUp(rawTotal / 100, 2),
  };
}

/**
 * 月度评级（Harvey 批边界）：红线→D；S total>100；A 90≤total≤100；
 * B 80≤total<90；C 70≤total<80；D total<70。
 */
export function monthlyGrade(total: number, redLine: boolean): Grade {
  if (redLine) return 'D';
  if (total > 100) return 'S';
  if (total >= 90) return 'A';
  if (total >= 80) return 'B';
  if (total >= 70) return 'C';
  return 'D';
}

// =============== 季度 ===============

export interface QuarterlyItem {
  readonly raw: number; // 1–10 整数
  readonly weight: number;
}

/**
 * 单个软项维度得分 = raw / 10 × weight。raw 必须为 [1,10] 整数，否则抛错。
 * 全精度返回，不在此处舍入。
 */
export function quarterlyDimScore(raw: number, weight: number): number {
  if (!Number.isInteger(raw) || raw < RAW_MIN || raw > RAW_MAX) {
    throw new InvalidRawScoreError(raw);
  }
  return (raw / RAW_SCALE) * weight;
}

/** 软项合计 = Σ quarterlyDimScore；任一 raw 越界则抛错。空项返回 0。 */
export function softSum(items: readonly QuarterlyItem[]): number {
  return items.reduce((sum, item) => sum + quarterlyDimScore(item.raw, item.weight), 0);
}

export interface MgmtSheet {
  readonly raterId: string;
  readonly softTotal: number;
}

/**
 * 管理层软项均值，排除 excludeIds 中的评分人（被评人管理链/一级部门 leader）。
 * 排除后为空返回 null。全精度返回，不在此处舍入。
 */
export function mgmtAverage(sheets: readonly MgmtSheet[], excludeIds: readonly string[]): number | null {
  const excluded = new Set(excludeIds);
  const kept = sheets.filter((s) => !excluded.has(s.raterId));
  if (kept.length === 0) return null;
  const sum = kept.reduce((acc, s) => acc + s.softTotal, 0);
  return sum / kept.length;
}

export interface MergeSoftInput {
  readonly manager: number;
  readonly mgmt: number | null; // null = 管理层缺席（区别于「在场且打 0 分」传 0）
  readonly peer: number | null; // null = 同事缺席（区别于「在场且打 0 分」传 0）
}

export interface SoftWeights {
  readonly manager: number;
  readonly mgmt?: number; // 管理层缺席时省略
  readonly peer?: number; // 同事缺席时省略
}

export interface MergeSoftResult {
  readonly merged: number;
  readonly usedWeights: SoftWeights; // 实际采用的权重组（留痕用），值之和恒为 1
}

/**
 * 三方软项合成（硬化1 · 四分支：缺席方权重并入直属）。
 * 按「管理层是否在场（mgmt≠null）× 同事是否在场（peer≠null）」分四支：
 *   管理层在+同事在：0.55/0.35/0.10（manager/mgmt/peer）
 *   管理层在+同事缺：0.65/0.35（同事 0.10 → 直属）
 *   管理层缺+同事在：0.90/0.10
 *   管理层缺+同事缺：直属 1.00
 * usedWeights 如实记录实际采用的权重组（缺席方 key 不出现）。全精度返回，不在此处舍入。
 */
export function mergeSoft(input: MergeSoftInput): MergeSoftResult {
  const mgmtPresent = input.mgmt !== null;
  const peerPresent = input.peer !== null;

  if (mgmtPresent && peerPresent) {
    return {
      merged: W_MANAGER_BOTH * input.manager + W_MGMT_BOTH * (input.mgmt as number) + W_PEER_BOTH * (input.peer as number),
      usedWeights: { manager: W_MANAGER_BOTH, mgmt: W_MGMT_BOTH, peer: W_PEER_BOTH },
    };
  }
  if (mgmtPresent && !peerPresent) {
    return {
      merged: W_MANAGER_NO_PEER * input.manager + W_MGMT_NO_PEER * (input.mgmt as number),
      usedWeights: { manager: W_MANAGER_NO_PEER, mgmt: W_MGMT_NO_PEER },
    };
  }
  if (!mgmtPresent && peerPresent) {
    return {
      merged: W_MANAGER_NO_MGMT * input.manager + W_PEER_NO_MGMT * (input.peer as number),
      usedWeights: { manager: W_MANAGER_NO_MGMT, peer: W_PEER_NO_MGMT },
    };
  }
  return { merged: W_MANAGER_SOLO * input.manager, usedWeights: { manager: W_MANAGER_SOLO } };
}

/** 季度总分 = 目标分 + 软项合成，四舍五入 1 位小数。 */
export function quarterlyTotal(goalScore: number, mergedSoft: number): number {
  return roundHalfUp(goalScore + mergedSoft, 1);
}

/**
 * 季度评级：红线→D；S total≥90；A 80≤total<90；B 70≤total<80；
 * C 60≤total<70；D total<60。
 */
export function quarterlyGrade(total: number, redLine: boolean): Grade {
  if (redLine) return 'D';
  if (total >= 90) return 'S';
  if (total >= 80) return 'A';
  if (total >= 70) return 'B';
  if (total >= 60) return 'C';
  return 'D';
}

// =============== 半年 ===============

export type HalfYearFormula = '40/60' | 'single_100';

export interface HalfYearResult {
  readonly total: number | null;
  readonly formula: HalfYearFormula | null;
}

/**
 * 半年合成。双季有分：prev×0.4 + curr×0.6（formula '40/60'）；
 * 仅一季有分：该季 ×100%（formula 'single_100'）；双季皆无：total/formula 均为 null。
 * total 四舍五入 1 位小数。
 */
export function halfYearTotal(prevQ: number | null, currQ: number | null): HalfYearResult {
  if (prevQ !== null && currQ !== null) {
    return { total: roundHalfUp(prevQ * W_PREV_QUARTER + currQ * W_CURR_QUARTER, 1), formula: '40/60' };
  }
  if (prevQ !== null) return { total: roundHalfUp(prevQ, 1), formula: 'single_100' };
  if (currQ !== null) return { total: roundHalfUp(currQ, 1), formula: 'single_100' };
  return { total: null, formula: null };
}

// =============== 新人参评判定 ===============

function monthKey(d: Date): number {
  return d.getUTCFullYear() * MONTHS_PER_YEAR + d.getUTCMonth();
}

/**
 * 季度内完整月数。入职当月不算完整月（无视具体日期）；
 * joinedAt=null 视为远早于季度。月份按 UTC 计算，与运行环境时区无关。
 */
export function completeMonthsInQuarter(joinedAt: Date | null, quarterStart: Date, quarterEnd: Date): number {
  const startKey = monthKey(quarterStart);
  const endKey = monthKey(quarterEnd);
  const joinKey = joinedAt === null ? Number.NEGATIVE_INFINITY : monthKey(joinedAt);
  let count = 0;
  for (let key = startKey; key <= endKey; key += 1) {
    if (key > joinKey) count += 1;
  }
  return count;
}

/** 是否达到参评门槛：完整月数 ≥ 2。 */
export function enrolledInQuarter(joinedAt: Date | null, quarterStart: Date, quarterEnd: Date): boolean {
  return completeMonthsInQuarter(joinedAt, quarterStart, quarterEnd) >= MIN_COMPLETE_MONTHS_TO_ENROLL;
}

// =============== 同事指定连任校验 ===============

export interface PeerAssignmentRecord {
  readonly quarter: string; // 'YYYY-QN'
  readonly peerId: string;
}

export interface PeerAssignmentValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

function quarterIndex(quarter: string): number {
  const m = QUARTER_PATTERN.exec(quarter);
  if (!m) throw new InvalidQuarterFormatError(quarter);
  const year = Number(m[1]);
  const q = Number(m[2]);
  return year * QUARTERS_PER_YEAR + (q - 1);
}

/**
 * 校验同事（peer）指定：同一 peer 最多连续两季，新指定若造成连续第三季则拒绝。
 * quarter 格式 'YYYY-QN'，连续判定跨年（2026-Q4 → 2027-Q1 视为连续）。
 * 只看紧邻 newQuarter 之前、且为同一 peer 的连续段长度；≥2 则拒绝。
 */
export function validatePeerAssignment(
  history: readonly PeerAssignmentRecord[],
  newQuarter: string,
  newPeerId: string,
): PeerAssignmentValidation {
  const newIdx = quarterIndex(newQuarter);
  const peerByIndex = new Map<number, string>();
  for (const rec of history) {
    peerByIndex.set(quarterIndex(rec.quarter), rec.peerId);
  }

  let consecutive = 0;
  for (let idx = newIdx - 1; peerByIndex.get(idx) === newPeerId; idx -= 1) {
    consecutive += 1;
  }

  if (consecutive >= MAX_CONSECUTIVE_PEER_QUARTERS) {
    return {
      ok: false,
      reason: `同一评价人最多连续 ${MAX_CONSECUTIVE_PEER_QUARTERS} 个季度，${newPeerId} 已连续担任 ${consecutive} 个季度，再次指定将超限`,
    };
  }
  return { ok: true };
}

// =============== 定级定岗资格 ===============

const CONSECUTIVE_APLUS_QUARTERS = 2; // 连续两季 A 及以上可定级
const A_PLUS: ReadonlySet<Grade> = new Set<Grade>(['S', 'A']); // 「A 及以上」= A 或 S

export interface PromotionHistoryRecord {
  readonly quarter: string; // 'YYYY-QN'
  readonly grade: Grade;
}

export interface PromotionEligibility {
  readonly eligible: boolean;
  readonly reason: string;
  readonly basis: string[]; // 依据季度（升序）；不合格时为空
}

/**
 * 定级定岗资格（spec §5 步骤5 / §10）：满足其一即合格——
 *   1. 当季（最近一季）总评为 S；
 *   2. 最近连续两季均 A 及以上（S 亦算 A 及以上，且两季须相邻，跨年相邻算数）。
 * 输入无需预排序；按季度升序判定。季度格式非法抛 InvalidQuarterFormatError。
 * 不修改入参。
 */
export function promotionEligible(history: readonly PromotionHistoryRecord[]): PromotionEligibility {
  if (history.length === 0) {
    return { eligible: false, reason: '暂无季度成绩，无法判定定级资格', basis: [] };
  }

  const sorted = [...history]
    .map((r) => ({ quarter: r.quarter, grade: r.grade, idx: quarterIndex(r.quarter) }))
    .sort((a, b) => a.idx - b.idx);

  const latest = sorted[sorted.length - 1];
  if (latest.grade === 'S') {
    return { eligible: true, reason: `当季（${latest.quarter}）总评 S，满足定级资格`, basis: [latest.quarter] };
  }

  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  if (
    prev &&
    latest.idx - prev.idx === 1 &&
    A_PLUS.has(latest.grade) &&
    A_PLUS.has(prev.grade)
  ) {
    return {
      eligible: true,
      reason: `连续 ${CONSECUTIVE_APLUS_QUARTERS} 季（${prev.quarter} ${prev.grade}、${latest.quarter} ${latest.grade}）A 及以上，满足定级资格`,
      basis: [prev.quarter, latest.quarter],
    };
  }

  return {
    eligible: false,
    reason: `未满足定级资格（需当季 S，或连续 ${CONSECUTIVE_APLUS_QUARTERS} 季 A 及以上）`,
    basis: [],
  };
}
