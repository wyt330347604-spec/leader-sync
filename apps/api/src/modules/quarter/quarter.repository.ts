import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import {
  quarterCycle,
  quarterTask,
  quarterSheet,
  quarterSheetItem,
  peerAssignment,
  quarterGoal,
  quarterGoalRevision,
  scoreTemplate,
  scoreDimension,
  perfRole,
  orgCache,
  feishuDepartment,
  monthlyScore,
  incident,
  incidentUser,
} from '@leader-sync/db';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { QuarterMgmtTrace } from '@leader-sync/db';

export interface TemplateWithDimensions {
  template: typeof scoreTemplate.$inferSelect;
  dimensions: (typeof scoreDimension.$inferSelect)[];
}

export interface StageCountRow {
  stage: string;
  enrolled: boolean;
  count: number;
}

export interface SheetWithTask {
  sheet: typeof quarterSheet.$inferSelect;
  task: typeof quarterTask.$inferSelect | null;
  cycleQuarter: string | null;
}

export interface MonthlyBaseline {
  scoreMonth: string;
  score: string | null;
  totalScore: string | null;
  grade: string | null;
  challengeNote: string | null;
  status: string;
}

export interface IncidentRef {
  incidentUid: string;
  title: string;
  severity: string;
  confirmedAt: Date | null;
}

@Injectable()
export class QuarterRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // ── Cycle ───────────────────────────────────────────────────────────────
  async findCycleByUid(cycleUid: string) {
    const [row] = await this.db.select().from(quarterCycle).where(eq(quarterCycle.cycleUid, cycleUid));
    return row ?? null;
  }

  async findCycleByQuarter(quarter: string) {
    const [row] = await this.db.select().from(quarterCycle).where(eq(quarterCycle.quarter, quarter));
    return row ?? null;
  }

  async listCycles() {
    return this.db.select().from(quarterCycle).orderBy(desc(quarterCycle.quarter));
  }

  async insertCycle(values: typeof quarterCycle.$inferInsert) {
    const [row] = await this.db.insert(quarterCycle).values(values).onConflictDoNothing().returning();
    return row ?? (await this.findCycleByQuarter(values.quarter));
  }

  /** 召集评分会：cycle status scoring → panel，写 panel_at。返回更新后行（无则 null）。 */
  async setCyclePanel(cycleUid: string, panelAt: Date) {
    const [row] = await this.db
      .update(quarterCycle)
      .set({ status: 'panel', panelAt })
      .where(eq(quarterCycle.cycleUid, cycleUid))
      .returning();
    return row ?? null;
  }

  /** 某周期各 stage × enrolled 计数（进度统计）。 */
  async stageCounts(cycleUid: string): Promise<StageCountRow[]> {
    const rows = await this.db
      .select({
        stage: quarterTask.stage,
        enrolled: quarterTask.enrolled,
        count: sql<number>`count(*)::int`,
      })
      .from(quarterTask)
      .where(eq(quarterTask.cycleUid, cycleUid))
      .groupBy(quarterTask.stage, quarterTask.enrolled);
    return rows.map((r) => ({ stage: r.stage, enrolled: r.enrolled, count: r.count }));
  }

  // ── Task ────────────────────────────────────────────────────────────────
  async findTaskByUid(taskUid: string) {
    const [row] = await this.db.select().from(quarterTask).where(eq(quarterTask.taskUid, taskUid));
    return row ?? null;
  }

  async listTasksByCycle(cycleUid: string) {
    return this.db
      .select()
      .from(quarterTask)
      .where(eq(quarterTask.cycleUid, cycleUid))
      .orderBy(asc(quarterTask.rateeName));
  }

  async findTasksByRatee(candidates: string[]) {
    if (candidates.length === 0) return [];
    return this.db.select().from(quarterTask).where(inArray(quarterTask.rateeUserId, candidates));
  }

  async insertTasksIgnoreConflict(rows: (typeof quarterTask.$inferInsert)[]) {
    if (rows.length === 0) return 0;
    await this.db.insert(quarterTask).values(rows).onConflictDoNothing();
    return rows.length;
  }

  async updateTask(taskUid: string, values: Partial<typeof quarterTask.$inferInsert>) {
    const [row] = await this.db
      .update(quarterTask)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(quarterTask.taskUid, taskUid))
      .returning();
    return row ?? null;
  }

  // ── Sheet ─────────────────────────────────────────────────────────────────
  async findSheetByUid(sheetUid: string) {
    const [row] = await this.db.select().from(quarterSheet).where(eq(quarterSheet.sheetUid, sheetUid));
    return row ?? null;
  }

  async findSheetsByTask(taskUid: string) {
    return this.db.select().from(quarterSheet).where(eq(quarterSheet.taskUid, taskUid));
  }

  async findItemsBySheet(sheetUid: string) {
    return this.db
      .select()
      .from(quarterSheetItem)
      .where(eq(quarterSheetItem.sheetUid, sheetUid))
      .orderBy(asc(quarterSheetItem.id));
  }

  async insertSheetsIgnoreConflict(rows: (typeof quarterSheet.$inferInsert)[]) {
    if (rows.length === 0) return 0;
    await this.db.insert(quarterSheet).values(rows).onConflictDoNothing();
    return rows.length;
  }

  /** 我作为评分人的全部 sheet（join task 拿 ratee/stage/quarter）。 */
  async findSheetsByRater(candidates: string[]): Promise<SheetWithTask[]> {
    if (candidates.length === 0) return [];
    const rows = await this.db
      .select({ sheet: quarterSheet, task: quarterTask, cycleQuarter: quarterCycle.quarter })
      .from(quarterSheet)
      .leftJoin(quarterTask, eq(quarterTask.taskUid, quarterSheet.taskUid))
      .leftJoin(quarterCycle, eq(quarterCycle.cycleUid, quarterSheet.cycleUid))
      .where(inArray(quarterSheet.raterUserId, candidates))
      .orderBy(desc(quarterSheet.createdAt));
    return rows.map((r) => ({ sheet: r.sheet, task: r.task, cycleQuarter: r.cycleQuarter }));
  }

  /**
   * 原子提交一张 sheet：OCC 更新主表 + 全量替换明细 + 推进 task.stage
   * （+ 可选写 mgmt_trace 与建管理层 sheet）。版本不匹配返回 null（无副作用）。
   */
  async submitSheetAndAdvance(params: {
    sheetUid: string;
    version: number;
    sheetValues: Partial<typeof quarterSheet.$inferInsert>;
    itemRows: (typeof quarterSheetItem.$inferInsert)[];
    taskUid: string;
    newStage: string;
    mgmtTrace?: QuarterMgmtTrace | null;
    mgmtSheetRows?: (typeof quarterSheet.$inferInsert)[];
  }): Promise<typeof quarterSheet.$inferSelect | null> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quarterSheet)
        .set({ ...params.sheetValues, version: sql`${quarterSheet.version} + 1`, updatedAt: new Date() })
        .where(and(eq(quarterSheet.sheetUid, params.sheetUid), eq(quarterSheet.version, params.version)))
        .returning();
      if (!updated) return null; // OCC 失败：不动明细/任务

      await tx.delete(quarterSheetItem).where(eq(quarterSheetItem.sheetUid, params.sheetUid));
      if (params.itemRows.length > 0) {
        await tx.insert(quarterSheetItem).values(params.itemRows);
      }

      const taskUpdate: Partial<typeof quarterTask.$inferInsert> = {
        stage: params.newStage,
        updatedAt: new Date(),
      };
      if (params.mgmtTrace !== undefined && params.mgmtTrace !== null) {
        taskUpdate.mgmtTrace = params.mgmtTrace;
      }
      await tx.update(quarterTask).set(taskUpdate).where(eq(quarterTask.taskUid, params.taskUid));

      if (params.mgmtSheetRows && params.mgmtSheetRows.length > 0) {
        await tx.insert(quarterSheet).values(params.mgmtSheetRows).onConflictDoNothing();
      }
      return updated;
    });
  }

  /** 指定/换 peer 后落实 peer sheet：存在草稿则改评分人，否则新建（一任务一张 peer sheet）。 */
  async upsertPeerSheet(params: {
    taskUid: string;
    cycleUid: string;
    rateeUserId: string;
    peerUserId: string;
    peerName: string | null;
    sheetUid: string;
  }): Promise<typeof quarterSheet.$inferSelect> {
    const [updated] = await this.db
      .update(quarterSheet)
      .set({ raterUserId: params.peerUserId, raterName: params.peerName, updatedAt: new Date() })
      .where(and(eq(quarterSheet.taskUid, params.taskUid), eq(quarterSheet.raterRole, 'peer')))
      .returning();
    if (updated) return updated;
    const [inserted] = await this.db
      .insert(quarterSheet)
      .values({
        sheetUid: params.sheetUid,
        cycleUid: params.cycleUid,
        taskUid: params.taskUid,
        rateeUserId: params.rateeUserId,
        raterUserId: params.peerUserId,
        raterName: params.peerName,
        raterRole: 'peer',
        status: 'draft',
      })
      .returning();
    return inserted;
  }

  // ── Peer assignment ─────────────────────────────────────────────────────
  async findPeerAssignment(cycleUid: string, rateeUserId: string) {
    const [row] = await this.db
      .select()
      .from(peerAssignment)
      .where(and(eq(peerAssignment.cycleUid, cycleUid), eq(peerAssignment.rateeUserId, rateeUserId)));
    return row ?? null;
  }

  async findPeerHistory(rateeUserId: string): Promise<{ quarter: string; peerId: string }[]> {
    const rows = await this.db
      .select({ quarter: peerAssignment.quarter, peerId: peerAssignment.peerUserId })
      .from(peerAssignment)
      .where(eq(peerAssignment.rateeUserId, rateeUserId));
    return rows;
  }

  async listPeerAssignmentsByCycle(cycleUid: string) {
    return this.db.select().from(peerAssignment).where(eq(peerAssignment.cycleUid, cycleUid));
  }

  /** 指定/换 peer（(cycle,ratee) 唯一 → upsert）。 */
  async upsertPeerAssignment(values: typeof peerAssignment.$inferInsert) {
    const [row] = await this.db
      .insert(peerAssignment)
      .values(values)
      .onConflictDoUpdate({
        target: [peerAssignment.cycleUid, peerAssignment.rateeUserId],
        set: {
          peerUserId: values.peerUserId,
          peerName: values.peerName,
          assignedBy: values.assignedBy,
          quarter: values.quarter,
        },
      })
      .returning();
    return row;
  }

  // ── Template ──────────────────────────────────────────────────────────────
  async findTemplateWithDimensions(templateUid: string): Promise<TemplateWithDimensions | null> {
    const [tpl] = await this.db.select().from(scoreTemplate).where(eq(scoreTemplate.templateUid, templateUid));
    if (!tpl) return null;
    const dimensions = await this.db
      .select()
      .from(scoreDimension)
      .where(eq(scoreDimension.templateUid, templateUid))
      .orderBy(asc(scoreDimension.sort));
    return { template: tpl, dimensions };
  }

  /** 两个 active 季度模板 uid（未 seed 返回 null）。 */
  async findActiveQuarterTemplates(): Promise<{ employeeUid: string | null; leaderUid: string | null }> {
    const rows = await this.db
      .select()
      .from(scoreTemplate)
      .where(
        and(
          inArray(scoreTemplate.code, ['quarterly_employee', 'quarterly_leader']),
          eq(scoreTemplate.active, true),
        ),
      );
    const byCode = new Map(rows.map((r) => [r.code, r.templateUid]));
    return {
      employeeUid: byCode.get('quarterly_employee') ?? null,
      leaderUid: byCode.get('quarterly_leader') ?? null,
    };
  }

  // ── Org / perf_role / departments（开窗 + 排除规则用）─────────────────────
  async listAllOrgRows() {
    return this.db.select().from(orgCache);
  }

  async listAllPerfRoles() {
    return this.db.select().from(perfRole);
  }

  async listManagementRoleRows(): Promise<{ userId: string; openId: string | null }[]> {
    const rows = await this.db
      .select({ userId: perfRole.userId, openId: perfRole.openId })
      .from(perfRole)
      .where(eq(perfRole.isManagement, true));
    return rows;
  }

  async findPerfRoleFlags(candidates: string[]): Promise<{ isLeader: boolean; isManagement: boolean } | null> {
    if (candidates.length === 0) return null;
    const [row] = await this.db
      .select({ isLeader: perfRole.isLeader, isManagement: perfRole.isManagement })
      .from(perfRole)
      .where(or(inArray(perfRole.userId, candidates), inArray(perfRole.openId, candidates)))
      .limit(1);
    return row ?? null;
  }

  async findOrgByCandidates(candidates: string[]) {
    if (candidates.length === 0) return null;
    const [row] = await this.db
      .select()
      .from(orgCache)
      .where(or(inArray(orgCache.userId, candidates), inArray(orgCache.openId, candidates)))
      .limit(1);
    return row ?? null;
  }

  async listAllDepartments() {
    return this.db.select().from(feishuDepartment);
  }

  // ── Manager 打分侧栏 context ────────────────────────────────────────────
  async findMonthlyScores(rateeCandidates: string[], months: string[]): Promise<MonthlyBaseline[]> {
    if (rateeCandidates.length === 0 || months.length === 0) return [];
    const rows = await this.db
      .select({
        scoreMonth: monthlyScore.scoreMonth,
        score: monthlyScore.score,
        totalScore: monthlyScore.totalScore,
        grade: monthlyScore.grade,
        challengeNote: monthlyScore.challengeNote,
        status: monthlyScore.status,
      })
      .from(monthlyScore)
      .where(
        and(
          inArray(monthlyScore.rateeUserId, rateeCandidates),
          inArray(monthlyScore.scoreMonth, months),
        ),
      )
      .orderBy(asc(monthlyScore.scoreMonth));
    return rows;
  }

  /** 某被评人跨月的月度分（/me/performance 走势）：升序按月。 */
  async listMonthlyScoresByRatee(rateeCandidates: string[]) {
    if (rateeCandidates.length === 0) return [];
    return this.db
      .select({
        scoreMonth: monthlyScore.scoreMonth,
        score: monthlyScore.score,
        totalScore: monthlyScore.totalScore,
        composite: monthlyScore.composite,
        grade: monthlyScore.grade,
        redLine: monthlyScore.redLine,
        status: monthlyScore.status,
      })
      .from(monthlyScore)
      .where(inArray(monthlyScore.rateeUserId, rateeCandidates))
      .orderBy(asc(monthlyScore.scoreMonth));
  }

  /** 某月全员月度分（月度综合系数 CSV 导出）：按姓名排序。 */
  async listMonthlyScoresByMonth(month: string) {
    return this.db
      .select({
        scoreMonth: monthlyScore.scoreMonth,
        rateeUserId: monthlyScore.rateeUserId,
        rateeName: monthlyScore.rateeName,
        score: monthlyScore.score,
        totalScore: monthlyScore.totalScore,
        composite: monthlyScore.composite,
        grade: monthlyScore.grade,
        redLine: monthlyScore.redLine,
      })
      .from(monthlyScore)
      .where(eq(monthlyScore.scoreMonth, month))
      .orderBy(asc(monthlyScore.rateeName));
  }

  async findIncidentsForRatee(rateeCandidates: string[], months: string[]): Promise<IncidentRef[]> {
    if (rateeCandidates.length === 0 || months.length === 0) return [];
    // 月份过滤在 JS 侧做（drizzle 对 `= ANY(array)` 会展开成 `= ANY(($2,$3,..))` 非法 SQL）。
    const rows = await this.db
      .select({
        incidentUid: incident.incidentUid,
        title: incident.title,
        severity: incident.severity,
        confirmedAt: incident.confirmedAt,
        month: sql<string>`TO_CHAR(${incident.createdAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')`,
      })
      .from(incident)
      .innerJoin(incidentUser, eq(incidentUser.incidentUid, incident.incidentUid))
      .where(and(inArray(incidentUser.userId, rateeCandidates), sql`${incident.deletedAt} IS NULL`));
    const monthSet = new Set(months);
    return rows
      .filter((r) => monthSet.has(r.month))
      .map((r) => ({
        incidentUid: r.incidentUid,
        title: r.title,
        severity: r.severity,
        confirmedAt: r.confirmedAt ?? null,
      }));
  }

  // ── Goal ────────────────────────────────────────────────────────────────
  async findGoal(half: string, rateeCandidates: string[]) {
    if (rateeCandidates.length === 0) return null;
    const [row] = await this.db
      .select()
      .from(quarterGoal)
      .where(and(eq(quarterGoal.half, half), inArray(quarterGoal.rateeUserId, rateeCandidates)))
      .limit(1);
    return row ?? null;
  }

  async findGoalByUid(goalUid: string) {
    const [row] = await this.db.select().from(quarterGoal).where(eq(quarterGoal.goalUid, goalUid));
    return row ?? null;
  }

  async listGoals(rateeCandidates: string[], half?: string) {
    if (rateeCandidates.length === 0) return [];
    const conditions = [inArray(quarterGoal.rateeUserId, rateeCandidates)];
    if (half) conditions.push(eq(quarterGoal.half, half));
    return this.db
      .select()
      .from(quarterGoal)
      .where(and(...conditions))
      .orderBy(desc(quarterGoal.half));
  }

  async insertGoal(values: typeof quarterGoal.$inferInsert) {
    const [row] = await this.db.insert(quarterGoal).values(values).returning();
    return row;
  }

  /** 改目标内容并写 revision（同事务）。 */
  async updateGoalWithRevision(
    goalUid: string,
    newContent: string,
    revision: typeof quarterGoalRevision.$inferInsert,
  ) {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quarterGoal)
        .set({ content: newContent, updatedAt: new Date() })
        .where(eq(quarterGoal.goalUid, goalUid))
        .returning();
      if (!updated) return null;
      await tx.insert(quarterGoalRevision).values(revision);
      return updated;
    });
  }

  // ── 目标提案流（P4b）───────────────────────────────────────────────────────
  /** 员工发起：挂一条待确认提案（proposedContent/by/at）。 */
  async setGoalProposal(
    goalUid: string,
    values: { proposedContent: string; proposedBy: string; proposedAt: Date },
  ) {
    const [row] = await this.db
      .update(quarterGoal)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(quarterGoal.goalUid, goalUid))
      .returning();
    return row ?? null;
  }

  /** 直属接受提案：应用为正式内容 + 清空提案 + 写 revision（同事务）。 */
  async applyGoalProposal(
    goalUid: string,
    newContent: string,
    revision: typeof quarterGoalRevision.$inferInsert,
  ) {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quarterGoal)
        .set({ content: newContent, proposedContent: null, proposedBy: null, proposedAt: null, updatedAt: new Date() })
        .where(eq(quarterGoal.goalUid, goalUid))
        .returning();
      if (!updated) return null;
      await tx.insert(quarterGoalRevision).values(revision);
      return updated;
    });
  }

  /** 直属驳回提案：清空提案 + 写留痕 revision（不改正式内容，同事务）。 */
  async clearGoalProposal(goalUid: string, revision: typeof quarterGoalRevision.$inferInsert) {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quarterGoal)
        .set({ proposedContent: null, proposedBy: null, proposedAt: null, updatedAt: new Date() })
        .where(eq(quarterGoal.goalUid, goalUid))
        .returning();
      if (!updated) return null;
      await tx.insert(quarterGoalRevision).values(revision);
      return updated;
    });
  }

  /** 某目标的 revision 历史（升序，展示"谁改为什么"）。 */
  async listGoalRevisions(goalUid: string) {
    return this.db
      .select()
      .from(quarterGoalRevision)
      .where(eq(quarterGoalRevision.goalUid, goalUid))
      .orderBy(asc(quarterGoalRevision.createdAt));
  }
}
