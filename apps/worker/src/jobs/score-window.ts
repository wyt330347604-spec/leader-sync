/**
 * score-window.ts
 *
 * 打分窗口开启：**花名册口径（2026-07-15 决策）**——为全体在册员工（org_cache
 * 有直属 manager、非 score_exempt）生成 monthly_score 草稿（rater = 该员工
 * org_cache.manager_user_id），不再依赖"上月有任务"的 employee 快照；任务快照
 * 仅作可选上下文（有则挂 snapshot_ref）。可选给各 rater 发飞书「打分窗口开启」卡片。
 *
 * 从 monthly-close Step 6 抽出为独立可测函数：
 *   - monthly-close 月结时委托调用（保持原行为：发卡片）
 *   - scripts/run-score-window-once.ts 数据补跑（默认不发卡片）
 *
 * 幂等：monthly_score 有 (score_month, ratee_user_id) 唯一索引 +
 * onConflictDoNothing，重复执行不产生重复草稿。
 *
 * ID 命名空间：org 查找表按 user_id 和 open_id 双 key 建立 —— org_cache.user_id
 * （OAuth 登录写入，可能是员工 user_id）与 open_id（ou_）属不同命名空间，rater
 * 解析与去重均按 ou_ 规范句柄处理。
 */

import { createDb, type Database } from '@leader-sync/db';
import { monthlySnapshot, monthlyScore, orgCache, scoreTemplate, perfRole } from '@leader-sync/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { config } from '../config';
import { feishuApi } from '../services/feishu-api';
import { generateScoreUid } from '../lib/uid';
import { buildScoreWindowCard } from '../services/message-builder';

// 默认依赖惰性初始化：测试注入 db/feishu 时不会触发真实连接。
let _defaultDb: Database | null = null;
function defaultDb(): Database {
  if (!_defaultDb) _defaultDb = createDb(config.databaseUrl);
  return _defaultDb;
}

const SCORE_DEADLINE_DAYS = 7;

interface FeishuDeps {
  sendCardMessage: (userId: string, card: object) => Promise<void>;
}

export interface ScoreWindowOptions {
  /** 'YYYY-MM'，为该月生成花名册月度草稿（不要求快照已生成） */
  month: string;
  /** 逻辑当前时间（打分截止 = now + 7 天）。默认 new Date()。 */
  now?: Date;
  /** 是否给各 rater 发「打分窗口开启」卡片。月结保持 true；补跑脚本默认 false。 */
  sendCards?: boolean;
  /** 只计算与日志，不写库、不发卡。 */
  dryRun?: boolean;
  db?: Database;
  feishu?: FeishuDeps;
}

export interface ScoreWindowResult {
  month: string;
  /** 花名册口径：org_cache 在册人数（遍历基数） */
  rosterCount: number;
  /** 尝试生成的草稿数（onConflictDoNothing，已存在的不重插） */
  draftCount: number;
  /** 因 org_cache 无 manager 而跳过的员工数 */
  skippedNoManager: number;
  /** 因 score_exempt=true（不参与绩效）而跳过的员工数 */
  skippedExempt: number;
  cardsSent: number;
  dryRun: boolean;
}

/** 按 user_id + open_id 双 key 建 org 查找表，消除两套 ID 命名空间的 miss。 */
function buildOrgLookup(rows: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const r of rows) {
    if (r.userId) map.set(r.userId, r);
    if (r.openId && !map.has(r.openId)) map.set(r.openId, r);
  }
  return map;
}

async function loadOrgRows(db: Database, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(orgCache)
    .where(or(inArray(orgCache.userId, ids), inArray(orgCache.openId, ids)));
}

/** rater 发卡目标：优先其 org_cache 行的 open_id，其次 rater ID 本身（须 ou_）。 */
function resolveCardTarget(raterUserId: string, orgLookup: Map<string, any>): string | null {
  const openId = orgLookup.get(raterUserId)?.openId;
  if (openId && openId.startsWith('ou_')) return openId;
  if (raterUserId.startsWith('ou_')) return raterUserId;
  return null;
}

/** 行的 ou_ 规范句柄（openId 优先），无 ou_ 返回 null。 */
function ouHandleOf(row: any): string | null {
  if (row?.openId?.startsWith('ou_')) return row.openId;
  if (row?.userId?.startsWith('ou_')) return row.userId;
  return null;
}

export async function runScoreWindowSetup(opts: ScoreWindowOptions): Promise<ScoreWindowResult> {
  const { month } = opts;
  const now = opts.now ?? new Date();
  const sendCards = opts.sendCards ?? true;
  const dryRun = opts.dryRun ?? false;
  const db = opts.db ?? defaultDb();
  const feishu = opts.feishu ?? feishuApi;

  const deadlineDate = new Date(now);
  deadlineDate.setDate(deadlineDate.getDate() + SCORE_DEADLINE_DAYS);
  const deadlineStr = deadlineDate.toISOString().slice(0, 10);

  // ── 花名册口径（2026-07-15 决策）：为全体在册员工（org_cache 有直属、非 score_exempt）生成月度打分草稿 ──
  // 不再依赖"上月有任务"的 employee 快照；任务快照仅作可选上下文（有则挂 snapshot_ref）。
  const orgRows = await db.select().from(orgCache);

  // 可选上下文：该月 employee 快照 owner → snapshotUid（有则挂，无则 null）
  const employeeSnapshots = await db
    .select()
    .from(monthlySnapshot)
    .where(
      sql`${monthlySnapshot.snapshotMonth} = ${month}
        AND ${monthlySnapshot.roleScope} = 'employee'
        AND ${monthlySnapshot.isLatest} = true
        AND ${monthlySnapshot.ownerUserId} IS NOT NULL`,
    );
  const snapshotByOwner = new Map<string, string>();
  for (const s of employeeSnapshots as any[]) {
    if (s.ownerUserId) snapshotByOwner.set(s.ownerUserId, s.snapshotUid);
  }

  const result: ScoreWindowResult = {
    month,
    rosterCount: orgRows.length,
    draftCount: 0,
    skippedNoManager: 0,
    skippedExempt: 0,
    cardsSent: 0,
    dryRun,
  };
  if (orgRows.length === 0) return result;

  // orgLookup 含全体在册（既是花名册也是 rater/发卡目标解析源）。
  const orgLookup = buildOrgLookup(orgRows);

  // ── V1.4 开窗盖章：按被评人 perf_role.is_leader 决定 template_uid（未 seed 时兜底 null）──
  const monthlyTemplates = await db
    .select()
    .from(scoreTemplate)
    .where(
      and(
        inArray(scoreTemplate.code, ['monthly_employee', 'monthly_leader']),
        eq(scoreTemplate.active, true),
      ),
    );
  const templateUidByCode = new Map<string, string>();
  for (const t of monthlyTemplates) templateUidByCode.set(t.code, t.templateUid);
  const employeeTemplateUid = templateUidByCode.get('monthly_employee') ?? null;
  const leaderTemplateUid = templateUidByCode.get('monthly_leader') ?? null;

  // 全体在册的 perf_role（双命名空间）→ is_leader 集合。
  const rateeCandidateIds = new Set<string>();
  for (const r of orgRows) {
    if (r.userId) rateeCandidateIds.add(r.userId);
    if (r.openId) rateeCandidateIds.add(r.openId);
  }
  const leaderIds = new Set<string>();
  if (rateeCandidateIds.size > 0) {
    const prRows = await db
      .select()
      .from(perfRole)
      .where(
        or(
          inArray(perfRole.userId, [...rateeCandidateIds]),
          inArray(perfRole.openId, [...rateeCandidateIds]),
        ),
      );
    for (const pr of prRows) {
      if (pr.isLeader) {
        if (pr.userId) leaderIds.add(pr.userId);
        if (pr.openId) leaderIds.add(pr.openId);
      }
    }
  }

  /** 该被评人的月度模板：is_leader → leader 版，否则员工版（含无 perf_role 行）。 */
  const templateUidFor = (orgRow: any): string | null => {
    const isLeader =
      Boolean(orgRow?.userId && leaderIds.has(orgRow.userId)) ||
      Boolean(orgRow?.openId && leaderIds.has(orgRow.openId));
    return isLeader ? leaderTemplateUid : employeeTemplateUid;
  };

  const raterNotifyMap = new Map<string, { raterName: string; rateeList: string[] }>();
  // ratee 规范化为 org 行的 ou_ 句柄并在本轮去重，只生成一条草稿。
  const seenRatees = new Set<string>();

  for (const orgRow of orgRows) {
    if (orgRow.scoreExempt) {
      result.skippedExempt++;
      continue;
    }
    const raterUserId: string = orgRow.managerUserId ?? '';
    if (!raterUserId) {
      result.skippedNoManager++;
      continue;
    }
    const rateeCanonical = ouHandleOf(orgRow) ?? orgRow.userId;
    if (!rateeCanonical || seenRatees.has(rateeCanonical)) continue;
    seenRatees.add(rateeCanonical);

    const rateeName = orgRow.userName ?? null;
    const raterName = orgLookup.get(raterUserId)?.userName ?? null;
    const snapshotRef =
      snapshotByOwner.get(orgRow.userId) ?? snapshotByOwner.get(orgRow.openId ?? '') ?? null;

    if (!dryRun) {
      await db
        .insert(monthlyScore)
        .values({
          scoreUid: generateScoreUid(),
          scoreMonth: month,
          rateeUserId: rateeCanonical,
          rateeName,
          raterUserId,
          raterName,
          score: null,
          // V1.4：开窗按 perf_role.is_leader 盖章员工版/leader 版模板
          templateUid: templateUidFor(orgRow),
          status: 'draft',
          snapshotRef,
          version: 1,
          createdBy: 'system',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
    result.draftCount++;

    if (!raterNotifyMap.has(raterUserId)) {
      raterNotifyMap.set(raterUserId, {
        raterName: raterName ?? raterUserId,
        rateeList: [],
      });
    }
    raterNotifyMap.get(raterUserId)!.rateeList.push(rateeName ?? rateeCanonical);
  }

  if (sendCards && !dryRun) {
    for (const [raterUserId, { raterName, rateeList }] of raterNotifyMap) {
      const target = resolveCardTarget(raterUserId, orgLookup);
      if (!target) {
        console.warn(`  [score-window] rater ${raterUserId} 无 ou_ open_id，卡片未发`);
        continue;
      }
      const card = buildScoreWindowCard(raterName, month, rateeList.length, deadlineStr);
      await feishu.sendCardMessage(target, card);
      result.cardsSent++;
    }
  }

  return result;
}
