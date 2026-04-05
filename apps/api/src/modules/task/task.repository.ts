import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { task, taskLeader, taskProgressLog, orgCache, project } from '@leader-sync/db';
import { eq, and, or, sql, desc, inArray } from 'drizzle-orm';

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

    if (filters.status) conditions.push(eq(task.status, filters.status));
    if (filters.bucket) conditions.push(eq(task.monthBucket, filters.bucket));
    if (filters.priority) conditions.push(eq(task.priority, filters.priority));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(task)
        .where(where)
        .orderBy(desc(task.createdAt))
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
