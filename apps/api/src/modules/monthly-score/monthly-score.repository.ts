import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { monthlyScore, monthlySnapshot, project, incident, incidentUser, userRoleBinding } from '@leader-sync/db';
import { eq, and, sql, lt, desc } from 'drizzle-orm';

export interface ScoreListFilter {
  month?: string;
  raterUserId?: string;
  rateeUserId?: string;
}

export interface SnapshotContext {
  doneRate: string;
  monthDoneCount: number;
  monthDueCount: number;
  monthOverdueCount: number;
  monthCarryOverCount: number;
}

export interface PrevScoreRef {
  score: number | null;
  status: string;
  scoreMonth: string;
}

export interface PicProject {
  projectUid: string;
  name: string;
  category: string | null;
  region: string | null;
}

export interface IncidentRef {
  incidentUid: string;
  title: string;
  severity: string;
  confirmedAt: Date | null;
}

export interface ScoreContext {
  score: typeof monthlyScore.$inferSelect;
  snapshot: SnapshotContext | null;
  prevScore: PrevScoreRef | null;
  incidents: IncidentRef[];
  picProjects: PicProject[];
}

@Injectable()
export class MonthlyScoreRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async findByUid(scoreUid: string) {
    const [result] = await this.db
      .select()
      .from(monthlyScore)
      .where(eq(monthlyScore.scoreUid, scoreUid));
    return result ?? null;
  }

  /**
   * OCC update: returns null when no row was updated (version mismatch).
   */
  async updateWithVersion(
    scoreUid: string,
    version: number,
    values: Partial<typeof monthlyScore.$inferInsert>,
  ) {
    const [result] = await this.db
      .update(monthlyScore)
      .set({ ...values, version: sql`${monthlyScore.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(monthlyScore.scoreUid, scoreUid),
          eq(monthlyScore.version, version),
        ),
      )
      .returning();
    return result ?? null;
  }

  /**
   * Direct field update — no OCC (used for challenge / lock operations).
   */
  async updateField(
    scoreUid: string,
    values: Partial<typeof monthlyScore.$inferInsert>,
  ) {
    const [result] = await this.db
      .update(monthlyScore)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(monthlyScore.scoreUid, scoreUid))
      .returning();
    return result ?? null;
  }

  async listByMonth(
    filter: ScoreListFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: typeof monthlyScore.$inferSelect[]; total: number }> {
    const conditions: ReturnType<typeof sql>[] = [];

    if (filter.month) {
      conditions.push(sql`${monthlyScore.scoreMonth} = ${filter.month}`);
    }
    if (filter.raterUserId) {
      conditions.push(sql`${monthlyScore.raterUserId} = ${filter.raterUserId}`);
    }
    if (filter.rateeUserId) {
      conditions.push(sql`${monthlyScore.rateeUserId} = ${filter.rateeUserId}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(monthlyScore)
        .where(where)
        .orderBy(desc(monthlyScore.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(monthlyScore)
        .where(where),
    ]);

    return { items, total: countResult[0]?.count ?? 0 };
  }

  /**
   * Aggregates all context data for the score detail view:
   * - monthly_snapshot (employee scope) for the same ratee + month
   * - previous month's score
   * - incidents involving ratee
   * - PIC projects (where project.owner_user_id = ratee_user_id)
   *
   * NOTE: project.owner_user_id migration is spec'd but may not exist yet.
   * We fall back to an empty array if the column is absent.
   */
  async getContext(scoreUid: string): Promise<ScoreContext | null> {
    const scoreRow = await this.findByUid(scoreUid);
    if (!scoreRow) return null;

    // Snapshot for ratee + month
    const [snap] = await this.db
      .select()
      .from(monthlySnapshot)
      .where(
        and(
          eq(monthlySnapshot.snapshotMonth, scoreRow.scoreMonth),
          eq(monthlySnapshot.roleScope, 'employee'),
          sql`${monthlySnapshot.ownerUserId} = ${scoreRow.rateeUserId}`,
        ),
      )
      .limit(1);

    const snapshot: SnapshotContext | null = snap
      ? {
          doneRate:
            snap.monthDueCount > 0
              ? `${Math.round((snap.monthDoneCount / snap.monthDueCount) * 100)}%`
              : '0%',
          monthDoneCount: snap.monthDoneCount,
          monthDueCount: snap.monthDueCount,
          monthOverdueCount: snap.monthOverdueCount,
          monthCarryOverCount: snap.monthCarryOverCount,
        }
      : null;

    // Previous month score
    const prevMonthDate = new Date(
      `${scoreRow.scoreMonth}-01T00:00:00Z`,
    );
    prevMonthDate.setUTCMonth(prevMonthDate.getUTCMonth() - 1);
    const prevMonth = `${prevMonthDate.getUTCFullYear()}-${String(prevMonthDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const [prevRow] = await this.db
      .select()
      .from(monthlyScore)
      .where(
        and(
          eq(monthlyScore.rateeUserId, scoreRow.rateeUserId),
          eq(monthlyScore.scoreMonth, prevMonth),
        ),
      )
      .limit(1);

    const prevScore: PrevScoreRef | null = prevRow
      ? {
          score: prevRow.score !== null ? parseFloat(prevRow.score) : null,
          status: prevRow.status,
          scoreMonth: prevRow.scoreMonth,
        }
      : null;

    // Incidents involving ratee for the same month
    const incidentRows = await this.db
      .select({
        incidentUid: incident.incidentUid,
        title: incident.title,
        severity: incident.severity,
        confirmedAt: incident.confirmedAt,
      })
      .from(incident)
      .innerJoin(incidentUser, eq(incidentUser.incidentUid, incident.incidentUid))
      .where(
        and(
          eq(incidentUser.userId, scoreRow.rateeUserId),
          sql`TO_CHAR(${incident.createdAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = ${scoreRow.scoreMonth}`,
          sql`${incident.deletedAt} IS NULL`,
        ),
      );

    const incidents: IncidentRef[] = incidentRows.map((r) => ({
      incidentUid: r.incidentUid,
      title: r.title,
      severity: r.severity,
      confirmedAt: r.confirmedAt ?? null,
    }));

    // PIC projects — uses owner_user_id if column exists (migration may be pending)
    let picProjects: PicProject[] = [];
    try {
      const projectRows = await this.db
        .select({
          projectUid: project.projectUid,
          name: project.name,
          category: project.category,
          region: project.region,
        })
        .from(project)
        .where(
          sql`${project}.owner_user_id = ${scoreRow.rateeUserId}`,
        );

      picProjects = projectRows.map((p) => ({
        projectUid: p.projectUid,
        name: p.name,
        category: p.category ?? '',
        region: p.region ?? null,
      }));
    } catch {
      // owner_user_id column may not exist yet — gracefully return empty array
      picProjects = [];
    }

    return { score: scoreRow, snapshot, prevScore, incidents, picProjects };
  }

  async findPrevScore(
    rateeUserId: string,
    prevMonth: string,
  ): Promise<typeof monthlyScore.$inferSelect | null> {
    const [result] = await this.db
      .select()
      .from(monthlyScore)
      .where(
        and(
          eq(monthlyScore.rateeUserId, rateeUserId),
          eq(monthlyScore.scoreMonth, prevMonth),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findRolesByUserId(userId: string): Promise<{ role: string }[]> {
    return this.db
      .select({ role: userRoleBinding.role })
      .from(userRoleBinding)
      .where(eq(userRoleBinding.userId, userId));
  }
}
