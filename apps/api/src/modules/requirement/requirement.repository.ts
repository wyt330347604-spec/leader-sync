import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { requirement, requirementArtifact, task, orgCache, project } from '@leader-sync/db';
import { eq, and, sql, inArray, desc, getTableColumns } from 'drizzle-orm';

export interface RequirementListFilter {
  businessLineUid?: string;
  appProjectUid?: string;
  status?: string;
  pmUserId?: string;
  priority?: string;
  targetVersion?: string;
  viewerUserIds?: string[]; // 行级安全：仅看自己提的/承接的（特权角色不传）
}

@Injectable()
export class RequirementRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async insert(values: typeof requirement.$inferInsert) {
    const [r] = await this.db.insert(requirement).values(values).returning();
    return r;
  }

  async findByUid(uid: string) {
    const [r] = await this.db
      .select()
      .from(requirement)
      .where(and(eq(requirement.requirementUid, uid), sql`${requirement.deletedAt} IS NULL`));
    return r || null;
  }

  async update(uid: string, values: Partial<typeof requirement.$inferInsert>) {
    const [r] = await this.db
      .update(requirement)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(requirement.requirementUid, uid))
      .returning();
    return r || null;
  }

  async list(filter: RequirementListFilter) {
    const conds = [sql`${requirement.deletedAt} IS NULL`];
    if (filter.businessLineUid) conds.push(eq(requirement.businessLineUid, filter.businessLineUid));
    if (filter.appProjectUid) conds.push(eq(requirement.appProjectUid, filter.appProjectUid));
    if (filter.status) conds.push(eq(requirement.status, filter.status));
    if (filter.pmUserId) conds.push(eq(requirement.pmUserId, filter.pmUserId));
    if (filter.priority) conds.push(eq(requirement.priority, filter.priority));
    if (filter.targetVersion) conds.push(eq(requirement.targetVersion, filter.targetVersion));
    if (filter.viewerUserIds && filter.viewerUserIds.length > 0) {
      conds.push(
        sql`(${inArray(requirement.reporterUserId, filter.viewerUserIds)} OR ${inArray(requirement.pmUserId, filter.viewerUserIds)})`,
      );
    }
    return this.db.select().from(requirement).where(and(...conds)).orderBy(desc(requirement.createdAt));
  }

  async findArtifacts(uid: string) {
    return this.db.select().from(requirementArtifact).where(eq(requirementArtifact.requirementUid, uid)).orderBy(desc(requirementArtifact.createdAt));
  }

  async insertArtifact(values: typeof requirementArtifact.$inferInsert) {
    const [a] = await this.db.insert(requirementArtifact).values(values).returning();
    return a;
  }

  async findTasksByRequirement(uid: string) {
    return this.db
      .select(getTableColumns(task))
      .from(task)
      .where(and(eq(task.requirementUid, uid), sql`${task.deletedAt} IS NULL`));
  }

  /** 把现有任务挂到需求并写工时/投入度；返回更新条数。 */
  async linkTasks(uid: string, taskUids: string[], estEffortDays?: number | null, allocationPct?: number | null) {
    if (taskUids.length === 0) return 0;
    const set: Record<string, unknown> = { requirementUid: uid, updatedAt: new Date() };
    if (estEffortDays != null) set.estEffortDays = String(estEffortDays);
    if (allocationPct != null) set.allocationPct = allocationPct;
    const rows = await this.db.update(task).set(set).where(inArray(task.taskUid, taskUids)).returning({ taskUid: task.taskUid });
    return rows.length;
  }

  /** 可挂载到需求的候选任务：归属在给定项目(业务线/app)、尚未挂任何需求、未删除。 */
  async findLinkableTasks(projectUids: string[]) {
    if (projectUids.length === 0) return [];
    return this.db
      .select({
        taskUid: task.taskUid,
        title: task.title,
        status: task.status,
        progressPercent: task.progressPercent,
        assigneeName: task.assigneeName,
        dueAt: task.dueAt,
        projectUid: task.projectUid,
      })
      .from(task)
      .where(and(
        inArray(task.projectUid, projectUids),
        sql`${task.requirementUid} IS NULL`,
        sql`${task.deletedAt} IS NULL`,
      ));
  }

  async findOrgUser(userId: string) {
    const [u] = await this.db.select().from(orgCache).where(eq(orgCache.userId, userId));
    return u || null;
  }

  /** 需求维度甘特：每个需求关联任务的最早开始 / 最晚截止（无任务则为 null）。 */
  async taskSpansByRequirement(uids: string[]) {
    if (uids.length === 0) return new Map<string, { start: Date | null; end: Date | null }>();
    const rows = await this.db
      .select({
        requirementUid: task.requirementUid,
        start: sql<Date | null>`min(${task.startAt})`,
        end: sql<Date | null>`max(${task.dueAt})`,
      })
      .from(task)
      .where(and(inArray(task.requirementUid, uids), sql`${task.deletedAt} IS NULL`))
      .groupBy(task.requirementUid);
    const m = new Map<string, { start: Date | null; end: Date | null }>();
    for (const r of rows) if (r.requirementUid) m.set(r.requirementUid, { start: r.start, end: r.end });
    return m;
  }

  /** 人力容量甘特：所有带投入度的项目驱动任务（未删除、非终态）。 */
  async capacityTasks() {
    return this.db
      .select({
        taskUid: task.taskUid,
        title: task.title,
        assigneeUserId: task.assigneeUserId,
        assigneeName: task.assigneeName,
        startAt: task.startAt,
        dueAt: task.dueAt,
        allocationPct: task.allocationPct,
        estEffortDays: task.estEffortDays,
        requirementUid: task.requirementUid,
        status: task.status,
        projectUid: task.projectUid,
      })
      .from(task)
      .where(and(
        sql`${task.allocationPct} IS NOT NULL`,
        sql`${task.deletedAt} IS NULL`,
        sql`${task.status} NOT IN ('done','shelved','closed')`,
      ));
  }

  /** 项目元信息（PIC / 负责人 显示），用于影响评估通知名单。 */
  async findProjects(uids: string[]) {
    if (uids.length === 0) return [];
    return this.db
      .select({ projectUid: project.projectUid, name: project.name, picUserId: project.picUserId, ownerName: project.ownerName })
      .from(project)
      .where(inArray(project.projectUid, uids));
  }
}
