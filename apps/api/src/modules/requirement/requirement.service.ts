import { Injectable, HttpStatus } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { RequirementRepository, type RequirementListFilter } from './requirement.repository';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode, RequirementStatus, RequirementTransitions } from '@leader-sync/shared-types';
import type { CreateRequirementDto, UpdateRequirementDto, LinkTasksDto, AddArtifactDto, ImpactPreviewDto } from './dto/requirement.dto';
import { computeImpact } from './requirement.impact';

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
  constructor(private readonly repo: RequirementRepository) {}

  async create(reporter: { userId: string; userName: string }, dto: CreateRequirementDto) {
    if (dto.priority === 'P0' && !dto.expected_release_date) {
      throw new BusinessException(ErrorCode.INVALID_PARAMS, 'P0 需求必须填写期望上线时间', HttpStatus.BAD_REQUEST);
    }
    const requirementUid = genUid();
    const now = new Date();
    return this.repo.insert({
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
  }

  async list(requester: Requester, filter: Omit<RequirementListFilter, 'viewerUserIds'>) {
    const f: RequirementListFilter = { ...filter };
    if (!PM_ROLES.has(requester.role)) f.viewerUserIds = requester.userIds; // 行级安全
    return this.repo.list(f);
  }

  async getOne(uid: string) {
    const req = await this.requireFound(uid);
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
    return this.repo.update(uid, values as any);
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
    const updated = await this.repo.linkTasks(uid, Array.from(new Set(dto.task_uids)), dto.est_effort_days, dto.allocation_pct);
    if (dto.est_effort_days != null) {
      await this.repo.update(uid, { estEffortDays: String(dto.est_effort_days), updatedAt: new Date() } as any);
    }
    return { linked: updated };
  }

  /** 候选任务（同业务线/app、未挂需求），供「挂载任务」选择。 */
  async candidateTasks(uid: string) {
    const req = await this.requireFound(uid);
    const scope = [req.businessLineUid, req.appProjectUid].filter((v): v is string => !!v);
    return this.repo.findLinkableTasks(Array.from(new Set(scope)));
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
      const end = r.expectedReleaseDate
        ? new Date(`${r.expectedReleaseDate}T00:00:00`)
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

  /** 人力容量甘特：按负责人聚合带投入度的任务，前端据此画每日负载/过载。 */
  async capacity() {
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
    const scopeUids = Array.from(new Set([dto.app_project_uid, dto.business_line_uid].filter((v): v is string => !!v)));
    const windowStart = now.getTime();
    const windowEnd = new Date(`${dto.expected_release_date}T23:59:59`).getTime();
    const [tasks, projects] = await Promise.all([
      this.repo.capacityTasks(),
      this.repo.findProjects(scopeUids),
    ]);
    const picIds = projects.map((p) => p.picUserId).filter((v): v is string => !!v);
    const picNames = new Map<string, string>();
    await Promise.all(picIds.map(async (id) => {
      const u = await this.repo.findOrgUser(id);
      if (u?.userName) picNames.set(id, u.userName);
    }));
    return computeImpact({ scopeUids, windowStart, windowEnd, tasks, projects, picNames });
  }

  private async requireFound(uid: string) {
    const req = await this.repo.findByUid(uid);
    if (!req) throw new BusinessException(ErrorCode.INVALID_PARAMS, '需求不存在', HttpStatus.NOT_FOUND);
    return req;
  }
}
