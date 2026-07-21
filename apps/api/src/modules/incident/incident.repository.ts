import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { incident, incidentUser, orgCache, task } from '@leader-sync/db';
import { eq, and, sql, inArray, ilike, or } from 'drizzle-orm';

export interface IncidentListFilter {
  severity?: string;
  confirmStatus?: string;
  month?: string;    // YYYY-MM — matches created_at month
  userId?: string;   // pmo/boss filter: incidents involving this user
  viewerUserId?: string; // row-level security: only incidents involving this user
  projectUid?: string; // V2c：按关联项目过滤
}

@Injectable()
export class IncidentRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async insert(values: typeof incident.$inferInsert) {
    const [result] = await this.db.insert(incident).values(values).returning();
    return result;
  }

  async insertIncidentUsers(
    rows: Array<typeof incidentUser.$inferInsert>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(incidentUser).values(rows);
  }

  async findByUid(incidentUid: string) {
    const [result] = await this.db
      .select()
      .from(incident)
      .where(
        and(
          eq(incident.incidentUid, incidentUid),
          sql`${incident.deletedAt} IS NULL`,
        ),
      );
    return result ?? null;
  }

  async list(
    filter: IncidentListFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: typeof incident.$inferSelect[]; total: number }> {
    const conditions: ReturnType<typeof sql>[] = [
      sql`${incident.deletedAt} IS NULL`,
    ];

    // Row-level security: employee sees only incidents where they are involved
    if (filter.viewerUserId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM incident_user iu
          WHERE iu.incident_uid = ${incident.incidentUid}
            AND iu.user_id = ${filter.viewerUserId}
        )`,
      );
    }

    if (filter.severity) {
      conditions.push(sql`${incident.severity} = ${filter.severity}`);
    }

    if (filter.confirmStatus) {
      conditions.push(sql`${incident.confirmStatus} = ${filter.confirmStatus}`);
    }

    if (filter.projectUid) {
      conditions.push(sql`${incident.relatedProjectUid} = ${filter.projectUid}`);
    }

    if (filter.month) {
      conditions.push(
        sql`TO_CHAR(${incident.createdAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = ${filter.month}`,
      );
    }

    // pmo/boss querying specific user's incidents
    if (filter.userId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM incident_user iu
          WHERE iu.incident_uid = ${incident.incidentUid}
            AND iu.user_id = ${filter.userId}
        )`,
      );
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(incident)
        .where(where)
        .orderBy(sql`${incident.createdAt} DESC`)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(incident)
        .where(where),
    ]);

    return { items, total: countResult[0]?.count ?? 0 };
  }

  async update(
    incidentUid: string,
    values: Partial<typeof incident.$inferInsert>,
  ) {
    const [result] = await this.db
      .update(incident)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(incident.incidentUid, incidentUid),
          sql`${incident.deletedAt} IS NULL`,
        ),
      )
      .returning();
    return result ?? null;
  }

  async softDelete(incidentUid: string) {
    const [result] = await this.db
      .update(incident)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(incident.incidentUid, incidentUid),
          sql`${incident.deletedAt} IS NULL`,
        ),
      )
      .returning();
    return result ?? null;
  }

  async findOrgUser(id: string) {
    const [result] = await this.db
      .select()
      .from(orgCache)
      .where(or(eq(orgCache.userId, id), eq(orgCache.openId, id)));
    return result ?? null;
  }

  async findTaskByUid(taskUid: string) {
    const [result] = await this.db
      .select()
      .from(task)
      .where(and(eq(task.taskUid, taskUid), sql`${task.deletedAt} IS NULL`));
    return result ?? null;
  }

  async listByUserId(
    userId: string,
    month: string | undefined,
    severity: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ items: typeof incident.$inferSelect[]; total: number }> {
    const conditions: ReturnType<typeof sql>[] = [
      sql`${incident.deletedAt} IS NULL`,
      sql`EXISTS (
        SELECT 1 FROM incident_user iu
        WHERE iu.incident_uid = ${incident.incidentUid}
          AND iu.user_id = ${userId}
      )`,
    ];

    if (month) {
      conditions.push(
        sql`TO_CHAR(${incident.createdAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = ${month}`,
      );
    }

    if (severity) {
      conditions.push(sql`${incident.severity} = ${severity}`);
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(incident)
        .where(where)
        .orderBy(sql`${incident.createdAt} DESC`)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(incident)
        .where(where),
    ]);

    return { items, total: countResult[0]?.count ?? 0 };
  }

  async findPmoUsers(): Promise<{ userId: string }[]> {
    // Returns open_id of all users with pmo or boss role binding
    // Uses raw SQL for the join to avoid Drizzle alias complexity
    const results = (await this.db.execute(
      sql`SELECT DISTINCT oc.open_id AS user_id
          FROM user_role_binding urb
          JOIN org_cache oc ON oc.user_id = urb.user_id
          WHERE urb.role IN ('pmo', 'boss')
            AND oc.open_id IS NOT NULL`,
    )) as unknown as Array<{ user_id: string }>;
    return results.map((r) => ({ userId: r.user_id }));
  }

  async findIncidentUsers(
    incidentUid: string,
  ): Promise<typeof incidentUser.$inferSelect[]> {
    return this.db
      .select()
      .from(incidentUser)
      .where(eq(incidentUser.incidentUid, incidentUid));
  }

  async deleteIncidentUsers(incidentUid: string): Promise<void> {
    await this.db
      .delete(incidentUser)
      .where(eq(incidentUser.incidentUid, incidentUid));
  }

  async monthlySummary(
    userId: string,
    month: string,
  ): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    incidents: typeof incident.$inferSelect[];
  }> {
    const where = and(
      sql`${incident.deletedAt} IS NULL`,
      sql`${incident.confirmStatus} = 'confirmed'`,
      sql`TO_CHAR(${incident.createdAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = ${month}`,
      sql`EXISTS (
        SELECT 1 FROM incident_user iu
        WHERE iu.incident_uid = ${incident.incidentUid}
          AND iu.user_id = ${userId}
      )`,
    );

    const items = await this.db
      .select()
      .from(incident)
      .where(where)
      .orderBy(sql`${incident.createdAt} DESC`);

    const bySeverity: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const row of items) {
      if (row.severity in bySeverity) {
        bySeverity[row.severity]++;
      }
    }

    return { total: items.length, bySeverity, incidents: items };
  }
}
