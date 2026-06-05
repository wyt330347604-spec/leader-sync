import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, taskLeader, taskProgressLog, orgCache, project, taskUserOrder } from '@leader-sync/db';
import { eq, and, or, sql, asc, desc, gte, inArray, getTableColumns } from 'drizzle-orm';

const ACTIVE_STATUSES = ['pending', 'not_started', 'in_progress'];
const STALLED_STATUSES = ['stalled', 'shelved'];

/**
 * 构建任务列表查询的 WHERE 条件（纯函数，便于单测）。
 * - status='deleted' → 只看已删除（deleted_at IS NOT NULL），不再叠加状态等值；
 * - 其余 → 只看未删除（deleted_at IS NULL）+ 对应状态映射。
 */
export function buildListConditions(
  userIds: string[],
  filters: { status?: string; bucket?: string; from?: string; priority?: string; role?: string },
) {
  const conditions = [];

  // 软删除可见性：仅「已删除」筛选看 deleted_at IS NOT NULL，其余只看未删除。
  if (filters.status === 'deleted') {
    conditions.push(sql`${task.deletedAt} IS NOT NULL`);
  } else {
    conditions.push(sql`${task.deletedAt} IS NULL`);
  }

  // 私有可见性：私有任务仅创建者可见（created_by ∈ 当前用户身份）。
  conditions.push(
    or(sql`${task.visibility} <> 'private'`, inArray(task.createdBy, userIds))!,
  );

  const collaboratorChecks = userIds.map(
    (id) => sql`${task.collaborators}::jsonb @> ${JSON.stringify([{ user_id: id }])}::jsonb`,
  );

  if (filters.role === 'collaborator') {
    conditions.push(or(...collaboratorChecks)!);
  } else if (filters.role === 'assignee') {
    conditions.push(or(inArray(task.assigneeUserId, userIds), inArray(task.issuerUserId, userIds))!);
  } else {
    conditions.push(
      or(
        inArray(task.assigneeUserId, userIds),
        inArray(task.issuerUserId, userIds),
        ...collaboratorChecks,
      )!,
    );
  }

  if (filters.status === 'active') {
    conditions.push(inArray(task.status, ACTIVE_STATUSES));
  } else if (filters.status === 'stalled') {
    conditions.push(inArray(task.status, STALLED_STATUSES));
  } else if (filters.status === 'deleted') {
    // 已删除视图不再按 status 等值过滤（deleted 非真实状态值）。
  } else if (filters.status) {
    conditions.push(eq(task.status, filters.status));
  }
  if (filters.bucket) conditions.push(eq(task.monthBucket, filters.bucket));
  // from：月份桶 >= from（"本月及未来"视图——按截止月归桶，故 >= 当前月即含未来）
  if (filters.from) conditions.push(gte(task.monthBucket, filters.from));
  if (filters.priority) conditions.push(eq(task.priority, filters.priority));

  return conditions;
}

@Injectable()
export class TaskRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async insert(values: typeof task.$inferInsert) {
    const [result] = await this.db.insert(task).values(values).returning();
    return result;
  }

  async findByUid(taskUid: string, opts: { includeDeleted?: boolean } = {}) {
    // includeDeleted=true 用于恢复/已删除明细等需要读取软删除记录的场景（#8）。
    const conds = [eq(task.taskUid, taskUid)];
    if (!opts.includeDeleted) conds.push(sql`${task.deletedAt} IS NULL`);
    const [result] = await this.db.select().from(task).where(and(...conds));
    return result || null;
  }

  /** 批量读取未删除任务（用于批量归类的权限校验）。 */
  async findByUids(taskUids: string[]) {
    if (taskUids.length === 0) return [];
    return this.db
      .select()
      .from(task)
      .where(and(inArray(task.taskUid, taskUids), sql`${task.deletedAt} IS NULL`));
  }

  /** 批量设置项目归属（一次 UPDATE ... IN）。projectUid=null 即移回未归属。 */
  async bulkSetProject(taskUids: string[], projectUid: string | null) {
    if (taskUids.length === 0) return 0;
    const result = await this.db
      .update(task)
      .set({ projectUid, updatedAt: new Date() })
      .where(inArray(task.taskUid, taskUids))
      .returning({ taskUid: task.taskUid });
    return result.length;
  }

  async updateWithVersion(
    taskUid: string,
    version: number,
    values: Partial<typeof task.$inferInsert>,
  ) {
    const result = await this.db
      .update(task)
      .set({ ...values, updatedAt: new Date(), version: version + 1 })
      .where(and(eq(task.taskUid, taskUid), eq(task.version, version)))
      .returning();
    return result[0] || null;
  }

  async softDelete(taskUid: string) {
    const result = await this.db
      .update(task)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(task.taskUid, taskUid), sql`${task.deletedAt} IS NULL`))
      .returning();
    return result[0] || null;
  }

  /** 无版本约束的字段更新（用于 visibility 转公开等简单状态变更）。 */
  async updateField(taskUid: string, values: Partial<typeof task.$inferInsert>) {
    const result = await this.db
      .update(task)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(task.taskUid, taskUid))
      .returning();
    return result[0] || null;
  }

  /** 恢复软删除任务：清空 deleted_at。仅对已删除（deleted_at IS NOT NULL）的任务生效。 */
  async restore(taskUid: string) {
    const result = await this.db
      .update(task)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(task.taskUid, taskUid), sql`${task.deletedAt} IS NOT NULL`))
      .returning();
    return result[0] || null;
  }

  async listByUser(
    userId: string,
    openId: string | undefined,
    filters: { status?: string; bucket?: string; from?: string; priority?: string; role?: string },
    page: number,
    pageSize: number,
  ) {
    const userIds = [userId];
    if (openId && openId !== userId) userIds.push(openId);

    const where = and(...buildListConditions(userIds, filters));

    const [items, countResult] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(task),
          // 项目元数据：供前端展示「方形项目色块」（颜色取自 category）。
          projectName: project.name,
          projectCategory: project.category,
          // 当前用户的手动排序位置（无记录则 null，前端回落默认顺序）。
          userPosition: taskUserOrder.position,
        })
        .from(task)
        .leftJoin(project, eq(task.projectUid, project.projectUid))
        .leftJoin(
          taskUserOrder,
          and(eq(taskUserOrder.taskUid, task.taskUid), eq(taskUserOrder.userId, userId)),
        )
        .where(where)
        .orderBy(
          // 1. 已完成（done）放最后
          sql`CASE WHEN ${task.status} = 'done' THEN 1 ELSE 0 END`,
          // 2. 优先级（标准 Eisenhower 四档：重要紧急 → 重要不紧急 → 紧急不重要 → 不紧急不重要）
          sql`CASE ${task.priority}
                WHEN 'urgent_important' THEN 1
                WHEN 'important_not_urgent' THEN 2
                WHEN 'urgent_not_important' THEN 3
                WHEN 'not_urgent_not_important' THEN 4
                ELSE 5 END`,
          // 3. 用户手动排序优先（同档内）：有 position 的按 position 升序，无的排其后
          sql`${taskUserOrder.position} ASC NULLS LAST`,
          // 4. 项目分组：默认项目（is_default=true）排前；其他按名字升序；NULL 项目排最后
          sql`COALESCE(${project.isDefault}, false) DESC`,
          sql`${project.name} ASC NULLS LAST`,
          // 5. 同档内按截止时间正序
          asc(task.dueAt),
          // 6. 已完成段内按完成时间倒序
          desc(task.completedAt),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(task)
        .where(where),
    ]);

    return { items, total: countResult[0]?.count || 0 };
  }

  async insertProgressLog(values: typeof taskProgressLog.$inferInsert) {
    await this.db.insert(taskProgressLog).values(values);
  }

  /**
   * 按用户保存一组任务的手动排序。position 取数组下标（0,1,2…），
   * 同一 (user_id, task_uid) 冲突则更新 position。仅影响该用户视图。
   */
  async setUserOrder(userId: string, taskUids: string[]) {
    if (taskUids.length === 0) return;
    const now = new Date();
    const rows = taskUids.map((taskUid, index) => ({
      userId,
      taskUid,
      position: index,
      updatedAt: now,
    }));
    await this.db
      .insert(taskUserOrder)
      .values(rows)
      .onConflictDoUpdate({
        target: [taskUserOrder.userId, taskUserOrder.taskUid],
        set: {
          position: sql`excluded.position`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async findOrgUser(userId: string) {
    const [result] = await this.db
      .select()
      .from(orgCache)
      .where(eq(orgCache.userId, userId));
    return result || null;
  }

  async addTaskLeader(values: typeof taskLeader.$inferInsert) {
    const [result] = await this.db.insert(taskLeader).values(values).returning();
    return result;
  }

  async removeTaskLeader(taskUid: string, leaderUserId: string) {
    await this.db
      .delete(taskLeader)
      .where(and(eq(taskLeader.taskUid, taskUid), eq(taskLeader.leaderUserId, leaderUserId)));
  }

  async getTaskLeaders(taskUid: string) {
    return this.db.select().from(taskLeader).where(eq(taskLeader.taskUid, taskUid));
  }

  async getTaskLeadersByTaskUids(taskUids: readonly string[]) {
    if (taskUids.length === 0) return [];
    return this.db
      .select()
      .from(taskLeader)
      .where(inArray(taskLeader.taskUid, [...taskUids]));
  }

  async getDefaultProject() {
    const [def] = await this.db.select().from(project).where(eq(project.isDefault, true));
    return def ?? null;
  }
}
