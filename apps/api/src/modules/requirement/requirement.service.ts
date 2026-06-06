import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { RequirementRepository, type RequirementListFilter } from './requirement.repository';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode, RequirementStatus, RequirementTransitions } from '@leader-sync/shared-types';
import type { CreateRequirementDto, UpdateRequirementDto, LinkTasksDto, AddArtifactDto, ImpactPreviewDto } from './dto/requirement.dto';
import { computeImpact, type ImpactResult, type ProjectMeta } from './requirement.impact';
import { RequirementFeishuService } from './requirement-feishu.service';

const COMPANY_ID = process.env.COMPANY_ID ?? 'default';
const PM_ROLES: ReadonlySet<string> = new Set(['pmo', 'boss', 'admin']);

export interface Requester {
  userIds: string[];
  userName: string;
  role: string;
}

function genUid(): string {
  return `req_${nanoid(16)}`;
}

/** 是否有 PM(承接人) 权限管理该需求：pmo/boss/admin，或本人即该需求的承接 PM。 */
function canManage(req: { pmUserId?: string | null }, r: Requester): boolean {
  if (PM_ROLES.has(r.role)) return true;
  return !!req.pmUserId && r.userIds.includes(req.pmUserId);
}

/** 校验状态流转是否合法（前进/回退按 RequirementTransitions；任意态→rejected 允许）。 */
function isValidTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (to === RequirementStatus.REJECTED) return true;
  return (RequirementTransitions[from] ?? []).includes(to);
}

@Injectable()
export class RequirementService {
  private readonly logger = new Logger(RequirementService.name);
  constructor(
    private readonly repo: RequirementRepository,
    private readonly feishu: RequirementFeishuService,
  ) {}

  async create(reporter: { userId: string; userName: string }, dto: CreateRequirementDto) {
    if (dto.priority === 'P0' && !dto.expected_release_date) {
      throw new BusinessException(ErrorCode.INVALID_PARAMS, 'P0 需求必须填写期望上线时间', HttpStatus.BAD_REQUEST);
    }
    const requirementUid = genUid();
    const now = new Date();
    const created = await this.repo.insert({
      requirementUid,
      title: dto.title,
      value: dto.value ?? null,
      description: dto.description ?? null,
      businessLineUid: dto.business_line_uid,
      appProjectUid: dto.app_project_uid ?? null,
      source: dto.source ?? 'biz',
      priority: dto.priority,
      status: RequirementStatus.COLLECTED,
      reporterUserId: reporter.userId,
      reporterName: reporter.userName,
      expectedReleaseDate: dto.expected_release_date ?? null,
      companyId: COMPANY_ID,
      version: 1,
      createdBy: reporter.userId,
      createdAt: now,
      updatedAt: now,
    });
    // R3：新提 P0 → 算影响并飞书下发（不阻断创建）
    if (dto.priority === 'P0') this.dispatchP0Impact(created, 'create').catch(() => {});
    return created;
  }

  async list(requester: Requester, filter: Omit<RequirementListFilter, 'viewerUserIds'>) {
    const f: RequirementListFilter = { ...filter };
    if (!PM_ROLES.has(requester.role)) f.viewerUserIds = requester.userIds; // 行级安全
    return this.repo.list(f);
  }

  async getOne(uid: string, requester: Requester) {
    const req = await this.requireFound(uid);
    this.assertCanView(req, requester); // 行级安全：非 PM 仅可看自己提的/承接的
    const [artifacts, tasks] = await Promise.all([
      this.repo.findArtifacts(uid),
      this.repo.findTasksByRequirement(uid),
    ]);
    return { ...req, artifacts, tasks };
  }

  /** 编辑字段 + 状态流转（含回退/驳回）。状态流转校验合法性 + 权限。 */
  async update(uid: string, requester: Requester, dto: UpdateRequirementDto) {
    const req = await this.requireFound(uid);
    const isManager = canManage(req, requester);
    const values: Record<string, unknown> = { updatedBy: requester.userIds[0] };

    if (dto.status && dto.status !== req.status) {
      // 仅 PM/特权可流转；提出人不能推进状态
      if (!isManager) {
        throw new BusinessException(ErrorCode.UNAUTHORIZED, '仅 PM/管理员可流转需求状态', HttpStatus.FORBIDDEN);
      }
      if (!isValidTransition(req.status, dto.status)) {
        throw new BusinessException(ErrorCode.INVALID_PARAMS, `非法状态流转：${req.status} → ${dto.status}`, HttpStatus.BAD_REQUEST);
      }
      values.status = dto.status;
      // 留痕：流转 + 回退/驳回原因写入服务端日志（专用审计表为后续 schema 决策）
      this.logger.log(
        `requirement ${uid} 流转 ${req.status} -> ${dto.status} by ${requester.userIds[0]}` +
        (dto.transition_reason ? ` 原因: ${dto.transition_reason}` : ''),
      );
    }

    // 字段编辑：PM 可改全部；提出人仅在 collected 态可改自己的基础字段
    const editingFields = ['title', 'value', 'description', 'priority', 'target_version', 'acceptor_user_id', 'expected_release_date', 'est_effort_days']
      .some((k) => (dto as any)[k] !== undefined);
    if (editingFields) {
      const reporterEditable = req.status === RequirementStatus.COLLECTED && requester.userIds.includes(req.reporterUserId);
      if (!isManager && !reporterEditable) {
        throw new BusinessException(ErrorCode.UNAUTHORIZED, '无权编辑该需求', HttpStatus.FORBIDDEN);
      }
      if (dto.title !== undefined) values.title = dto.title;
      if (dto.value !== undefined) values.value = dto.value;
      if (dto.description !== undefined) values.description = dto.description;
      if (dto.priority !== undefined) values.priority = dto.priority;
      if (dto.target_version !== undefined) values.targetVersion = dto.target_version;
      if (dto.expected_release_date !== undefined) values.expectedReleaseDate = dto.expected_release_date;
      if (dto.est_effort_days !== undefined) values.estEffortDays = dto.est_effort_days == null ? null : String(dto.est_effort_days);
      if (dto.acceptor_user_id !== undefined) {
        values.acceptorUserId = dto.acceptor_user_id;
        const u = dto.acceptor_user_id ? await this.repo.findOrgUser(dto.acceptor_user_id) : null;
        values.acceptorName = u?.userName ?? dto.acceptor_user_id ?? null;
      }
    }
    values.version = (req.version ?? 1) + 1;
    const updated = await this.repo.update(uid, values as any);

    // R3：变更需求 → 升级为 P0 或 P0 改期 时重新算影响并飞书下发（不阻断更新）
    if (updated) {
      const becameP0 = dto.priority === 'P0' && req.priority !== 'P0';
      const reschedP0 = updated.priority === 'P0'
        && dto.expected_release_date !== undefined
        && dto.expected_release_date !== req.expectedReleaseDate;
      if (becameP0 || reschedP0) this.dispatchP0Impact(updated, 'change').catch(() => {});
    }
    return updated;
  }

  /** PM 认领：设承接人 = 当前用户；collected → analyzing。 */
  async claim(uid: string, requester: Requester) {
    const req = await this.requireFound(uid);
    if (!PM_ROLES.has(requester.role)) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '仅 PM(产品)/管理员可认领需求', HttpStatus.FORBIDDEN);
    }
    return this.repo.update(uid, {
      pmUserId: requester.userIds[0],
      pmName: requester.userName,
      status: req.status === RequirementStatus.COLLECTED ? RequirementStatus.ANALYZING : req.status,
      updatedBy: requester.userIds[0],
      version: (req.version ?? 1) + 1,
    });
  }

  /** 把现有任务挂到需求（拆解的落地原语）+ 回填工时。 */
  async linkTasks(uid: string, requester: Requester, dto: LinkTasksDto) {
    const req = await this.requireFound(uid);
    if (!canManage(req, requester)) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '仅 PM/管理员可挂载任务', HttpStatus.FORBIDDEN);
    }
    const wanted = Array.from(new Set(dto.task_uids));
    // 只允许挂同业务线/app、未挂需求的候选任务——防止越权把别的线/已删任务重挂过来
    const candidates = await this.repo.findLinkableTasks(this.scopeOf(req));
    const allowed = new Set(candidates.map((t) => t.taskUid));
    const illegal = wanted.filter((u) => !allowed.has(u));
    if (illegal.length > 0) {
      throw new BusinessException(ErrorCode.INVALID_PARAMS, `任务不在可挂载范围内：${illegal.join(', ')}`, HttpStatus.BAD_REQUEST);
    }
    // est_effort_days 在此为「每个任务」的工时，仅写任务；需求层总工时由 update 单独维护（不再用同一值覆盖需求）
    const updated = await this.repo.linkTasks(uid, wanted, dto.est_effort_days, dto.allocation_pct);
    return { linked: updated };
  }

  /** 候选任务（同业务线/app、未挂需求），供「挂载任务」选择。PM 才能看（与挂载同权）。 */
  async candidateTasks(uid: string, requester: Requester) {
    const req = await this.requireFound(uid);
    if (!canManage(req, requester)) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '仅 PM/管理员可查看候选任务', HttpStatus.FORBIDDEN);
    }
    return this.repo.findLinkableTasks(this.scopeOf(req));
  }

  /** 需求的项目范围（业务线 + 可选 app），去重。 */
  private scopeOf(req: { businessLineUid: string; appProjectUid: string | null }): string[] {
    return Array.from(new Set([req.businessLineUid, req.appProjectUid].filter((v): v is string => !!v)));
  }

  async addArtifact(uid: string, requester: Requester, dto: AddArtifactDto) {
    await this.requireFound(uid);
    return this.repo.insertArtifact({
      requirementUid: uid,
      type: dto.type,
      title: dto.title,
      url: dto.url ?? null,
      createdBy: requester.userIds[0],
    });
  }

  /** 需求维度甘特：每条需求一条 bar（开始=创建/任务最早开始；结束=期望上线/任务最晚截止）。 */
  async ganttRequirements(requester: Requester, filter: Omit<RequirementListFilter, 'viewerUserIds'>) {
    const reqs = await this.list(requester, filter);
    const spans = await this.repo.taskSpansByRequirement(reqs.map((r) => r.requirementUid));
    return reqs.map((r) => {
      const span = spans.get(r.requirementUid);
      const start = span?.start ?? r.createdAt;
      // 以 UTC 正午锚定日历日，跨时区渲染都落在同一天（避免 00:00 本地解析的隔日漂移）
      const end = r.expectedReleaseDate
        ? new Date(`${r.expectedReleaseDate}T12:00:00Z`)
        : span?.end ?? null;
      return {
        requirementUid: r.requirementUid,
        title: r.title,
        businessLineUid: r.businessLineUid,
        appProjectUid: r.appProjectUid,
        status: r.status,
        priority: r.priority,
        pmName: r.pmName,
        start,
        end,
        hasExplicitDeadline: !!r.expectedReleaseDate,
      };
    });
  }

  /** 人力容量甘特：按负责人聚合带投入度的任务，前端据此画每日负载/过载。全员负载属管理视图，限 PM/管理员。 */
  async capacity(requester: Requester) {
    if (!PM_ROLES.has(requester.role)) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '仅 PM/管理员可查看人力容量', HttpStatus.FORBIDDEN);
    }
    const tasks = await this.repo.capacityTasks();
    const byUser = new Map<string, { userId: string; userName: string; tasks: typeof tasks }>();
    for (const t of tasks) {
      const u = byUser.get(t.assigneeUserId) ?? { userId: t.assigneeUserId, userName: t.assigneeName, tasks: [] };
      u.tasks.push(t);
      byUser.set(t.assigneeUserId, u);
    }
    return Array.from(byUser.values());
  }

  /** R3：算 P0/变更影响 + 通知名单（不改期，供人工确认）。窗口=今天→期望上线。 */
  async impactPreview(dto: ImpactPreviewDto, now: Date = new Date()) {
    const { impact } = await this.buildImpact(dto.business_line_uid, dto.app_project_uid ?? null, dto.expected_release_date, now);
    return impact;
  }

  /** 影响评估底座：算范围、窗口、容量任务、项目元信息，返回结果 + 项目（供下发取 PIC open_id）。 */
  private async buildImpact(
    businessLineUid: string,
    appProjectUid: string | null,
    expectedReleaseDate: string,
    now: Date,
  ): Promise<{ impact: ImpactResult; projects: ProjectMeta[] }> {
    const scopeUids = Array.from(new Set([appProjectUid, businessLineUid].filter((v): v is string => !!v)));
    const windowStart = now.getTime();
    // 以 UTC 解析日期，避免随服务器时区漂移；过去的期望上线 → 钳到至少含当天，否则负载循环不执行会误报「无影响」
    const rawEnd = new Date(`${expectedReleaseDate}T23:59:59Z`).getTime();
    const windowEnd = Math.max(rawEnd, windowStart);
    const [tasks, projects] = await Promise.all([
      this.repo.capacityTasks(),
      this.repo.findProjects(scopeUids),
    ]);
    // 批量取项目 PIC 显示名（user_id 或 open_id 均可命中），免 N+1
    const picIds = projects.map((p) => p.picUserId).filter((v): v is string => !!v);
    const orgRows = await this.repo.findOrgUsersByIds(picIds);
    const nameByAnyId = new Map<string, string>();
    for (const u of orgRows) {
      if (u.userName) {
        nameByAnyId.set(u.userId, u.userName);
        if (u.openId) nameByAnyId.set(u.openId, u.userName);
      }
    }
    const picNames = new Map<string, string>();
    for (const id of picIds) {
      const n = nameByAnyId.get(id);
      if (n) picNames.set(id, n);
    }
    const impact = computeImpact({ scopeUids, windowStart, windowEnd, tasks, projects, picNames });
    return { impact, projects };
  }

  /** R3：算影响 + 飞书下发给受影响负责人 + 项目 PIC（open_id）。失败仅告警。 */
  private async dispatchP0Impact(
    req: { requirementUid: string; title: string; businessLineUid: string; appProjectUid: string | null; expectedReleaseDate: string | null },
    kind: 'create' | 'change',
    now: Date = new Date(),
  ): Promise<void> {
    try {
      if (!req.expectedReleaseDate) return; // 无期望上线 → 无窗口，不下发
      const { impact, projects } = await this.buildImpact(req.businessLineUid, req.appProjectUid, req.expectedReleaseDate, now);
      const rawIds = [
        ...impact.affectedPeople.map((p) => p.userId),
        ...projects.map((p) => p.picUserId).filter((v): v is string => !!v),
      ];
      const openIds = await this.resolveOpenIds(rawIds);
      await this.feishu.notifyP0Impact(openIds, {
        requirementUid: req.requirementUid,
        title: req.title,
        expectedReleaseDate: req.expectedReleaseDate,
        peopleCount: impact.summary.peopleCount,
        taskCount: impact.summary.taskCount,
        overloadedCount: impact.summary.overloadedCount,
        kind,
      });
    } catch (err) {
      this.logger.warn(`dispatchP0Impact failed for ${req.requirementUid}: ` + (err as Error).message);
    }
  }

  /** 把任意身份标识（user_id 或 open_id）解析为飞书 open_id：已是 ou_ 直接用；否则查 org_cache.open_id。 */
  private async resolveOpenIds(ids: string[]): Promise<string[]> {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    const direct = uniq.filter((id) => id.startsWith('ou_'));
    const toResolve = uniq.filter((id) => !id.startsWith('ou_'));
    if (toResolve.length === 0) return direct;
    const rows = await this.repo.findOrgUsersByIds(toResolve);
    const openByUserId = new Map<string, string>();
    for (const u of rows) if (u.openId) openByUserId.set(u.userId, u.openId);
    const resolved = toResolve.map((id) => openByUserId.get(id)).filter((v): v is string => !!v);
    return Array.from(new Set([...direct, ...resolved]));
  }

  /** 行级安全：PM/管理员可看全部；其余仅可看自己提的或自己承接的需求。 */
  private assertCanView(req: { reporterUserId: string; pmUserId?: string | null }, requester: Requester): void {
    if (PM_ROLES.has(requester.role)) return;
    const own = requester.userIds.includes(req.reporterUserId)
      || (!!req.pmUserId && requester.userIds.includes(req.pmUserId));
    if (!own) throw new BusinessException(ErrorCode.UNAUTHORIZED, '无权查看该需求', HttpStatus.FORBIDDEN);
  }

  private async requireFound(uid: string) {
    const req = await this.repo.findByUid(uid);
    if (!req) throw new BusinessException(ErrorCode.INVALID_PARAMS, '需求不存在', HttpStatus.NOT_FOUND);
    return req;
  }
}
