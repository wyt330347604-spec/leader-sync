// 季度周期规划（纯函数，零 I/O、零 DB 依赖）
// 依据：docs/superpowers/specs/2026-07-08-performance-review-module.md §3.3 §5 §10.7/10.8
//
// 用途：worker「季度结束次日开窗」cron 与 API「手动开周期」共用同一套开窗决策逻辑
// （抽公共函数、勿复制粘贴）—— 两端各自读库/写库，中间的规则判定全部走本模块。
// 计分与校验一律 import perf-scoring（enrolledInQuarter 等），本模块不重复实现。

import { enrolledInQuarter, InvalidQuarterFormatError, InvalidHalfFormatError } from './perf-scoring';

const QUARTER_PATTERN = /^(\d{4})-Q([1-4])$/;
const HALF_PATTERN = /^(\d{4})-H([12])$/;
const MONTHS_PER_QUARTER = 3;
const MS_PER_DAY = 86_400_000;

interface ParsedQuarter {
  readonly year: number;
  readonly q: number; // 1–4
}

function parseQuarter(quarter: string): ParsedQuarter {
  const m = QUARTER_PATTERN.exec(quarter);
  if (!m) throw new InvalidQuarterFormatError(quarter);
  return { year: Number(m[1]), q: Number(m[2]) };
}

export interface QuarterBounds {
  readonly start: Date; // 季度首日 00:00:00 UTC
  readonly end: Date; // 季度末日 00:00:00 UTC
}

/** 季度起止（UTC，与运行环境时区无关）。start=首月 1 日；end=末月最后一日。 */
export function quarterBounds(quarter: string): QuarterBounds {
  const { year, q } = parseQuarter(quarter);
  const startMonth = (q - 1) * MONTHS_PER_QUARTER; // 0-indexed
  const endMonthExclusive = startMonth + MONTHS_PER_QUARTER; // 下一季首月
  const start = new Date(Date.UTC(year, startMonth, 1));
  // 末月最后一日 = 下一季首月的第 0 天
  const end = new Date(Date.UTC(year, endMonthExclusive, 0));
  return { start, end };
}

/** date 所属季度 'YYYY-QN'（UTC）。 */
export function quarterForDate(date: Date): string {
  const year = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / MONTHS_PER_QUARTER) + 1;
  return `${year}-Q${q}`;
}

/** 上一季（Q1 → 上一年 Q4）。 */
export function previousQuarter(quarter: string): string {
  const { year, q } = parseQuarter(quarter);
  if (q === 1) return `${year - 1}-Q4`;
  return `${year}-Q${q - 1}`;
}

/** date 当天刚结束的季度（= date 所属季度的上一季）。开窗 cron 在季度结束次日调用。 */
export function endedQuarterOn(date: Date): string {
  return previousQuarter(quarterForDate(date));
}

/** 季度所属半年 'YYYY-HN'（Q1/Q2→H1，Q3/Q4→H2）—— 半年目标关联用。 */
export function halfForQuarter(quarter: string): string {
  const { year, q } = parseQuarter(quarter);
  return `${year}-H${q <= 2 ? 1 : 2}`;
}

export interface HalfQuarters {
  readonly prev: string; // 前季 'YYYY-QN'（占 40%）
  readonly curr: string; // 后季 'YYYY-QN'（占 60%）
}

/** 半年 'YYYY-HN' → 该半年的前季/后季（H1→Q1/Q2，H2→Q3/Q4）。半年合成用。 */
export function quartersForHalf(half: string): HalfQuarters {
  const m = HALF_PATTERN.exec(half);
  if (!m) throw new InvalidHalfFormatError(half);
  const year = m[1];
  const h = Number(m[2]);
  return h === 1 ? { prev: `${year}-Q1`, curr: `${year}-Q2` } : { prev: `${year}-Q3`, curr: `${year}-Q4` };
}

// ── 任务规划 ────────────────────────────────────────────────────────────────

export interface QuarterMemberInput {
  readonly userId: string; // 规范 ou_ 句柄
  readonly name: string | null;
  readonly joinedAt: Date | null;
  readonly isLeader: boolean;
  readonly managerUserId: string | null;
  readonly managerName: string | null;
  readonly peerUserId: string | null;
  readonly peerName: string | null;
  /** 员工被直属勾"表现差/晋级申请"进管理层评分（leader 恒 true，无需此项）。 */
  readonly mgmtRequiredOverride?: boolean;
  readonly mgmtReason?: string | null;
}

export interface StageDeadlineOffsets {
  readonly self: number; // 自评截止 = openAt + self 天
  readonly peerManager: number; // 同事+直属截止
  readonly mgmt: number; // 管理层截止
}

/** 串行门控默认偏移（spec §5：自评 3 天、同事+直属再 5 天、管理层再 4 天）。 */
export const DEFAULT_STAGE_OFFSETS: StageDeadlineOffsets = { self: 3, peerManager: 8, mgmt: 12 };

export type QuarterSheetRole = 'self' | 'manager' | 'peer';
export type PlanWarning = 'no-manager' | 'no-peer';

export interface PlannedSheet {
  readonly raterUserId: string;
  readonly raterName: string | null;
  readonly raterRole: QuarterSheetRole;
}

export interface PlannedStageDeadlines {
  readonly self: string;
  readonly peer_manager: string;
  readonly mgmt: string;
}

export interface PlannedTask {
  readonly rateeUserId: string;
  readonly rateeName: string | null;
  readonly sheetType: 'employee' | 'leader';
  readonly templateUid: string | null;
  readonly mgmtRequired: boolean;
  readonly mgmtReason: string | null;
  readonly enrolled: boolean;
  readonly skipReason: string | null;
  readonly stage: 'pending_self';
  readonly stageDeadlines: PlannedStageDeadlines;
  readonly sheets: readonly PlannedSheet[];
  readonly warnings: readonly PlanWarning[];
}

export interface PlanQuarterInput {
  readonly quarter: string;
  readonly openAt: Date;
  readonly members: readonly QuarterMemberInput[];
  readonly employeeTemplateUid: string | null;
  readonly leaderTemplateUid: string | null;
  readonly offsets?: StageDeadlineOffsets;
}

// ── 成员装配（原始行 → 规划输入，纯函数，worker/API 共用） ─────────────────

export interface RawOrgRow {
  readonly userId: string;
  readonly openId: string | null;
  readonly userName: string | null;
  readonly managerUserId: string | null;
  readonly joinedAt: Date | null;
  readonly scoreExempt: boolean;
}

export interface RawPerfRoleRow {
  readonly userId: string | null;
  readonly openId: string | null;
  readonly isLeader: boolean;
}

export interface RawPeerRow {
  readonly rateeUserId: string;
  readonly peerUserId: string;
  readonly peerName: string | null;
}

export interface AssembleQuarterInput {
  readonly orgRows: readonly RawOrgRow[];
  readonly perfRoles: readonly RawPerfRoleRow[];
  readonly peers: readonly RawPeerRow[];
}

/** 规范身份：优先 ou_ open_id，其次 ou_ user_id，兜底 user_id。 */
function canonicalId(row: { userId: string; openId: string | null }): string {
  if (row.openId && row.openId.startsWith('ou_')) return row.openId;
  if (row.userId && row.userId.startsWith('ou_')) return row.userId;
  return row.userId;
}

/**
 * 由 org_cache / perf_role / peer_assignment 原始行装配开窗成员名单（纯函数）。
 *   - 剔除 score_exempt；按规范 id 去重（同一人 emp_/ou_ 双行合并，字段取非空）。
 *   - isLeader 来自 perf_role（任一 id 形态命中）。
 *   - 直属姓名从全量 org 行查找（即便直属被豁免评分也要能查名）。
 *   - 指定同事从 peer_assignment 按规范被评人 id 解析。
 * 注：mgmt_required 的员工勾选在开窗后由 API PATCH 单独设置，此处一律 leader 恒 true、员工默认 false。
 */
export function assembleQuarterMembers(input: AssembleQuarterInput): QuarterMemberInput[] {
  // 全量 org 查找表（user_id + open_id 双键）
  const orgByAnyId = new Map<string, RawOrgRow>();
  for (const r of input.orgRows) {
    if (r.userId) orgByAnyId.set(r.userId, r);
    if (r.openId && !orgByAnyId.has(r.openId)) orgByAnyId.set(r.openId, r);
  }
  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    return orgByAnyId.get(id)?.userName ?? null;
  };

  // leader 身份集合
  const leaderIds = new Set<string>();
  for (const pr of input.perfRoles) {
    if (!pr.isLeader) continue;
    if (pr.userId) leaderIds.add(pr.userId);
    if (pr.openId) leaderIds.add(pr.openId);
  }

  // 指定同事：按规范被评人 id
  const peerByRatee = new Map<string, RawPeerRow>();
  for (const p of input.peers) peerByRatee.set(p.rateeUserId, p);

  // 按规范 id 分组去重
  const groups = new Map<string, RawOrgRow[]>();
  for (const row of input.orgRows) {
    const cid = canonicalId(row);
    const arr = groups.get(cid);
    if (arr) arr.push(row);
    else groups.set(cid, [row]);
  }

  const members: QuarterMemberInput[] = [];
  for (const [cid, rows] of groups) {
    // 任一行豁免则整组豁免
    if (rows.some((r) => r.scoreExempt)) continue;
    const firstNonNull = <T>(pick: (r: RawOrgRow) => T | null | undefined): T | null => {
      for (const r of rows) {
        const v = pick(r);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    };
    const name = firstNonNull((r) => r.userName);
    const managerUserId = firstNonNull((r) => r.managerUserId);
    const joinedAt = firstNonNull((r) => r.joinedAt);
    const isLeader =
      leaderIds.has(cid) || rows.some((r) => leaderIds.has(r.userId) || (r.openId ? leaderIds.has(r.openId) : false));
    const peer = peerByRatee.get(cid);

    members.push({
      userId: cid,
      name,
      joinedAt,
      isLeader,
      managerUserId,
      managerName: nameOf(managerUserId),
      peerUserId: peer?.peerUserId ?? null,
      peerName: peer?.peerName ?? null,
    });
  }

  return members;
}

function addDaysIso(base: Date, days: number): string {
  return new Date(base.getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * 规划一个季度周期的全部任务与打分表（不含 uid，由调用方写库时生成）。
 * 前置：调用方已剔除 score_exempt 成员。
 *
 * 每人：
 *   - enrolled = enrolledInQuarter(joinedAt, 季度起止)；不足则 enrolled=false + skip_reason，不建 sheet。
 *   - sheet_type/template 按 isLeader；mgmt_required = isLeader || override。
 *   - stage=pending_self；stage_deadlines 按 openAt + offsets。
 *   - 建 self（本人）+ manager（直属，无则 warn no-manager）+ peer（指定同事，无则 warn no-peer）。
 */
export function planQuarterTasks(input: PlanQuarterInput): PlannedTask[] {
  const { start, end } = quarterBounds(input.quarter);
  const offsets = input.offsets ?? DEFAULT_STAGE_OFFSETS;
  const stageDeadlines: PlannedStageDeadlines = {
    self: addDaysIso(input.openAt, offsets.self),
    peer_manager: addDaysIso(input.openAt, offsets.peerManager),
    mgmt: addDaysIso(input.openAt, offsets.mgmt),
  };

  return input.members.map((m) => {
    const enrolled = enrolledInQuarter(m.joinedAt, start, end);
    const sheetType: 'employee' | 'leader' = m.isLeader ? 'leader' : 'employee';
    const templateUid = m.isLeader ? input.leaderTemplateUid : input.employeeTemplateUid;
    const mgmtRequired = m.isLeader || Boolean(m.mgmtRequiredOverride);
    const mgmtReason = mgmtRequired ? (m.mgmtReason ?? null) : null;

    if (!enrolled) {
      return {
        rateeUserId: m.userId,
        rateeName: m.name,
        sheetType,
        templateUid,
        mgmtRequired,
        mgmtReason,
        enrolled: false,
        skipReason: '新人本季完整在职不足 2 个月，本季不参评',
        stage: 'pending_self',
        stageDeadlines,
        sheets: [],
        warnings: [],
      };
    }

    const sheets: PlannedSheet[] = [
      { raterUserId: m.userId, raterName: m.name, raterRole: 'self' },
    ];
    const warnings: PlanWarning[] = [];

    if (m.managerUserId) {
      sheets.push({ raterUserId: m.managerUserId, raterName: m.managerName, raterRole: 'manager' });
    } else {
      warnings.push('no-manager');
    }

    if (m.peerUserId) {
      sheets.push({ raterUserId: m.peerUserId, raterName: m.peerName, raterRole: 'peer' });
    } else {
      warnings.push('no-peer');
    }

    return {
      rateeUserId: m.userId,
      rateeName: m.name,
      sheetType,
      templateUid,
      mgmtRequired,
      mgmtReason,
      enrolled: true,
      skipReason: null,
      stage: 'pending_self',
      stageDeadlines,
      sheets,
      warnings,
    };
  });
}
