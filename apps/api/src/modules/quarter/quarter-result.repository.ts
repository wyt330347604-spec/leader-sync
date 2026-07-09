import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import {
  quarterResult,
  quarterResultRevision,
  quarterAppeal,
  quarterCycle,
  quarterSheet,
  userRoleBinding,
  orgCache,
  halfYearResult,
  gradeHistory,
} from '@leader-sync/db';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';

export interface PublishedResultForQuarter {
  quarter: string;
  rateeUserId: string;
  rateeName: string | null;
  total: string | null;
}

export interface ManagerAverageRow {
  raterUserId: string;
  raterName: string | null;
  count: number;
  avgTotal: number;
}

export interface AppealWithResult {
  appeal: typeof quarterAppeal.$inferSelect;
  rateeName: string | null;
  grade: string | null;
  total: string | null;
  cycleUid: string | null;
}

@Injectable()
export class QuarterResultRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // ── Result ────────────────────────────────────────────────────────────────
  async findResultByUid(resultUid: string) {
    const [row] = await this.db.select().from(quarterResult).where(eq(quarterResult.resultUid, resultUid));
    return row ?? null;
  }

  async findResultByTask(taskUid: string) {
    const [row] = await this.db.select().from(quarterResult).where(eq(quarterResult.taskUid, taskUid));
    return row ?? null;
  }

  async listResultsByCycle(cycleUid: string) {
    return this.db
      .select()
      .from(quarterResult)
      .where(eq(quarterResult.cycleUid, cycleUid))
      .orderBy(desc(quarterResult.total));
  }

  async findResultByCycleAndRatee(cycleUid: string, candidates: string[]) {
    if (candidates.length === 0) return null;
    const [row] = await this.db
      .select()
      .from(quarterResult)
      .where(and(eq(quarterResult.cycleUid, cycleUid), inArray(quarterResult.rateeUserId, candidates)))
      .limit(1);
    return row ?? null;
  }

  /** 合成结果 upsert（按 task_uid 幂等；重算覆盖分数字段，保留 status/publish 信息）。 */
  async upsertResult(values: typeof quarterResult.$inferInsert) {
    const [row] = await this.db
      .insert(quarterResult)
      .values(values)
      .onConflictDoUpdate({
        target: quarterResult.taskUid,
        set: {
          goalScore: values.goalScore,
          managerSoft: values.managerSoft,
          peerSoft: values.peerSoft,
          mgmtAvg: values.mgmtAvg,
          softMerged: values.softMerged,
          total: values.total,
          grade: values.grade,
          redLine: values.redLine,
          redLineNote: values.redLineNote,
          weightsUsed: values.weightsUsed,
          mgmtRaters: values.mgmtRaters,
          rateeName: values.rateeName,
          sheetType: values.sheetType,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /** 改分 + 写 revision（同事务）。updates 已含重算后的字段。版本以 status 门控在 service 侧判定。 */
  async updateResultWithRevision(
    resultUid: string,
    updates: Partial<typeof quarterResult.$inferInsert>,
    revision: typeof quarterResultRevision.$inferInsert,
  ) {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quarterResult)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(quarterResult.resultUid, resultUid))
        .returning();
      if (!updated) return null;
      await tx.insert(quarterResultRevision).values(revision);
      return updated;
    });
  }

  async listRevisionsByResult(resultUid: string) {
    return this.db
      .select()
      .from(quarterResultRevision)
      .where(eq(quarterResultRevision.resultUid, resultUid))
      .orderBy(asc(quarterResultRevision.createdAt));
  }

  /** 批量公示：cycle 内全部 draft 结果置 published + 截止时点；返回受影响条数。 */
  async publishDraftResults(cycleUid: string, publishedAt: Date, appealDeadlineAt: Date): Promise<number> {
    const rows = await this.db
      .update(quarterResult)
      .set({ status: 'published', publishedAt, appealDeadlineAt, updatedAt: new Date() })
      .where(and(eq(quarterResult.cycleUid, cycleUid), eq(quarterResult.status, 'draft')))
      .returning({ resultUid: quarterResult.resultUid });
    return rows.length;
  }

  async updateCycleStatus(cycleUid: string, status: string, publishedAt: Date | null) {
    const [row] = await this.db
      .update(quarterCycle)
      .set({ status, ...(publishedAt ? { publishedAt } : {}) })
      .where(eq(quarterCycle.cycleUid, cycleUid))
      .returning();
    return row ?? null;
  }

  // ── Panel 聚合 ──────────────────────────────────────────────────────────────
  /** 各直属（作为 rater）已提交 manager sheet 的打分均值（total=goal+soft），用于评分会宽严对比。 */
  async managerAveragesByCycle(cycleUid: string): Promise<ManagerAverageRow[]> {
    const rows = await this.db
      .select({
        raterUserId: quarterSheet.raterUserId,
        raterName: quarterSheet.raterName,
        count: sql<number>`count(*)::int`,
        avgTotal: sql<number>`avg(coalesce(${quarterSheet.softTotal},0) + coalesce(${quarterSheet.goalScore},0))`,
      })
      .from(quarterSheet)
      .where(
        and(
          eq(quarterSheet.cycleUid, cycleUid),
          eq(quarterSheet.raterRole, 'manager'),
          eq(quarterSheet.status, 'submitted'),
        ),
      )
      .groupBy(quarterSheet.raterUserId, quarterSheet.raterName);
    return rows.map((r) => ({
      raterUserId: r.raterUserId,
      raterName: r.raterName,
      count: r.count,
      avgTotal: Number(r.avgTotal),
    }));
  }

  // ── Appeal ────────────────────────────────────────────────────────────────
  async insertAppeal(values: typeof quarterAppeal.$inferInsert) {
    const [row] = await this.db.insert(quarterAppeal).values(values).returning();
    return row;
  }

  async findAppealByUid(appealUid: string) {
    const [row] = await this.db.select().from(quarterAppeal).where(eq(quarterAppeal.appealUid, appealUid));
    return row ?? null;
  }

  async findOpenAppealByResult(resultUid: string) {
    const [row] = await this.db
      .select()
      .from(quarterAppeal)
      .where(and(eq(quarterAppeal.resultUid, resultUid), eq(quarterAppeal.status, 'open')))
      .limit(1);
    return row ?? null;
  }

  async listAppealsByResult(resultUid: string) {
    return this.db
      .select()
      .from(quarterAppeal)
      .where(eq(quarterAppeal.resultUid, resultUid))
      .orderBy(desc(quarterAppeal.createdAt));
  }

  async updateAppeal(appealUid: string, values: Partial<typeof quarterAppeal.$inferInsert>) {
    const [row] = await this.db
      .update(quarterAppeal)
      .set(values)
      .where(eq(quarterAppeal.appealUid, appealUid))
      .returning();
    return row ?? null;
  }

  /** cycle 内全部申诉（join result 取被评人/评级/周期）。 */
  async listAppealsByCycle(cycleUid: string): Promise<AppealWithResult[]> {
    const rows = await this.db
      .select({
        appeal: quarterAppeal,
        rateeName: quarterResult.rateeName,
        grade: quarterResult.grade,
        total: quarterResult.total,
        cycleUid: quarterResult.cycleUid,
      })
      .from(quarterAppeal)
      .innerJoin(quarterResult, eq(quarterResult.resultUid, quarterAppeal.resultUid))
      .where(eq(quarterResult.cycleUid, cycleUid))
      .orderBy(desc(quarterAppeal.createdAt));
    return rows;
  }

  // ── 通知收件人解析 ──────────────────────────────────────────────────────────
  /** 解析用户 open_id（org_cache）。优先 open_id，回退传入 id。 */
  async resolveOpenId(candidates: string[]): Promise<string | null> {
    if (candidates.length === 0) return null;
    const [row] = await this.db
      .select({ userId: orgCache.userId, openId: orgCache.openId })
      .from(orgCache)
      .where(or(inArray(orgCache.userId, candidates), inArray(orgCache.openId, candidates)))
      .limit(1);
    if (!row) return candidates.find((c) => c.startsWith('ou_')) ?? null;
    return row.openId ?? (row.userId.startsWith('ou_') ? row.userId : null);
  }

  // ── 半年合成（A）──────────────────────────────────────────────────────────
  /** 指定季度集合中全部 published 结果（join cycle 取 quarter）。半年合成取数用。 */
  async listPublishedResultsForQuarters(quarters: string[]): Promise<PublishedResultForQuarter[]> {
    if (quarters.length === 0) return [];
    const rows = await this.db
      .select({
        quarter: quarterCycle.quarter,
        rateeUserId: quarterResult.rateeUserId,
        rateeName: quarterResult.rateeName,
        total: quarterResult.total,
      })
      .from(quarterResult)
      .innerJoin(quarterCycle, eq(quarterCycle.cycleUid, quarterResult.cycleUid))
      .where(and(inArray(quarterCycle.quarter, quarters), eq(quarterResult.status, 'published')));
    return rows;
  }

  /** 半年结果 upsert（唯一 (half, ratee)，幂等重算）。 */
  async upsertHalfYearResult(values: typeof halfYearResult.$inferInsert) {
    const [row] = await this.db
      .insert(halfYearResult)
      .values(values)
      .onConflictDoUpdate({
        target: [halfYearResult.half, halfYearResult.rateeUserId],
        set: {
          rateeName: values.rateeName,
          prevQuarter: values.prevQuarter,
          currQuarter: values.currQuarter,
          prevTotal: values.prevTotal,
          currTotal: values.currTotal,
          formula: values.formula,
          total: values.total,
          grade: values.grade,
          synthesizedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /** 某被评人跨周期的 published/closed 结果（/me/performance 季度成绩卡）。 */
  async listPublishedResultsByRatee(candidates: string[]) {
    if (candidates.length === 0) return [];
    return this.db
      .select({
        resultUid: quarterResult.resultUid,
        quarter: quarterCycle.quarter,
        total: quarterResult.total,
        grade: quarterResult.grade,
        softMerged: quarterResult.softMerged,
        goalScore: quarterResult.goalScore,
        sheetType: quarterResult.sheetType,
        status: quarterResult.status,
        publishedAt: quarterResult.publishedAt,
        appealDeadlineAt: quarterResult.appealDeadlineAt,
      })
      .from(quarterResult)
      .innerJoin(quarterCycle, eq(quarterCycle.cycleUid, quarterResult.cycleUid))
      .where(
        and(
          inArray(quarterResult.rateeUserId, candidates),
          inArray(quarterResult.status, ['published', 'closed']),
        ),
      )
      .orderBy(desc(quarterCycle.quarter));
  }

  /** 某被评人跨半年的合成成绩（/me/performance 半年成绩卡）。 */
  async listHalfYearResultsByRatee(candidates: string[]) {
    if (candidates.length === 0) return [];
    return this.db
      .select()
      .from(halfYearResult)
      .where(inArray(halfYearResult.rateeUserId, candidates))
      .orderBy(desc(halfYearResult.half));
  }

  async listHalfYearResults(half: string, candidates?: string[]) {
    const conds = [eq(halfYearResult.half, half)];
    if (candidates && candidates.length > 0) conds.push(inArray(halfYearResult.rateeUserId, candidates));
    return this.db
      .select()
      .from(halfYearResult)
      .where(and(...conds))
      .orderBy(desc(halfYearResult.total));
  }

  // ── 定级定岗资格（B）─────────────────────────────────────────────────────
  /** 某被评人跨周期的 published 结果 (quarter, grade)（资格判定输入）。 */
  async listPublishedGradesByRatee(candidates: string[]): Promise<{ quarter: string; grade: string }[]> {
    if (candidates.length === 0) return [];
    const rows = await this.db
      .select({ quarter: quarterCycle.quarter, grade: quarterResult.grade })
      .from(quarterResult)
      .innerJoin(quarterCycle, eq(quarterCycle.cycleUid, quarterResult.cycleUid))
      .where(and(inArray(quarterResult.rateeUserId, candidates), eq(quarterResult.status, 'published')));
    return rows.filter((r): r is { quarter: string; grade: string } => Boolean(r.grade));
  }

  /** 某人最近一条未删除 grade_history（回填 score_snapshot 用；无则 null）。 */
  async findLatestGradeHistory(candidates: string[]) {
    if (candidates.length === 0) return null;
    const [row] = await this.db
      .select()
      .from(gradeHistory)
      .where(and(inArray(gradeHistory.userId, candidates), sql`${gradeHistory.deletedAt} IS NULL`))
      .orderBy(desc(gradeHistory.changedAt))
      .limit(1);
    return row ?? null;
  }

  /** 回填某条 grade_history 的 score_snapshot。 */
  async updateGradeSnapshot(recordUid: string, snapshot: unknown) {
    const [row] = await this.db
      .update(gradeHistory)
      .set({ scoreSnapshot: snapshot as never })
      .where(eq(gradeHistory.recordUid, recordUid))
      .returning();
    return row ?? null;
  }

  // ── CSV 导出（C）─────────────────────────────────────────────────────────
  /** 被评人 id（user_id/open_id 双形态）→ 部门名 映射。 */
  async deptNamesByRatees(rateeIds: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (rateeIds.length === 0) return map;
    const rows = await this.db
      .select({ userId: orgCache.userId, openId: orgCache.openId, deptName: orgCache.deptName })
      .from(orgCache)
      .where(or(inArray(orgCache.userId, rateeIds), inArray(orgCache.openId, rateeIds)));
    for (const r of rows) {
      if (r.userId) map.set(r.userId, r.deptName ?? null);
      if (r.openId) map.set(r.openId, r.deptName ?? null);
    }
    return map;
  }

  /** hr 角色绑定用户的 open_id 列表（申诉提交通知）。 */
  async listHrOpenIds(): Promise<string[]> {
    const hrRows = await this.db
      .select({ userId: userRoleBinding.userId })
      .from(userRoleBinding)
      .where(eq(userRoleBinding.role, 'hr'));
    const ids = hrRows.map((r) => r.userId);
    if (ids.length === 0) return [];
    const orgRows = await this.db
      .select({ userId: orgCache.userId, openId: orgCache.openId })
      .from(orgCache)
      .where(or(inArray(orgCache.userId, ids), inArray(orgCache.openId, ids)));
    const byOpen = new Set<string>();
    for (const r of orgRows) {
      const oid = r.openId ?? (r.userId.startsWith('ou_') ? r.userId : null);
      if (oid) byOpen.add(oid);
    }
    // org_cache 查不到的 hr（本地 dev 绑定）兜底用其自身 ou_ 句柄
    for (const id of ids) if (id.startsWith('ou_')) byOpen.add(id);
    return [...byOpen];
  }
}
