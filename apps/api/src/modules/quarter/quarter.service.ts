import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  quarterBounds,
  halfForQuarter,
  planQuarterTasks,
  assembleQuarterMembers,
  validatePeerAssignment,
  quarterlyDimScore,
  softSum,
  InvalidRawScoreError,
  type QuarterMemberInput,
} from '@leader-sync/domain-core';
import type { QuarterMgmtTrace } from '@leader-sync/db';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  QuarterRepository,
  type TemplateWithDimensions,
  type MonthlyBaseline,
  type IncidentRef,
} from './quarter.repository';
import {
  computeQuarterStage,
  computeSheetLock,
  type QuarterSheetRole,
  type QuarterStage,
} from './quarter-logic';
import { QuarterNotifierService } from './quarter-notifier.service';
import { computeMgmtExclusions, type DeptNode, type MgmtMember, type OrgNode } from './quarter-exclusion';
import type { SubmitSheetDto } from './dto/submit-sheet.dto';
import type { AssignPeerDto } from './dto/assign-peer.dto';
import type { MgmtRequiredDto } from './dto/mgmt-required.dto';
import type { SetGoalDto, UpdateGoalDto, ProposeGoalDto, ConfirmGoalDto } from './dto/goal.dto';

export interface Requestor {
  userId: string;
  role: string;
  openId?: string | null;
}

export interface ManagerContext {
  quarter: string | null;
  monthlyBaselines: MonthlyBaseline[];
  goal: { content: string | null } | null;
  selfReference: unknown[] | null;
  incidents: IncidentRef[];
}

// 管理角色（RBAC）：可开周期、看全部、读任意 sheet。
const MANAGE_ROLES = new Set<string>([UserRole.ADMIN, UserRole.PMO, UserRole.BOSS, UserRole.HR]);
const CYCLE_OPEN_ROLES = MANAGE_ROLES;
// 召集评分会：admin/boss/hr（与公示同权限档）。
const CONVENE_ROLES = new Set<string>([UserRole.ADMIN, UserRole.BOSS, UserRole.HR]);
const PEER_ASSIGN_ROLES = new Set<string>([UserRole.ADMIN, UserRole.HR]);
const MGMT_FLAG_ROLES = new Set<string>([UserRole.ADMIN, UserRole.BOSS]);
const GOAL_ROLES = new Set<string>([UserRole.ADMIN]);

// mgmt_required 只能在 pending_self / pending_peer_manager 阶段修改
const MGMT_FLAG_EDITABLE_STAGES = new Set<QuarterStage>(['pending_self', 'pending_peer_manager']);

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

/** 取一行的 ou_ 句柄（openId 优先，否则 userId），都不是 ou_ 则 null。用于通知收件人解析。 */
function ouHandle(row: { userId?: string | null; openId?: string | null }): string | null {
  if (row.openId && row.openId.startsWith('ou_')) return row.openId;
  if (row.userId && row.userId.startsWith('ou_')) return row.userId;
  return null;
}

function forbidden(msg: string): never {
  throw new BusinessException(ErrorCode.UNAUTHORIZED, msg, HttpStatus.FORBIDDEN);
}
function badRequest(msg: string): never {
  throw new BusinessException(ErrorCode.INVALID_PARAMS, msg, HttpStatus.BAD_REQUEST);
}
function notFound(msg: string): never {
  throw new BusinessException(ErrorCode.TASK_NOT_FOUND, msg, HttpStatus.NOT_FOUND);
}

@Injectable()
export class QuarterService {
  private readonly logger = new Logger(QuarterService.name);

  constructor(
    private readonly repo: QuarterRepository,
    private readonly notifier: QuarterNotifierService,
  ) {}

  // ═══════════════════════ 开周期 ═══════════════════════

  async openCycle(quarter: string, user: Requestor) {
    if (!CYCLE_OPEN_ROLES.has(user.role)) {
      forbidden('仅 admin/pmo/boss/hr 可开季度周期');
    }
    return this.materializeCycle(quarter, new Date());
  }

  /**
   * 建 cycle（幂等）+ 规划任务/打分表（复用 domain-core 纯规划逻辑，与 worker 开窗一致）。
   * 已存在的 task 复用其 uid，只补齐缺失的 task/sheet（onConflictDoNothing）。
   */
  async materializeCycle(quarter: string, now: Date) {
    let cycle = await this.repo.findCycleByQuarter(quarter);
    if (!cycle) {
      const openAt = now;
      const deadlineAt = new Date(openAt.getTime() + 12 * 86_400_000);
      cycle = await this.repo.insertCycle({
        cycleUid: `qc_${nanoid(12)}`,
        quarter,
        status: 'scoring',
        openAt,
        deadlineAt,
      });
    }
    if (!cycle) notFound('周期创建失败');

    const [orgRows, perfRoles, peers, templates, existingTasks] = await Promise.all([
      this.repo.listAllOrgRows(),
      this.repo.listAllPerfRoles(),
      this.repo.listPeerAssignmentsByCycle(cycle.cycleUid),
      this.repo.findActiveQuarterTemplates(),
      this.repo.listTasksByCycle(cycle.cycleUid),
    ]);

    const members = assembleQuarterMembers({
      orgRows: orgRows.map((r: any) => ({
        userId: r.userId,
        openId: r.openId,
        userName: r.userName,
        managerUserId: r.managerUserId,
        joinedAt: r.joinedAt,
        scoreExempt: r.scoreExempt,
      })),
      perfRoles: perfRoles.map((r: any) => ({ userId: r.userId, openId: r.openId, isLeader: r.isLeader })),
      peers: peers.map((p: any) => ({ rateeUserId: p.rateeUserId, peerUserId: p.peerUserId, peerName: p.peerName })),
    });

    const planned = planQuarterTasks({
      quarter,
      openAt: cycle.openAt ?? now,
      members,
      employeeTemplateUid: templates.employeeUid,
      leaderTemplateUid: templates.leaderUid,
    });

    const existingByRatee = new Map<string, any>(existingTasks.map((t: any) => [t.rateeUserId, t]));
    const newTaskRows: any[] = [];
    const sheetRows: any[] = [];
    const warnings: string[] = [];

    for (const p of planned) {
      const existing = existingByRatee.get(p.rateeUserId);
      const taskUid = existing?.taskUid ?? `qt_${nanoid(12)}`;
      if (!existing) {
        newTaskRows.push({
          taskUid,
          cycleUid: cycle.cycleUid,
          rateeUserId: p.rateeUserId,
          rateeName: p.rateeName,
          sheetType: p.sheetType,
          templateUid: p.templateUid,
          mgmtRequired: p.mgmtRequired,
          mgmtReason: p.mgmtReason,
          enrolled: p.enrolled,
          skipReason: p.skipReason,
          stage: p.stage,
          stageDeadlines: p.stageDeadlines,
        });
      }
      for (const s of p.sheets) {
        sheetRows.push({
          sheetUid: `qs_${nanoid(12)}`,
          cycleUid: cycle.cycleUid,
          taskUid,
          rateeUserId: p.rateeUserId,
          raterUserId: s.raterUserId,
          raterName: s.raterName,
          raterRole: s.raterRole,
          status: 'draft',
        });
      }
      if (p.warnings.length > 0) {
        warnings.push(`${p.rateeName ?? p.rateeUserId}: ${p.warnings.join(',')}`);
      }
    }

    await this.repo.insertTasksIgnoreConflict(newTaskRows);
    await this.repo.insertSheetsIgnoreConflict(sheetRows);

    return {
      cycle,
      taskCount: planned.length,
      newTaskCount: newTaskRows.length,
      sheetCount: sheetRows.length,
      warnings,
    };
  }

  // ═══════════════════════ 周期列表/详情 ═══════════════════════

  async listCycles(user: Requestor) {
    const cycles = await this.repo.listCycles();
    if (MANAGE_ROLES.has(user.role)) {
      const withProgress = await Promise.all(
        cycles.map(async (c: any) => ({ ...c, progress: this.summarizeStages(await this.repo.stageCounts(c.cycleUid)) })),
      );
      return { items: withProgress, canManage: true };
    }
    // 普通人：只回自己相关的周期（有任务）
    const myTasks = await this.repo.findTasksByRatee(idCandidates(user.userId, user.openId));
    const myCycleUids = new Set(myTasks.map((t: any) => t.cycleUid));
    return { items: cycles.filter((c: any) => myCycleUids.has(c.cycleUid)), canManage: false };
  }

  async getCycle(cycleUid: string, user: Requestor) {
    const cycle = await this.repo.findCycleByUid(cycleUid);
    if (!cycle) notFound('周期不存在');
    if (MANAGE_ROLES.has(user.role)) {
      const [counts, tasks, peers] = await Promise.all([
        this.repo.stageCounts(cycleUid),
        this.repo.listTasksByCycle(cycleUid),
        this.repo.listPeerAssignmentsByCycle(cycleUid),
      ]);
      const peerByRatee = new Set(peers.map((p: any) => p.rateeUserId));
      return {
        cycle,
        progress: this.summarizeStages(counts),
        canManage: true,
        tasks: tasks.map((t: any) => ({
          taskUid: t.taskUid,
          rateeUserId: t.rateeUserId,
          rateeName: t.rateeName,
          sheetType: t.sheetType,
          stage: t.stage,
          enrolled: t.enrolled,
          skipReason: t.skipReason,
          mgmtRequired: t.mgmtRequired,
          selfSkipped: t.selfSkipped,
          peerAssigned: peerByRatee.has(t.rateeUserId),
        })),
      };
    }
    // 普通人：只在有关联任务时返回基本信息
    const myTasks = await this.repo.findTasksByRatee(idCandidates(user.userId, user.openId));
    if (!myTasks.some((t: any) => t.cycleUid === cycleUid)) {
      forbidden('无权查看该周期');
    }
    return { cycle, canManage: false };
  }

  // ═══════════════════════ 评分会召集（scoring → panel）═══════════════════════

  /**
   * 召集评分会（manual 端点与 worker 自动 job 共用同一口径）：
   * cycle status scoring → panel、写 panel_at=now；给全部 is_management 成员发召集卡。
   * 幂等：已 panel/published/closed → 跳过不改状态、不发卡。goal_check（未开窗）→ 400。
   * 通知失败 warn 不阻塞（沿用通知不冒泡契约）。
   */
  async convenePanel(cycleUid: string, user: Requestor) {
    if (!CONVENE_ROLES.has(user.role)) forbidden('仅 admin/boss/hr 可召集评分会');
    const cycle = await this.repo.findCycleByUid(cycleUid);
    if (!cycle) notFound('周期不存在');

    if (cycle.status === 'panel' || cycle.status === 'published' || cycle.status === 'closed') {
      return {
        convened: false,
        status: cycle.status,
        managementCount: 0,
        notified: 0,
        reason: '周期已召集或已公示，幂等跳过',
      };
    }
    if (cycle.status !== 'scoring') {
      badRequest('周期尚未进入打分阶段（scoring），无法召集评分会');
    }

    const now = new Date();
    const updated = await this.repo.setCyclePanel(cycleUid, now);
    const notify = await this.notifyManagementPanel(cycle, cycleUid);
    return {
      convened: true,
      status: 'panel',
      panelAt: now,
      pendingCount: notify.pendingCount,
      managementCount: notify.total,
      notified: notify.sent,
      cycle: updated,
    };
  }

  /** 给全部 is_management 成员发评分会召集卡（open_id 解析不到 warn 跳过；发送失败 warn 不阻塞）。 */
  private async notifyManagementPanel(
    cycle: { quarter: string | null },
    cycleUid: string,
  ): Promise<{ sent: number; total: number; pendingCount: number }> {
    const [tasks, mgmtRows, orgRows] = await Promise.all([
      this.repo.listTasksByCycle(cycleUid),
      this.repo.listManagementRoleRows(),
      this.repo.listAllOrgRows(),
    ]);
    // 待评人数 = 需管理层评分（enrolled 且 mgmt_required）的被评人数。
    const pendingCount = (tasks as any[]).filter((t) => t.enrolled && t.mgmtRequired).length;

    const nameByAnyId = new Map<string, string | null>();
    const openByAnyId = new Map<string, string | null>();
    for (const r of orgRows as any[]) {
      const ou = ouHandle(r);
      if (r.userId) {
        nameByAnyId.set(r.userId, r.userName ?? null);
        openByAnyId.set(r.userId, ou);
      }
      if (r.openId) {
        if (!nameByAnyId.has(r.openId)) nameByAnyId.set(r.openId, r.userName ?? null);
        if (!openByAnyId.has(r.openId)) openByAnyId.set(r.openId, ou);
      }
    }

    let sent = 0;
    let total = 0;
    for (const m of mgmtRows as any[]) {
      total += 1;
      const openId = ouHandle(m) ?? openByAnyId.get(m.userId) ?? null;
      if (!openId) {
        this.logger.warn(`评分会召集通知跳过：管理层成员 ${m.userId} 解析不到 open_id`);
        continue;
      }
      const managerName = nameByAnyId.get(m.userId) ?? (m.openId ? nameByAnyId.get(m.openId) ?? null : null);
      try {
        const ok = await this.notifier.notifyPanelReminder(openId, {
          managerName,
          quarter: cycle.quarter,
          cycleUid,
          pendingCount,
        });
        if (ok) sent += 1;
      } catch (err) {
        this.logger.warn(`评分会召集通知失败 ${m.userId}: ${(err as Error).message}`);
      }
    }
    return { sent, total, pendingCount };
  }

  private summarizeStages(counts: { stage: string; enrolled: boolean; count: number }[]) {
    const byStage: Record<string, number> = {
      pending_self: 0,
      pending_peer_manager: 0,
      pending_mgmt: 0,
      scored: 0,
    };
    let enrolled = 0;
    let skipped = 0;
    for (const c of counts) {
      if (c.enrolled) {
        byStage[c.stage] = (byStage[c.stage] ?? 0) + c.count;
        enrolled += c.count;
      } else {
        skipped += c.count;
      }
    }
    return { byStage, enrolled, skipped, total: enrolled + skipped };
  }

  // ═══════════════════════ 我的待办 ═══════════════════════

  async myTasks(user: Requestor) {
    const rows = await this.repo.findSheetsByRater(idCandidates(user.userId, user.openId));
    const groups: Record<string, unknown[]> = { self: [], peer: [], manager: [], management: [] };
    for (const { sheet, task, cycleQuarter } of rows) {
      const stage = (task?.stage ?? 'pending_self') as QuarterStage;
      const role = sheet.raterRole as QuarterSheetRole;
      const lock = computeSheetLock(role, stage, task?.selfSkipped ?? false);
      const item = {
        sheetUid: sheet.sheetUid,
        taskUid: sheet.taskUid,
        rateeName: task?.rateeName ?? sheet.rateeUserId,
        raterRole: role,
        status: sheet.status,
        stage,
        quarter: cycleQuarter,
        locked: sheet.status === 'submitted' ? false : lock.locked,
        lockReason: sheet.status === 'submitted' ? null : lock.reason,
      };
      (groups[role] ?? (groups[role] = [])).push(item);
    }
    return groups;
  }

  // ═══════════════════════ 打分页读取 ═══════════════════════

  async getSheet(sheetUid: string, user: Requestor) {
    const sheet = await this.repo.findSheetByUid(sheetUid);
    if (!sheet) notFound('打分表不存在');
    const task = await this.repo.findTaskByUid(sheet.taskUid);
    const stage = (task?.stage ?? 'pending_self') as QuarterStage;
    const role = sheet.raterRole as QuarterSheetRole;

    const isRater = isSameUser(sheet.raterUserId, user.userId, user.openId);
    let locked = false;
    if (isRater) {
      const lock = computeSheetLock(role, stage, task?.selfSkipped ?? false);
      if (lock.locked && sheet.status !== 'submitted') {
        forbidden(lock.reason ?? '当前环节未解锁');
      }
      locked = lock.locked;
    } else if (!(await this.canOversee(user))) {
      forbidden('无权查看该打分表');
    }

    const template = task?.templateUid
      ? await this.repo.findTemplateWithDimensions(task.templateUid)
      : null;
    const items = await this.repo.findItemsBySheet(sheetUid);

    const result: {
      sheet: unknown;
      task: unknown;
      raterRole: QuarterSheetRole;
      locked: boolean;
      notScored: boolean;
      template: TemplateWithDimensions | null;
      items: unknown[];
      context?: ManagerContext;
    } = {
      sheet,
      task,
      raterRole: role,
      locked,
      notScored: role === 'self', // 自评仅参照、不计分
      template,
      items,
    };

    if (role === 'manager' && task) {
      result.context = await this.buildManagerContext(task);
    }
    return result;
  }

  private async canOversee(user: Requestor): Promise<boolean> {
    if (MANAGE_ROLES.has(user.role)) return true;
    const pr = await this.repo.findPerfRoleFlags(idCandidates(user.userId, user.openId));
    return Boolean(pr?.isLeader || pr?.isManagement);
  }

  /** manager 打分页右侧栏：周期内月度底稿 + 半年目标 + 自评参照（已提交时）+ 关联事故。 */
  private async buildManagerContext(task: any): Promise<ManagerContext> {
    const cycle = await this.repo.findCycleByUid(task.cycleUid);
    const quarter = cycle?.quarter ?? null;
    const months = quarter ? monthsOfQuarter(quarter) : [];
    const rateeOrg = await this.repo.findOrgByCandidates([task.rateeUserId]);
    const rateeCandidates = [
      ...new Set(
        [task.rateeUserId, rateeOrg?.userId, rateeOrg?.openId].filter((x): x is string => Boolean(x)),
      ),
    ];

    const [monthlyBaselines, goal, sheets, incidents] = await Promise.all([
      this.repo.findMonthlyScores(rateeCandidates, months),
      quarter ? this.repo.findGoal(halfForQuarter(quarter), rateeCandidates) : Promise.resolve(null),
      this.repo.findSheetsByTask(task.taskUid),
      this.repo.findIncidentsForRatee(rateeCandidates, months),
    ]);

    const selfSheet = sheets.find((s: any) => s.raterRole === 'self');
    let selfReference: unknown[] | null = null;
    if (selfSheet && selfSheet.status === 'submitted') {
      selfReference = await this.repo.findItemsBySheet(selfSheet.sheetUid);
    }

    return { quarter, monthlyBaselines, goal, selfReference, incidents };
  }

  // ═══════════════════════ 打分提交 ═══════════════════════

  async submitSheet(sheetUid: string, user: Requestor, dto: SubmitSheetDto) {
    const sheet = await this.repo.findSheetByUid(sheetUid);
    if (!sheet) notFound('打分表不存在');
    const task = await this.repo.findTaskByUid(sheet.taskUid);
    if (!task) notFound('对应考核任务不存在');

    // 权限：仅本 sheet 的评分人可提交
    if (!isSameUser(sheet.raterUserId, user.userId, user.openId)) {
      forbidden('只有该打分表的评分人本人可提交');
    }
    // 只能从 draft 提交
    if (sheet.status !== 'draft') {
      badRequest('该打分表已提交，不可重复提交');
    }
    // 串行门控
    const role = sheet.raterRole as QuarterSheetRole;
    const stage = task.stage as QuarterStage;
    const lock = computeSheetLock(role, stage, task.selfSkipped);
    if (lock.locked) forbidden(lock.reason ?? '当前环节未解锁');

    // 模板 + 维度校验
    if (!task.templateUid) badRequest('该任务未盖章打分模板，无法打分');
    const tpl = await this.repo.findTemplateWithDimensions(task.templateUid);
    if (!tpl) badRequest('打分模板不存在或已下线');
    this.validateDimensions(dto, tpl);

    // goal_score（仅 manager）：0 ≤ x ≤ 模板 goal_weight
    let goalScoreStr: string | null = null;
    if (role === 'manager') {
      const goalWeight = tpl.template.goalWeight ?? 0;
      if (dto.goal_score === undefined || dto.goal_score === null) {
        badRequest('直属打分必须填写目标达成分');
      }
      if (!Number.isFinite(dto.goal_score) || dto.goal_score < 0 || dto.goal_score > goalWeight) {
        badRequest(`目标达成分须在 0–${goalWeight} 之间`);
      }
      goalScoreStr = dto.goal_score.toFixed(2);
    }

    // 计分（domain-core：越界抛 InvalidRawScoreError → 400）
    const weightByCode = new Map(tpl.dimensions.map((d) => [d.code, Number(d.weight)]));
    const nameByCode = new Map(tpl.dimensions.map((d) => [d.code, d.name]));
    let itemRows: any[];
    let soft: number;
    try {
      itemRows = dto.items.map((it) => {
        const weight = weightByCode.get(it.dimension_code)!;
        const weighted = quarterlyDimScore(it.raw, weight);
        return {
          itemUid: `qsi_${nanoid(12)}`,
          sheetUid,
          dimensionCode: it.dimension_code,
          dimensionName: nameByCode.get(it.dimension_code) ?? null,
          weight: weight.toFixed(2),
          raw: it.raw,
          weighted: weighted.toFixed(2),
        };
      });
      soft = softSum(dto.items.map((it) => ({ raw: it.raw, weight: weightByCode.get(it.dimension_code)! })));
    } catch (err) {
      if (err instanceof InvalidRawScoreError) badRequest(err.message);
      throw err;
    }

    // 由既有 sheet + 本次提交推导新 stage
    const sheets = await this.repo.findSheetsByTask(task.taskUid);
    const submittedNow = (r: QuarterSheetRole) => r === role;
    const findRole = (r: string) => sheets.find((s: any) => s.raterRole === r);
    const selfS = findRole('self');
    const mgrS = findRole('manager');
    const peerS = findRole('peer');
    const selfSubmitted = submittedNow('self') || selfS?.status === 'submitted';
    const selfDone = selfSubmitted || task.selfSkipped;
    const managerSubmitted = submittedNow('manager') || mgrS?.status === 'submitted';
    const managerDone = !mgrS || managerSubmitted; // 无直属 sheet 视为该环节无需等待

    // 硬化2 · 管理层全排除回退：直属完成 + mgmt_required + 管理层 sheet 尚未建时，
    //   先算排除名单；评分人为空（小部门/全在排除名单）→ 不建 sheet、不进 pending_mgmt，
    //   本任务按「无 mgmt」退化（mgmtRatersEmpty），留痕 rule='all_excluded_fallback' raterIds=[]。
    let mgmtSheetRows: any[] | undefined;
    let mgmtTrace: QuarterMgmtTrace | null = null;
    let mgmtRatersEmpty = false;
    const hasMgmtSheets = sheets.some((s: any) => s.raterRole === 'management');
    if (task.mgmtRequired && !hasMgmtSheets && selfDone && managerDone) {
      const built = await this.buildManagementSheets(task);
      if (built.rows.length === 0) {
        mgmtRatersEmpty = true;
        mgmtTrace = { rule: 'all_excluded_fallback', excludedIds: built.trace.excludedIds, raterIds: [] };
      } else {
        mgmtSheetRows = built.rows;
        mgmtTrace = built.trace;
      }
    }

    // 管理层 sheet 收口：本次提交的这张（若为 management）在库里仍是 draft，按已提交计入。
    const mgmtSheets = sheets.filter((s: any) => s.raterRole === 'management');
    const mgmtSheetsExist = mgmtSheets.length > 0;
    const allMgmtSubmitted =
      mgmtSheetsExist &&
      mgmtSheets.every((s: any) => s.status === 'submitted' || (role === 'management' && s.sheetUid === sheetUid));
    const newStage = computeQuarterStage({
      selfSubmitted,
      selfSkipped: task.selfSkipped,
      managerSheetExists: Boolean(mgrS),
      managerSubmitted,
      peerSheetExists: Boolean(peerS),
      peerSubmitted: submittedNow('peer') || peerS?.status === 'submitted',
      peerSkipped: task.peerSkipped, // 硬化3 · 同事超时放行视同完成
      mgmtRequired: task.mgmtRequired,
      mgmtRatersEmpty, // 硬化2
      mgmtSheetsExist,
      allMgmtSubmitted,
    });

    const updated = await this.repo.submitSheetAndAdvance({
      sheetUid,
      version: dto.version,
      sheetValues: {
        status: 'submitted',
        softTotal: soft.toFixed(2),
        goalScore: goalScoreStr,
        submittedAt: new Date(),
      },
      itemRows,
      taskUid: task.taskUid,
      newStage,
      mgmtTrace,
      mgmtSheetRows,
    });
    if (!updated) {
      throw new BusinessException(
        ErrorCode.VERSION_CONFLICT,
        '版本冲突，请刷新后重试',
        HttpStatus.CONFLICT,
      );
    }
    return { sheet: updated, stage: newStage, mgmtSheetsCreated: mgmtSheetRows?.length ?? 0 };
  }

  private validateDimensions(dto: SubmitSheetDto, tpl: TemplateWithDimensions) {
    const templateCodes = new Set(tpl.dimensions.map((d) => d.code));
    const seen = new Set<string>();
    for (const it of dto.items) {
      if (!templateCodes.has(it.dimension_code)) {
        badRequest(`维度 ${it.dimension_code} 不属于该打分模板`);
      }
      if (seen.has(it.dimension_code)) badRequest(`维度 ${it.dimension_code} 重复提交`);
      seen.add(it.dimension_code);
    }
    if (seen.size !== templateCodes.size) {
      badRequest('维度不完整：必须为模板全部软项维度各打一个分');
    }
  }

  /** 计算管理层评分排除名单并生成 draft sheet 行 + 留痕。 */
  private async buildManagementSheets(task: any): Promise<{ rows: any[]; trace: QuarterMgmtTrace }> {
    const [rateeOrg, allOrg, depts, mgmtRoleRows] = await Promise.all([
      this.repo.findOrgByCandidates([task.rateeUserId]),
      this.repo.listAllOrgRows(),
      this.repo.listAllDepartments(),
      this.repo.listManagementRoleRows(),
    ]);

    const orgByAnyId = new Map<string, OrgNode>();
    const nameByAnyId = new Map<string, string | null>();
    for (const r of allOrg as any[]) {
      const node: OrgNode = { userId: r.userId, openId: r.openId, managerUserId: r.managerUserId, deptId: r.deptId };
      if (r.userId) {
        orgByAnyId.set(r.userId, node);
        nameByAnyId.set(r.userId, r.userName ?? null);
      }
      if (r.openId) {
        if (!orgByAnyId.has(r.openId)) orgByAnyId.set(r.openId, node);
        if (!nameByAnyId.has(r.openId)) nameByAnyId.set(r.openId, r.userName ?? null);
      }
    }

    const deptsById = new Map<string, DeptNode>(
      (depts as any[]).map((d) => [
        d.deptId,
        { deptId: d.deptId, parentDeptId: d.parentDeptId, leaderUserId: d.leaderUserId, level: d.level },
      ]),
    );

    const ratee: OrgNode = rateeOrg
      ? { userId: rateeOrg.userId, openId: rateeOrg.openId, managerUserId: rateeOrg.managerUserId, deptId: rateeOrg.deptId }
      : { userId: task.rateeUserId, openId: null, managerUserId: null, deptId: null };

    const management: MgmtMember[] = (mgmtRoleRows as any[]).map((m) => {
      const raterUserId = canonicalUserId({ userId: m.userId, openId: m.openId });
      return {
        raterUserId,
        raterName: nameByAnyId.get(raterUserId) ?? nameByAnyId.get(m.userId) ?? null,
        idForms: [...new Set([m.userId, m.openId].filter((x): x is string => Boolean(x)))],
      };
    });

    const excl = computeMgmtExclusions({ ratee, management, deptsById, orgByAnyId });

    const rows = excl.raterIds.map((raterUserId) => ({
      sheetUid: `qs_${nanoid(12)}`,
      cycleUid: task.cycleUid,
      taskUid: task.taskUid,
      rateeUserId: task.rateeUserId,
      raterUserId,
      raterName: nameByAnyId.get(raterUserId) ?? null,
      raterRole: 'management',
      status: 'draft',
    }));

    return { rows, trace: { rule: excl.rule, excludedIds: excl.excludedIds, raterIds: excl.raterIds } };
  }

  // ═══════════════════════ 同事指定 ═══════════════════════

  async assignPeer(taskUid: string, user: Requestor, dto: AssignPeerDto) {
    const task = await this.repo.findTaskByUid(taskUid);
    if (!task) notFound('考核任务不存在');

    const rateeOrg = await this.repo.findOrgByCandidates([task.rateeUserId]);
    const managerUserId = rateeOrg?.managerUserId ?? null;
    const isDirect = isSameUser(managerUserId, user.userId, user.openId);
    if (!isDirect && !PEER_ASSIGN_ROLES.has(user.role)) {
      forbidden('仅被评人直属或 admin/hr 可指定同事评价人');
    }

    const peerId = dto.peer_user_id;
    if (isSameUser(task.rateeUserId, peerId) || isSameUser(rateeOrg?.userId ?? null, peerId) || isSameUser(rateeOrg?.openId ?? null, peerId)) {
      badRequest('同事评价人不能是被评人本人');
    }
    if (managerUserId && isSameUser(managerUserId, peerId)) {
      badRequest('同事评价人不能是被评人的直属领导');
    }

    // 已提交的 peer sheet 不许换
    const sheets = await this.repo.findSheetsByTask(taskUid);
    const peerSheet = sheets.find((s: any) => s.raterRole === 'peer');
    if (peerSheet && peerSheet.status === 'submitted') {
      badRequest('同事评价已提交，不可更换评价人');
    }

    // 连任校验（domain-core）
    const cycle = await this.repo.findCycleByUid(task.cycleUid);
    const quarter = cycle?.quarter;
    if (quarter) {
      const history = await this.repo.findPeerHistory(task.rateeUserId);
      const check = validatePeerAssignment(history, quarter, peerId);
      if (!check.ok) badRequest(check.reason ?? '同事指定不满足连任规则');
    }

    // 解析 peer 姓名
    const peerOrg = await this.repo.findOrgByCandidates([peerId]);
    const peerName = peerOrg?.userName ?? null;

    const assignment = await this.repo.upsertPeerAssignment({
      assignUid: `pa_${nanoid(12)}`,
      cycleUid: task.cycleUid,
      quarter: quarter ?? '',
      rateeUserId: task.rateeUserId,
      peerUserId: peerId,
      peerName,
      assignedBy: user.userId,
    });

    const sheet = await this.repo.upsertPeerSheet({
      taskUid,
      cycleUid: task.cycleUid,
      rateeUserId: task.rateeUserId,
      peerUserId: peerId,
      peerName,
      sheetUid: `qs_${nanoid(12)}`,
    });

    // 通知被指定同事（best-effort，失败不阻塞指定）。
    try {
      const peerOpenId = peerOrg?.openId ?? (peerId.startsWith('ou_') ? peerId : null);
      await this.notifier.notifyPeerAssigned(peerOpenId, {
        peerName,
        rateeName: task.rateeName ?? rateeOrg?.userName ?? null,
        quarter: quarter ?? null,
        sheetUid: sheet.sheetUid,
      });
    } catch (err) {
      this.logger.warn(`同事指定通知失败 ${peerId}: ${(err as Error).message}`);
    }

    return { assignment, sheet };
  }

  // ═══════════════════════ mgmt_required 勾选 ═══════════════════════

  async setMgmtRequired(taskUid: string, user: Requestor, dto: MgmtRequiredDto) {
    const task = await this.repo.findTaskByUid(taskUid);
    if (!task) notFound('考核任务不存在');

    const rateeOrg = await this.repo.findOrgByCandidates([task.rateeUserId]);
    const isDirect = isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId);
    if (!isDirect && !MGMT_FLAG_ROLES.has(user.role)) {
      forbidden('仅被评人直属或 admin/boss 可修改管理层评分标记');
    }

    if (task.sheetType === 'leader') {
      badRequest('leader 任务必进管理层评分，不可关闭');
    }
    if (!MGMT_FLAG_EDITABLE_STAGES.has(task.stage as QuarterStage)) {
      badRequest('打分已进入管理层/完成阶段，不可再修改管理层评分标记');
    }
    if (dto.required && !dto.reason?.trim()) {
      badRequest('勾选进管理层评分必须填写理由');
    }

    const updated = await this.repo.updateTask(taskUid, {
      mgmtRequired: dto.required,
      mgmtReason: dto.required ? dto.reason!.trim() : null,
    });
    return updated;
  }

  // ═══════════════════════ 半年目标 ═══════════════════════

  async setGoal(user: Requestor, dto: SetGoalDto) {
    await this.assertGoalWriter(dto.ratee_user_id, user);
    const rateeCandidates = await this.rateeCandidates(dto.ratee_user_id);
    const existing = await this.repo.findGoal(dto.half, rateeCandidates);
    if (existing) badRequest('该半年目标已存在，请改用修改接口');
    const canonical = await this.canonicalRatee(dto.ratee_user_id);
    return this.repo.insertGoal({
      goalUid: `qg_${nanoid(12)}`,
      half: dto.half,
      rateeUserId: canonical,
      content: dto.content,
      setBy: user.userId,
    });
  }

  async updateGoal(goalUid: string, user: Requestor, dto: UpdateGoalDto) {
    const goal = await this.repo.findGoalByUid(goalUid);
    if (!goal) notFound('目标不存在');
    await this.assertGoalWriter(goal.rateeUserId, user);
    const updated = await this.repo.updateGoalWithRevision(goalUid, dto.content, {
      revisionUid: `qgr_${nanoid(12)}`,
      goalUid,
      before: goal.content ?? null,
      after: dto.content,
      reason: dto.reason ?? null,
      revisedBy: user.userId,
    });
    if (!updated) notFound('目标不存在');
    return updated;
  }

  async getGoals(rateeUserId: string, half: string | undefined, user: Requestor) {
    const rateeCandidates = await this.rateeCandidates(rateeUserId);
    // 权限：本人 / 直属 / 管理角色
    const isSelf = rateeCandidates.some((c) => isSameUser(c, user.userId, user.openId));
    const rateeOrg = await this.repo.findOrgByCandidates([rateeUserId]);
    const isDirect = isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId);
    if (!isSelf && !isDirect && !MANAGE_ROLES.has(user.role)) {
      forbidden('无权查看该目标');
    }
    return this.repo.listGoals(rateeCandidates, half);
  }

  // ═══════════════════════ 目标提案流（P4b）═══════════════════════

  /** 员工（被评人本人）发起目标调整建议：写 pending 提案，不直接改正式内容。 */
  async proposeGoalChange(goalUid: string, user: Requestor, dto: ProposeGoalDto) {
    const goal = await this.repo.findGoalByUid(goalUid);
    if (!goal) notFound('目标不存在');
    await this.assertGoalProposer(goal.rateeUserId, user);
    if (goal.proposedAt) badRequest('已有待确认的调整建议，请等待直属处理');
    const content = dto.content.trim();
    if (!content) badRequest('调整建议内容不能为空');
    const updated = await this.repo.setGoalProposal(goalUid, {
      proposedContent: content,
      proposedBy: user.userId,
      proposedAt: new Date(),
    });
    if (!updated) notFound('目标不存在');
    return updated;
  }

  /** 直属确认目标提案：accept 应用为正式内容并写 revision；否则关提案并留痕。 */
  async confirmGoalProposal(goalUid: string, user: Requestor, dto: ConfirmGoalDto) {
    const goal = await this.repo.findGoalByUid(goalUid);
    if (!goal) notFound('目标不存在');
    await this.assertGoalWriter(goal.rateeUserId, user); // 仅直属 / admin 可确认
    if (!goal.proposedAt || !goal.proposedContent) badRequest('无待确认的调整建议');

    if (dto.accept) {
      const updated = await this.repo.applyGoalProposal(goalUid, goal.proposedContent, {
        revisionUid: `qgr_${nanoid(12)}`,
        goalUid,
        before: goal.content ?? null,
        after: goal.proposedContent,
        reason: dto.reason ?? '直属确认接受员工调整建议',
        revisedBy: user.userId,
      });
      if (!updated) notFound('目标不存在');
      return { goal: updated, applied: true };
    }

    const updated = await this.repo.clearGoalProposal(goalUid, {
      revisionUid: `qgr_${nanoid(12)}`,
      goalUid,
      before: goal.content ?? null,
      after: goal.content ?? null, // 驳回不改正式内容
      reason: `[驳回] ${dto.reason ?? ''}｜原提案：${goal.proposedContent}`.trim(),
      revisedBy: user.userId,
    });
    if (!updated) notFound('目标不存在');
    return { goal: updated, applied: false };
  }

  /** 目标 revision 历史（本人 / 直属 / 管理角色可读）。 */
  async getGoalRevisions(goalUid: string, user: Requestor) {
    const goal = await this.repo.findGoalByUid(goalUid);
    if (!goal) notFound('目标不存在');
    const rateeCandidates = await this.rateeCandidates(goal.rateeUserId);
    const isSelf = rateeCandidates.some((c) => isSameUser(c, user.userId, user.openId));
    const rateeOrg = await this.repo.findOrgByCandidates([goal.rateeUserId]);
    const isDirect = isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId);
    if (!isSelf && !isDirect && !MANAGE_ROLES.has(user.role)) forbidden('无权查看该目标历史');
    return this.repo.listGoalRevisions(goalUid);
  }

  /** 发起提案者：被评人本人 / 直属 / admin（双方可发起）。 */
  private async assertGoalProposer(rateeUserId: string, user: Requestor) {
    if (GOAL_ROLES.has(user.role)) return;
    const rateeCandidates = await this.rateeCandidates(rateeUserId);
    if (rateeCandidates.some((c) => isSameUser(c, user.userId, user.openId))) return; // 本人
    const rateeOrg = await this.repo.findOrgByCandidates([rateeUserId]);
    if (isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId)) return; // 直属
    forbidden('仅被评人本人 / 直属 / admin 可发起目标调整建议');
  }

  private async assertGoalWriter(rateeUserId: string, user: Requestor) {
    if (GOAL_ROLES.has(user.role)) return;
    const rateeOrg = await this.repo.findOrgByCandidates([rateeUserId]);
    if (!isSameUser(rateeOrg?.managerUserId ?? null, user.userId, user.openId)) {
      forbidden('仅被评人直属或 admin 可设定/修改半年目标');
    }
  }

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

/** 季度覆盖的月份（'YYYY-MM'）。 */
function monthsOfQuarter(quarter: string): string[] {
  const { start, end } = quarterBounds(quarter);
  const months: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    months.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}
