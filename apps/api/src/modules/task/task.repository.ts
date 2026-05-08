import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, taskLeader, taskProgressLog, orgCache, project } from '@leader-sync/db';
import { eq, and, or, sql, asc, desc, inArray, getTableColumns } from 'drizzle-orm';

@Injectable()
export class TaskRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async insert(values: typeof task.$inferInsert) {
    const [result] = await this.db.insert(task).values(values).returning();
    return result;
  }

  async findByUid(taskUid: string) {
    const [result] = await this.db
      .select()
      .from(task)
      .where(and(eq(task.taskUid, taskUid), sql`${task.deletedAt} IS NULL`));
    return result || null;
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

  async listByUser(
    userId: string,
    openId: string | undefined,
    filters: { status?: string; bucket?: string; priority?: string; role?: string },
    page: number,
    pageSize: number,
  ) {
    const userIds = [userId];
    if (openId && openId !== userId) userIds.push(openId);

    const conditions = [sql`${task.deletedAt} IS NULL`];

    // Build collaborator JSONB containment checks:
    // collaborators stores [{user_id: "ou_xxx", user_name: "name"}]
    const collaboratorChecks = userIds.map(
      (id) => sql`${task.collaborators}::jsonb @> ${JSON.stringify([{ user_id: id }])}::jsonb`,
    );

    // Role-based filter
    if (filters.role === 'collaborator') {
      // Only collaborator tasks
      conditions.push(or(...collaboratorChecks)!);
    } else if (filters.role === 'assignee') {
      // Only assigned/issued tasks
      conditions.push(
        or(
          inArray(task.assigneeUserId, userIds),
          inArray(task.issuerUserId, userIds),
        )!,
      );
    } else {
      // All (default) — assigned + issued + collaborator
      conditions.push(
        or(
          inArray(task.assigneeUserId, userIds),
          inArray(task.issuerUserId, userIds),
          ...collaboratorChecks,
        )!,
      );
    }

    if (filters.status === 'active') {
      // 进行中 = pending + not_started + in_progress
      conditions.push(inArray(task.status, ['pending', 'not_started', 'in_progress']));
    } else if (filters.status === 'stalled') {
      // 已停滞 = stalled + shelved
      conditions.push(inArray(task.status, ['stalled', 'shelved']));
    } else if (filters.status) {
      conditions.push(eq(task.status, filters.status));
    }
    if (filters.bucket) conditions.push(eq(task.monthBucket, filters.bucket));
    if (filters.priority) conditions.push(eq(task.priority, filters.priority));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      this.db
        .select(getTableColumns(task))
        .from(task)
        .leftJoin(project, eq(task.projectUid, project.projectUid))
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
          // 3. 项目分组：默认项目（is_default=true）排前；其他按名字升序；NULL 项目排最后
          sql`COALESCE(${project.isDefault}, false) DESC`,
          sql`${project.name} ASC NULLS LAST`,
          // 4. 同档内按截止时间正序
          asc(task.dueAt),
          // 5. 已完成段内按完成时间倒序
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
