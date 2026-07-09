/**
 * score-window.ts
 *
 * 打分窗口开启：为指定月份的每个 employee 快照生成 monthly_score 草稿
 * （rater = 该员工 org_cache.manager_user_id），并可选给各 rater 发飞书
 * 「打分窗口开启」卡片。
 *
 * 从 monthly-close Step 6 抽出为独立可测函数：
 *   - monthly-close 月结时委托调用（保持原行为：发卡片）
 *   - scripts/run-score-window-once.ts 数据补跑（默认不发卡片）
 *
 * 幂等：monthly_score 有 (score_month, ratee_user_id) 唯一索引 +
 * onConflictDoNothing，重复执行不产生重复草稿。
 *
 * ID 命名空间：org 查找表按 user_id 和 open_id 双 key 建立 —— 快照
 * ownerUserId（来自任务负责人，生产 97.5% 为 ou_ open_id）与 org_cache.user_id
 * （OAuth 登录写入，可能是员工 user_id）属不同命名空间，任一均可命中。
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
  /** 'YYYY-MM'，该月的 employee 快照必须已生成（月结 Step 3） */
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
  snapshotCount: number;
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

  const employeeSnapshots = await db
    .select()
    .from(monthlySnapshot)
    .where(
      sql`${monthlySnapshot.snapshotMonth} = ${month}
        AND ${monthlySnapshot.roleScope} = 'employee'
        AND ${monthlySnapshot.isLatest} = true
        AND ${monthlySnapshot.ownerUserId} IS NOT NULL`,
    );

  const result: ScoreWindowResult = {
    month,
    snapshotCount: employeeSnapshots.length,
    draftCount: 0,
    skippedNoManager: 0,
    skippedExempt: 0,
    cardsSent: 0,
    dryRun,
  };
  if (employeeSnapshots.length === 0) return result;

  // 第一轮：按快照 owner 拉 org 行（双命名空间）
  const ownerIds = [
    ...new Set(employeeSnapshots.map((s: any) => s.ownerUserId).filter((id: any): id is string => Boolean(id))),
  ];
  const orgLookup = buildOrgLookup(await loadOrgRows(db, ownerIds));

  // 第二轮：补拉缺失的 rater 行（发卡目标解析 + rater 名字用）
  const missingRaterIds = new Set<string>();
  for (const snap of employeeSnapshots) {
    if (!snap.ownerUserId) continue;
    const raterUserId: string = orgLookup.get(snap.ownerUserId)?.managerUserId ?? '';
    if (raterUserId && !orgLookup.has(raterUserId)) missingRaterIds.add(raterUserId);
  }
  if (missingRaterIds.size > 0) {
    for (const r of await loadOrgRows(db, [...missingRaterIds])) {
      if (r.userId && !orgLookup.has(r.userId)) orgLookup.set(r.userId, r);
      if (r.openId && !orgLookup.has(r.openId)) orgLookup.set(r.openId, r);
    }
  }

  // ── V1.4 开窗盖章：按被评人 perf_role.is_leader 决定 template_uid ──────────────
  // 加载两个 active 月度模板（未 seed 时兜底 null）。
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

  // 加载被评人 perf_role（双命名空间）；is_leader 者用 leader 版模板，无行视为员工。
  const rateeCandidateIds = new Set<string>();
  for (const snap of employeeSnapshots) {
    if (!snap.ownerUserId) continue;
    rateeCandidateIds.add(snap.ownerUserId);
    const org = orgLookup.get(snap.ownerUserId);
    const ou = ouHandleOf(org);
    if (ou) rateeCandidateIds.add(ou);
    if (org?.userId) rateeCandidateIds.add(org.userId);
    if (org?.openId) rateeCandidateIds.add(org.openId);
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
  const templateUidFor = (rateeCanonical: string, ownerUserId: string, orgRow: any): string | null => {
    const isLeader =
      leaderIds.has(rateeCanonical) ||
      leaderIds.has(ownerUserId) ||
      Boolean(orgRow?.userId && leaderIds.has(orgRow.userId)) ||
      Boolean(orgRow?.openId && leaderIds.has(orgRow.openId));
    return isLeader ? leaderTemplateUid : employeeTemplateUid;
  };

  const raterNotifyMap = new Map<string, { raterName: string; rateeList: string[] }>();
  // 同一人的任务可能分散在 ou_ / 员工 ID 两套命名空间下产生多份快照——
  // ratee 规范化为 org 行的 ou_ 句柄并在本轮去重，只生成一条草稿。
  const seenRatees = new Set<string>();

  for (const snap of employeeSnapshots) {
    if (!snap.ownerUserId) continue;
    const orgRow = orgLookup.get(snap.ownerUserId);
    if (orgRow?.scoreExempt) {
      result.skippedExempt++;
      continue;
    }
    const raterUserId: string = orgRow?.managerUserId ?? '';
    if (!raterUserId) {
      result.skippedNoManager++;
      continue;
    }

    const rateeCanonical = ouHandleOf(orgRow) ?? snap.ownerUserId;
    if (seenRatees.has(rateeCanonical)) continue;
    seenRatees.add(rateeCanonical);

    const rateeName = snap.ownerName ?? orgRow?.userName ?? null;
    const raterName = orgLookup.get(raterUserId)?.userName ?? null;

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
          templateUid: templateUidFor(rateeCanonical, snap.ownerUserId, orgRow),
          status: 'draft',
          snapshotRef: snap.snapshotUid,
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
