import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  mgmtAverage,
  mergeSoft,
  quarterlyTotal,
  quarterlyGrade,
  halfYearTotal,
  quartersForHalf,
  promotionEligible,
  addWorkingDays,
  InvalidHalfFormatError,
  type Grade,
  type MgmtSheet,
} from '@leader-sync/domain-core';
import type { QuarterMgmtRaters, QuarterWeightsUsed } from '@leader-sync/db';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';
import { BusinessException } from '../../common/exceptions/business.exception';
import { QuarterRepository } from './quarter.repository';
import { QuarterResultRepository } from './quarter-result.repository';
import { QuarterNotifierService } from './quarter-notifier.service';
import type { Requestor } from './quarter.service';
import type { ComputeResultDto, ReviseResultDto } from './dto/result.dto';
import type { CreateAppealDto, HandleAppealDto } from './dto/appeal.dto';

// RBAC 角色集（打分身份 is_leader/is_management 另经 perf_role 查询叠加）。
const PANEL_RBAC = new Set<string>([UserRole.ADMIN, UserRole.PMO, UserRole.BOSS, UserRole.HR]);
const REVISE_RBAC = new Set<string>([UserRole.ADMIN, UserRole.BOSS]);
const PUBLISH_RBAC = new Set<string>([UserRole.ADMIN, UserRole.BOSS, UserRole.HR]);
const APPEAL_HANDLE_RBAC = new Set<string>([UserRole.ADMIN, UserRole.HR]);
const HALF_COMPUTE_RBAC = new Set<string>([UserRole.ADMIN, UserRole.BOSS, UserRole.HR]);
const EXPORT_RBAC = PANEL_RBAC; // admin/hr/pmo/boss

const REVISABLE_FIELDS = new Set(['goal_score', 'soft_merged', 'total', 'grade']);
const VALID_GRADES = new Set<Grade>(['S', 'A', 'B', 'C', 'D']);

function forbidden(msg: string): never {
  throw new BusinessException(ErrorCode.UNAUTHORIZED, msg, HttpStatus.FORBIDDEN);
}
function badRequest(msg: string): never {
  throw new BusinessException(ErrorCode.INVALID_PARAMS, msg, HttpStatus.BAD_REQUEST);
}
function notFound(msg: string): never {
  throw new BusinessException(ErrorCode.TASK_NOT_FOUND, msg, HttpStatus.NOT_FOUND);
}

function idCandidates(userId: string, openId?: string | null): string[] {
  return [...new Set([userId, openId].filter((x): x is string => Boolean(x)))];
}
function isSameUser(recordId: string | null, userId: string, openId?: string | null): boolean {
  if (!recordId) return false;
  return recordId === userId || (Boolean(openId) && recordId === openId);
}
function canonicalUserId(row: { userId: string; openId: string | null }): string {
  if (row.openId && row.openId.startsWith('ou_')) return row.openId;
  if (row.userId && row.userId.startsWith('ou_')) return row.userId;
  return row.userId;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class QuarterResultService {
  private readonly logger = new Logger(QuarterResultService.name);

  constructor(
    private readonly repo: QuarterRepository,
    private readonly resultRepo: QuarterResultRepository,
    private readonly notifier: QuarterNotifierService,
  ) {}

  // ═══════════════════════ 权限判定 ═══════════════════════

  private async isManagement(user: Requestor): Promise<boolean> {
    const pr = await this.repo.findPerfRoleFlags(idCandidates(user.userId, user.openId));
    return Boolean(pr?.isManagement);
  }

  /** 评分会看板 / 合成：管理层 or admin/pmo/boss/hr。 */
  private async assertCanPanel(user: Requestor) {
    if (PANEL_RBAC.has(user.role)) return;
    if (await this.isManagement(user)) return;
    forbidden('仅管理层 / boss / admin / hr 可查看评分会看板');
  }

  /** 评分会改分：管理层 or admin/boss。 */
  private async assertCanRevise(user: Requestor) {
    if (REVISE_RBAC.has(user.role)) return;
    if (await this.isManagement(user)) return;
    forbidden('仅管理层 / boss / admin 可在评分会改分');
  }

  // ═══════════════════════ 合成 ═══════════════════════

  async computeResult(taskUid: string, user: Requestor, dto: ComputeResultDto) {
    await this.assertCanPanel(user);
    const task = await this.repo.findTaskByUid(taskUid);
    if (!task) notFound('考核任务不存在');
    if (!task.enrolled) badRequest('该人员本季免评，无需合成');
    if (task.stage !== 'scored') badRequest('该被评人尚未完成全部打分，无法合成');
    const row = await this.computeOneTask(task, {
      redLine: dto.red_line,
      redLineNote: dto.red_line_note,
    });
    if (!row) badRequest('该结果已公示，不可重新合成');
    return row;
  }

  async batchCompute(cycleUid: string, user: Requestor) {
    await this.assertCanPanel(user);
    const cycle = await this.repo.findCycleByUid(cycleUid);
    if (!cycle) notFound('周期不存在');
    const tasks = await this.repo.listTasksByCycle(cycleUid);
    const scored = tasks.filter((t: any) => t.enrolled && t.stage === 'scored');
    const results: unknown[] = [];
    const skipped: string[] = [];
    for (const task of scored) {
      const row = await this.computeOneTask(task, {}); // 批量不改红线，保留各结果既有值
      if (row) results.push(this.shapeResult(row));
      else skipped.push(task.rateeName ?? task.rateeUserId);
    }
    return {
      computed: results.length,
      scoredTotal: scored.length,
      skippedPublished: skipped,
      results,
    };
  }

  /**
   * 单任务合成（幂等 upsert，draft）。已公示的结果返回 null（不覆盖）。
   * 从已提交 sheet 取数：manager(soft+goal)、peer(soft)、management[](soft)；
   * mgmt_avg = mgmtAverage(排除名单)；soft_merged = mergeSoft(mgmtRequired)；total/grade。
   */
  private async computeOneTask(
    task: any,
    opts: { redLine?: boolean; redLineNote?: string | null },
  ): Promise<Awaited<ReturnType<QuarterResultRepository['upsertResult']>> | null> {
    const existing = await this.resultRepo.findResultByTask(task.taskUid);
    if (existing && existing.status !== 'draft') return null;

    const sheets = await this.repo.findSheetsByTask(task.taskUid);
    const manager = sheets.find((s: any) => s.raterRole === 'manager' && s.status === 'submitted');
    if (!manager) badRequest('缺少已提交的直属评分，无法合成');
    const managerSoft = num(manager.softTotal) ?? 0;
    const goalScore = num(manager.goalScore) ?? 0;

    // 硬化1 · 同事缺席权重归直属：peer 缺席 = 无 peer sheet 或 sheet 未提交（peer_skipped）。
    // 缺席传 null（区别于「在场且打 0 分」传 0），交给 mergeSoft 四分支判定。
    const peer = sheets.find((s: any) => s.raterRole === 'peer' && s.status === 'submitted');
    const peerSoft: number | null = peer ? (num(peer.softTotal) ?? 0) : null;

    const mgmtSubmitted = sheets.filter((s: any) => s.raterRole === 'management' && s.status === 'submitted');
    const excludedIds: string[] = task.mgmtTrace?.excludedIds ?? [];
    const mgmtSheetsForAvg: MgmtSheet[] = mgmtSubmitted.map((s: any) => ({
      raterId: s.raterUserId,
      softTotal: num(s.softTotal) ?? 0,
    }));
    // mgmt 缺席 = 非 mgmt_required，或 mgmtAverage 返回 null（无评分人 / 全排除回退）。
    const mgmtAvg = task.mgmtRequired ? mgmtAverage(mgmtSheetsForAvg, excludedIds) : null;

    const merge = mergeSoft({ manager: managerSoft, mgmt: mgmtAvg, peer: peerSoft });
    const redLine = opts.redLine ?? existing?.redLine ?? false;
    const redLineNote = opts.redLineNote ?? existing?.redLineNote ?? null;
    const total = quarterlyTotal(goalScore, merge.merged);
    const grade = quarterlyGrade(total, redLine);

    const mgmtRaters: QuarterMgmtRaters = {
      rule: task.mgmtTrace?.rule ?? null,
      excludedIds,
      raterIds: task.mgmtTrace?.raterIds ?? [],
      scores: mgmtSubmitted.map((s: any) => ({
        raterId: s.raterUserId,
        raterName: s.raterName ?? null,
        soft: num(s.softTotal) ?? 0,
      })),
    };
    const weightsUsed = merge.usedWeights as QuarterWeightsUsed;

    return this.resultRepo.upsertResult({
      resultUid: existing?.resultUid ?? `qr_${nanoid(12)}`,
      cycleUid: task.cycleUid,
      taskUid: task.taskUid,
      rateeUserId: task.rateeUserId,
      rateeName: task.rateeName ?? null,
      sheetType: task.sheetType ?? null,
      goalScore: goalScore.toFixed(2),
      managerSoft: managerSoft.toFixed(2),
      peerSoft: peerSoft === null ? null : peerSoft.toFixed(2),
      mgmtAvg: mgmtAvg === null ? null : mgmtAvg.toFixed(2),
      softMerged: merge.merged.toFixed(2),
      total: total.toFixed(2),
      grade,
      redLine,
      redLineNote,
      weightsUsed,
      mgmtRaters,
      status: 'draft',
    });
  }

  // ═══════════════════════ 评分会看板 ═══════════════════════

  async getPanel(cycleUid: string, user: Requestor) {
    await this.assertCanPanel(user);
    const cycle = await this.repo.findCycleByUid(cycleUid);
    if (!cycle) notFound('周期不存在');

    const [tasks, results, managerAverages] = await Promise.all([
      this.repo.listTasksByCycle(cycleUid),
      this.resultRepo.listResultsByCycle(cycleUid),
      this.resultRepo.managerAveragesByCycle(cycleUid),
    ]);

    const resultByTask = new Map<string, any>(results.map((r: any) => [r.taskUid, r]));
    const enrolledTasks = tasks.filter((t: any) => t.enrolled);
    const rows = enrolledTasks.map((t: any) => {
      const r = resultByTask.get(t.taskUid);
      return {
        taskUid: t.taskUid,
        rateeUserId: t.rateeUserId,
        rateeName: t.rateeName,
        sheetType: t.sheetType,
        stage: t.stage,
        mgmtRequired: t.mgmtRequired,
        result: r ? this.shapeResult(r) : null,
      };
    });

    // 分布：按 grade 计数 + 分数段直方图
    const gradeCounts: Record<Grade, number> = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    const buckets = [
      { label: '<60', min: -Infinity, max: 60, count: 0 },
      { label: '60-69', min: 60, max: 70, count: 0 },
      { label: '70-79', min: 70, max: 80, count: 0 },
      { label: '80-89', min: 80, max: 90, count: 0 },
      { label: '≥90', min: 90, max: Infinity, count: 0 },
    ];
    for (const r of results as any[]) {
      const g = r.grade as Grade;
      if (g && g in gradeCounts) gradeCounts[g] += 1;
      const t = num(r.total);
      if (t !== null) {
        const b = buckets.find((x) => t >= x.min && t < x.max);
        if (b) b.count += 1;
      }
    }

    const sList = (results as any[]).filter((r) => r.grade === 'S').map((r) => this.shapeResult(r));
    const dList = (results as any[])
      .filter((r) => r.grade === 'D' || r.redLine)
      .map((r) => this.shapeResult(r));

    return {
      cycle,
      summary: {
        quarter: cycle.quarter,
        status: cycle.status,
        enrolledCount: enrolledTasks.length,
        scoredCount: enrolledTasks.filter((t: any) => t.stage === 'scored').length,
        computedCount: results.length,
        publishedCount: (results as any[]).filter((r) => r.status !== 'draft').length,
      },
      distribution: { gradeCounts, buckets: buckets.map((b) => ({ label: b.label, count: b.count })) },
      rows,
      managerAverages: managerAverages.map((m) => ({
        raterUserId: m.raterUserId,
        raterName: m.raterName,
        count: m.count,
        avgTotal: Math.round(m.avgTotal * 10) / 10,
      })),
      sList,
      dList,
    };
  }

  private shapeResult(r: any) {
    return {
      resultUid: r.resultUid,
      taskUid: r.taskUid,
      cycleUid: r.cycleUid,
      rateeUserId: r.rateeUserId,
      rateeName: r.rateeName,
      sheetType: r.sheetType,
      goalScore: num(r.goalScore),
      managerSoft: num(r.managerSoft),
      peerSoft: num(r.peerSoft),
      mgmtAvg: num(r.mgmtAvg),
      softMerged: num(r.softMerged),
      total: num(r.total),
      grade: r.grade,
      redLine: r.redLine,
      redLineNote: r.redLineNote,
      weightsUsed: r.weightsUsed,
      mgmtRaters: r.mgmtRaters,
      status: r.status,
      publishedAt: r.publishedAt,
      appealDeadlineAt: r.appealDeadlineAt,
    };
  }

  // ═══════════════════════ 改分（评分会） ═══════════════════════

  async reviseResult(resultUid: string, user: Requestor, dto: ReviseResultDto) {
    await this.assertCanRevise(user);
    if (!REVISABLE_FIELDS.has(dto.field)) badRequest('不支持改动该字段');
    const result = await this.resultRepo.findResultByUid(resultUid);
    if (!result) notFound('合成结果不存在');
    if (result.status !== 'draft') forbidden('结果已公示，不可再改分');

    const updates: Record<string, unknown> = {};
    let before: string | null;
    const after = dto.after.trim();

    if (dto.field === 'goal_score' || dto.field === 'soft_merged') {
      const v = Number(after);
      if (!Number.isFinite(v) || v < 0) badRequest('分值须为非负数');
      const goal = dto.field === 'goal_score' ? v : (num(result.goalScore) ?? 0);
      const soft = dto.field === 'soft_merged' ? v : (num(result.softMerged) ?? 0);
      const total = quarterlyTotal(goal, soft);
      const grade = quarterlyGrade(total, result.redLine);
      before = dto.field === 'goal_score' ? (result.goalScore ?? null) : (result.softMerged ?? null);
      if (dto.field === 'goal_score') updates.goalScore = v.toFixed(2);
      else updates.softMerged = v.toFixed(2);
      updates.total = total.toFixed(2);
      updates.grade = grade;
    } else if (dto.field === 'total') {
      const v = Number(after);
      if (!Number.isFinite(v)) badRequest('总分须为数字');
      before = result.total ?? null;
      updates.total = v.toFixed(2); // 直接改 total 仅记录，不联动 grade
    } else {
      // grade
      const g = after.toUpperCase() as Grade;
      if (!VALID_GRADES.has(g)) badRequest('评级须为 S/A/B/C/D');
      before = result.grade ?? null;
      updates.grade = g;
    }

    const updated = await this.resultRepo.updateResultWithRevision(resultUid, updates, {
      revisionUid: `qrr_${nanoid(12)}`,
      resultUid,
      field: dto.field,
      before,
      after,
      reason: dto.reason,
      revisedBy: user.userId,
    });
    if (!updated) notFound('合成结果不存在');
    return { result: this.shapeResult(updated) };
  }

  // ═══════════════════════ 公示 ═══════════════════════

  async publishCycle(cycleUid: string, user: Requestor) {
    if (!PUBLISH_RBAC.has(user.role)) forbidden('仅 admin / boss / hr 可公示出分');
    const cycle = await this.repo.findCycleByUid(cycleUid);
    if (!cycle) notFound('周期不存在');
    if (cycle.status === 'published' || cycle.status === 'closed') {
      badRequest('该周期已公示');
    }
    const all = await this.resultRepo.listResultsByCycle(cycleUid);
    const drafts = all.filter((r: any) => r.status === 'draft');
    if (drafts.length === 0) badRequest('无可公示的合成结果，请先批量合成');

    const publishedAt = new Date();
    const appealDeadlineAt = addWorkingDays(publishedAt, 3);
    const published = await this.resultRepo.publishDraftResults(cycleUid, publishedAt, appealDeadlineAt);
    await this.resultRepo.updateCycleStatus(cycleUid, 'published', publishedAt);

    // 公示卡片（best-effort，失败不阻塞）
    const deadlineText = appealDeadlineAt.toISOString().slice(0, 10);
    for (const r of drafts) {
      try {
        const openId = await this.resultRepo.resolveOpenId([r.rateeUserId]);
        await this.notifier.notifyPublished(openId, {
          rateeName: r.rateeName,
          quarter: cycle.quarter,
          total: num(r.total),
          grade: r.grade,
          deadlineText,
          resultUid: r.resultUid,
        });
      } catch (err) {
        this.logger.warn(`公示通知失败 ${r.rateeUserId}: ${(err as Error).message}`);
      }
    }

    return { published, appealDeadlineAt, quarter: cycle.quarter };
  }

  // ═══════════════════════ 被评人视角 ═══════════════════════

  async myResult(cycleUid: string, user: Requestor) {
    const candidates = idCandidates(user.userId, user.openId);
    const result = await this.resultRepo.findResultByCycleAndRatee(cycleUid, candidates);
    if (!result) return { result: null };
    if (result.status === 'draft') forbidden('本季成绩尚未公示');
    const appeals = await this.resultRepo.listAppealsByResult(result.resultUid);
    const openAppeal = appeals.find((a: any) => a.status === 'open') ?? null;
    return {
      result: this.shapeResult(result),
      appeal: appeals[0] ?? null,
      canAppeal: this.computeCanAppeal(result, Boolean(openAppeal)),
    };
  }

  async getResult(resultUid: string, user: Requestor) {
    const result = await this.resultRepo.findResultByUid(resultUid);
    if (!result) notFound('合成结果不存在');
    const rateeCandidates = await this.rateeCandidates(result.rateeUserId);
    const isSelf = rateeCandidates.some((c) => isSameUser(c, user.userId, user.openId));
    let canOversee = PANEL_RBAC.has(user.role);
    if (!canOversee) canOversee = await this.isManagement(user);
    // 直属也可看本人结果（spec §8：看本人结果 直属 ✓）
    if (!canOversee && !isSelf) {
      const rateeOrg = await this.repo.findOrgByCandidates([result.rateeUserId]);
      const isDirect = isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId);
      if (!isDirect) forbidden('无权查看该结果');
      canOversee = true;
    }
    if (isSelf && !canOversee && result.status === 'draft') forbidden('本季成绩尚未公示');

    const [revisions, appeals] = await Promise.all([
      this.resultRepo.listRevisionsByResult(resultUid),
      this.resultRepo.listAppealsByResult(resultUid),
    ]);
    const openAppeal = appeals.find((a: any) => a.status === 'open') ?? null;
    return {
      result: this.shapeResult(result),
      revisions,
      appeals,
      isSelf,
      canAppeal: isSelf && this.computeCanAppeal(result, Boolean(openAppeal)),
    };
  }

  private computeCanAppeal(result: any, hasOpenAppeal: boolean): boolean {
    if (result.status !== 'published') return false;
    if (hasOpenAppeal) return false;
    if (!result.appealDeadlineAt) return false;
    return new Date() <= new Date(result.appealDeadlineAt);
  }

  // ═══════════════════════ 申诉 ═══════════════════════

  async createAppeal(resultUid: string, user: Requestor, dto: CreateAppealDto) {
    const result = await this.resultRepo.findResultByUid(resultUid);
    if (!result) notFound('合成结果不存在');
    const rateeCandidates = await this.rateeCandidates(result.rateeUserId);
    if (!rateeCandidates.some((c) => isSameUser(c, user.userId, user.openId))) {
      forbidden('仅本人可对自己的成绩发起申诉');
    }
    if (result.status !== 'published') badRequest('成绩尚未公示，暂不可申诉');
    if (!result.appealDeadlineAt || new Date() > new Date(result.appealDeadlineAt)) {
      badRequest('申诉期已过，不可再申诉');
    }
    const open = await this.resultRepo.findOpenAppealByResult(resultUid);
    if (open) badRequest('已提交申诉，正在处理中');

    const canonical = await this.canonicalRatee(result.rateeUserId);
    const appeal = await this.resultRepo.insertAppeal({
      appealUid: `qap_${nanoid(12)}`,
      resultUid,
      rateeUserId: canonical,
      content: dto.content,
      status: 'open',
    });

    // 通知 hr（best-effort）
    try {
      const cycle = await this.repo.findCycleByUid(result.cycleUid);
      const hrOpenIds = await this.resultRepo.listHrOpenIds();
      await this.notifier.notifyAppeal(hrOpenIds, {
        rateeName: result.rateeName,
        quarter: cycle?.quarter ?? null,
        content: dto.content,
      });
    } catch (err) {
      this.logger.warn(`申诉通知 hr 失败: ${(err as Error).message}`);
    }
    return appeal;
  }

  async handleAppeal(appealUid: string, user: Requestor, dto: HandleAppealDto) {
    if (!APPEAL_HANDLE_RBAC.has(user.role)) forbidden('仅 hr / admin 可处理申诉');
    const appeal = await this.resultRepo.findAppealByUid(appealUid);
    if (!appeal) notFound('申诉不存在');
    if (appeal.status !== 'open') badRequest('该申诉已处理');
    const updated = await this.resultRepo.updateAppeal(appealUid, {
      status: dto.status,
      handler: user.userId,
      resolution: dto.resolution,
      resolvedAt: new Date(),
    });
    if (!updated) notFound('申诉不存在');
    return updated;
  }

  async listAppeals(cycle: string, user: Requestor) {
    if (!APPEAL_HANDLE_RBAC.has(user.role)) forbidden('仅 hr / admin 可查看申诉列表');
    if (!cycle) badRequest('缺少 cycle 参数（quarter 如 2026-Q3，或 cycle_uid）');
    // 兼容两种取值：quarter（YYYY-QN，panel 页习惯用法）或 cycle_uid
    let cycleUid = cycle;
    if (/^\d{4}-Q[1-4]$/.test(cycle)) {
      const cycleRow = await this.repo.findCycleByQuarter(cycle);
      if (!cycleRow) notFound(`周期 ${cycle} 不存在`);
      cycleUid = cycleRow.cycleUid;
    }
    const rows = await this.resultRepo.listAppealsByCycle(cycleUid);
    return {
      items: rows.map((r) => ({
        appealUid: r.appeal.appealUid,
        resultUid: r.appeal.resultUid,
        rateeUserId: r.appeal.rateeUserId,
        rateeName: r.rateeName,
        grade: r.grade,
        total: num(r.total),
        content: r.appeal.content,
        status: r.appeal.status,
        handler: r.appeal.handler,
        resolution: r.appeal.resolution,
        createdAt: r.appeal.createdAt,
        resolvedAt: r.appeal.resolvedAt,
      })),
    };
  }

  // ═══════════════════════ 半年合成（A）═══════════════════════

  /** 合成某半年成绩（admin/boss/hr）：对该半年有 published 结果的人算 40/60 或 single_100，幂等 upsert。 */
  async computeHalfYear(half: string, user: Requestor) {
    if (!HALF_COMPUTE_RBAC.has(user.role)) forbidden('仅 admin/boss/hr 可合成半年成绩');
    const { prev, curr } = this.parseHalf(half);

    const rows = await this.resultRepo.listPublishedResultsForQuarters([prev, curr]);
    const byRatee = new Map<string, { rateeName: string | null; prev: number | null; curr: number | null }>();
    for (const r of rows) {
      const g = byRatee.get(r.rateeUserId) ?? { rateeName: r.rateeName ?? null, prev: null, curr: null };
      if (r.rateeName && !g.rateeName) g.rateeName = r.rateeName;
      const t = num(r.total);
      if (r.quarter === prev) g.prev = t;
      else if (r.quarter === curr) g.curr = t;
      byRatee.set(r.rateeUserId, g);
    }

    const results: unknown[] = [];
    for (const [rateeUserId, g] of byRatee) {
      const hy = halfYearTotal(g.prev, g.curr);
      if (hy.total === null) continue; // 双季皆无（理论不会出现，因至少一季有分才进 map）
      const grade = quarterlyGrade(hy.total, false);
      const row = await this.resultRepo.upsertHalfYearResult({
        resultUid: `hyr_${nanoid(12)}`,
        half,
        rateeUserId,
        rateeName: g.rateeName,
        prevQuarter: prev,
        currQuarter: curr,
        prevTotal: g.prev === null ? null : g.prev.toFixed(2),
        currTotal: g.curr === null ? null : g.curr.toFixed(2),
        formula: hy.formula,
        total: hy.total.toFixed(2),
        grade,
      });
      results.push(this.shapeHalfYear(row));
    }
    return { half, prevQuarter: prev, currQuarter: curr, synthesized: results.length, results };
  }

  /** 读半年成绩：给 ratee_user_id → 本人/直属/管理角色可读；不给 → 仅管理角色读全部。 */
  async getHalfYear(half: string, rateeUserId: string | undefined, user: Requestor) {
    this.parseHalf(half); // 校验格式

    if (rateeUserId) {
      const candidates = await this.rateeCandidates(rateeUserId);
      const isSelf = candidates.some((c) => isSameUser(c, user.userId, user.openId));
      if (!isSelf && !PANEL_RBAC.has(user.role)) {
        const rateeOrg = await this.repo.findOrgByCandidates([rateeUserId]);
        const isDirect = isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId);
        if (!isDirect) forbidden('无权查看该半年成绩');
      }
      const items = await this.resultRepo.listHalfYearResults(half, candidates);
      return { half, items: items.map((r) => this.shapeHalfYear(r)) };
    }

    if (!PANEL_RBAC.has(user.role)) forbidden('仅管理角色可查看全部半年成绩');
    const items = await this.resultRepo.listHalfYearResults(half);
    return { half, items: items.map((r) => this.shapeHalfYear(r)) };
  }

  private parseHalf(half: string): { prev: string; curr: string } {
    if (!half) badRequest('缺少 half 参数（如 2026-H1 / 2026-H2）');
    try {
      return quartersForHalf(half);
    } catch (err) {
      if (err instanceof InvalidHalfFormatError) badRequest(err.message);
      throw err;
    }
  }

  private shapeHalfYear(r: any) {
    return {
      resultUid: r.resultUid,
      half: r.half,
      rateeUserId: r.rateeUserId,
      rateeName: r.rateeName,
      prevQuarter: r.prevQuarter,
      currQuarter: r.currQuarter,
      prevTotal: num(r.prevTotal),
      currTotal: num(r.currTotal),
      formula: r.formula,
      total: num(r.total),
      grade: r.grade,
      synthesizedAt: r.synthesizedAt,
    };
  }

  // ═══════════════════════ 定级定岗联动（B）═══════════════════════

  /** 定级定岗资格（本人/直属/管理角色）：当季 S 或连续两季 A 及以上。 */
  async getPromotionEligibility(rateeUserId: string, user: Requestor) {
    if (!rateeUserId) badRequest('缺少 ratee_user_id 参数');
    const candidates = await this.rateeCandidates(rateeUserId);
    const isSelf = candidates.some((c) => isSameUser(c, user.userId, user.openId));
    if (!isSelf && !PANEL_RBAC.has(user.role)) {
      const rateeOrg = await this.repo.findOrgByCandidates([rateeUserId]);
      const isDirect = isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId);
      if (!isDirect) forbidden('无权查看该定级资格');
    }
    const history = await this.resultRepo.listPublishedGradesByRatee(candidates);
    const elig = promotionEligible(history.map((h) => ({ quarter: h.quarter, grade: h.grade as Grade })));
    return { rateeUserId, eligible: elig.eligible, reason: elig.reason, basis: elig.basis, history };
  }

  /** 把 cycle 内每个 published 结果回填到该人最新 grade_history.score_snapshot（无记录则跳过 + warn）。 */
  async backfillGradeSnapshot(cycleUid: string, user: Requestor) {
    if (!PUBLISH_RBAC.has(user.role)) forbidden('仅 admin/boss/hr 可回填职级快照');
    const cycle = await this.repo.findCycleByUid(cycleUid);
    if (!cycle) notFound('周期不存在');
    const all = await this.resultRepo.listResultsByCycle(cycleUid);
    const published = (all as any[]).filter((r) => r.status === 'published' || r.status === 'closed');

    let backfilled = 0;
    const skipped: string[] = [];
    for (const r of published) {
      const candidates = await this.rateeCandidates(r.rateeUserId);
      const gh = await this.resultRepo.findLatestGradeHistory(candidates);
      if (!gh) {
        skipped.push(r.rateeName ?? r.rateeUserId);
        this.logger.warn(`回填职级快照跳过：${r.rateeUserId} 无 grade_history 记录`);
        continue;
      }
      const snapshot = {
        quarter: cycle.quarter,
        total: num(r.total),
        grade: r.grade,
        soft_merged: num(r.softMerged),
        goal_score: num(r.goalScore),
      };
      await this.resultRepo.updateGradeSnapshot(gh.recordUid, snapshot);
      backfilled += 1;
    }
    return { quarter: cycle.quarter, publishedCount: published.length, backfilled, skipped };
  }

  // ═══════════════════════ CSV 导出（C）═══════════════════════

  /** 导出 cycle 全部合成结果 CSV（admin/hr/pmo/boss）。返回带 UTF-8 BOM 的字符串。 */
  async exportCycleCsv(cycleUid: string, user: Requestor): Promise<{ filename: string; csv: string }> {
    if (!EXPORT_RBAC.has(user.role)) forbidden('仅 admin/hr/pmo/boss 可导出结果');
    const cycle = await this.repo.findCycleByUid(cycleUid);
    if (!cycle) notFound('周期不存在');
    const results = (await this.resultRepo.listResultsByCycle(cycleUid)) as any[];
    const deptMap = await this.resultRepo.deptNamesByRatees(results.map((r) => r.rateeUserId));

    const header = ['姓名', '部门', '类型', '目标分', '直属软项', '同事软项', '管理层均值', '软项合成', '总分', '评级', '权重组', '是否红线'];
    const lines = [header.map(csvEscape).join(',')];
    for (const r of results) {
      const cells = [
        r.rateeName ?? r.rateeUserId,
        deptMap.get(r.rateeUserId) ?? '',
        sheetTypeLabel(r.sheetType),
        csvNum(r.goalScore),
        csvNum(r.managerSoft),
        csvNum(r.peerSoft),
        csvNum(r.mgmtAvg),
        csvNum(r.softMerged),
        csvNum(r.total),
        r.grade ?? '',
        formatWeights(r.weightsUsed),
        r.redLine ? '是' : '否',
      ];
      lines.push(cells.map(csvEscape).join(','));
    }
    // UTF-8 BOM 防 Excel 打开中文乱码；CRLF 行分隔。
    const BOM = String.fromCharCode(0xfeff);
    const csv = BOM + lines.join('\r\n') + '\r\n';
    return { filename: `quarter-${cycle.quarter}-results.csv`, csv };
  }

  /**
   * 月度综合系数 CSV 导出（admin/hr/pmo/boss）。列：姓名/部门/月份/综合系数/评级/是否红线。
   * 综合系数优先取回写 composite；旧行退到 total/100，再退到 0–1 旧系数。带 UTF-8 BOM。
   */
  async exportMonthlyCsv(month: string, user: Requestor): Promise<{ filename: string; csv: string }> {
    if (!EXPORT_RBAC.has(user.role)) forbidden('仅 admin/hr/pmo/boss 可导出月度综合系数');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) badRequest('缺少或非法 month 参数（如 2026-06）');
    const rows = (await this.repo.listMonthlyScoresByMonth(month)) as any[];
    const deptMap = await this.resultRepo.deptNamesByRatees(rows.map((r) => r.rateeUserId));

    const header = ['姓名', '部门', '月份', '综合系数', '评级', '是否红线'];
    const lines = [header.map(csvEscape).join(',')];
    for (const r of rows) {
      const composite =
        num(r.composite) ?? (num(r.totalScore) !== null ? Math.round((num(r.totalScore)! / 100) * 100) / 100 : num(r.score));
      const cells = [
        r.rateeName ?? r.rateeUserId,
        deptMap.get(r.rateeUserId) ?? '',
        r.scoreMonth ?? month,
        composite === null ? '' : String(composite),
        r.grade ?? '',
        r.redLine ? '是' : '否',
      ];
      lines.push(cells.map(csvEscape).join(','));
    }
    const BOM = String.fromCharCode(0xfeff);
    const csv = BOM + lines.join('\r\n') + '\r\n';
    return { filename: `monthly-${month}-composite.csv`, csv };
  }

  // ═══════════════════════ 内部工具 ═══════════════════════

  private async rateeCandidates(rateeUserId: string): Promise<string[]> {
    const org = await this.repo.findOrgByCandidates([rateeUserId]);
    return [...new Set([rateeUserId, org?.userId, org?.openId].filter((x): x is string => Boolean(x)))];
  }

  private async canonicalRatee(rateeUserId: string): Promise<string> {
    const org = await this.repo.findOrgByCandidates([rateeUserId]);
    if (org) return canonicalUserId({ userId: org.userId, openId: org.openId });
    return rateeUserId;
  }
}

// ── CSV 辅助（模块私有）─────────────────────────────────────────────────────

/** CSV 字段转义：含逗号/引号/换行时用双引号包裹并转义内部引号。 */
function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** numeric 字段（字符串/NULL）→ CSV 用字符串（NULL/空 → 空）。 */
function csvNum(v: unknown): string {
  const n = num(v);
  return n === null ? '' : String(n);
}

function sheetTypeLabel(sheetType: string | null): string {
  if (sheetType === 'leader') return '管理者';
  if (sheetType === 'employee') return '员工';
  return sheetType ?? '';
}

/** weights_used → 中文可读串（如「直属0.55/管理0.35/同事0.1」）。缺席方不出现。 */
function formatWeights(w: { manager?: number; mgmt?: number; peer?: number } | null | undefined): string {
  if (!w) return '';
  const parts: string[] = [];
  if (w.manager !== undefined) parts.push(`直属${w.manager}`);
  if (w.mgmt !== undefined) parts.push(`管理${w.mgmt}`);
  if (w.peer !== undefined) parts.push(`同事${w.peer}`);
  return parts.join('/');
}
