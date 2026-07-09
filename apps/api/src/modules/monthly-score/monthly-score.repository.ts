import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import {
  monthlyScore,
  monthlyScoreDetail,
  monthlySnapshot,
  project,
  incident,
  incidentUser,
  userRoleBinding,
  scoreTemplate,
  scoreDimension,
  perfRole,
  orgCache,
} from '@leader-sync/db';
import { eq, and, or, sql, desc, inArray, asc } from 'drizzle-orm';

/** 打分行适用的模板 + 维度（V1.4 前端表单 / 服务端校验用）。 */
export interface TemplateWithDimensions {
  template: typeof scoreTemplate.$inferSelect;
  dimensions: (typeof scoreDimension.$inferSelect)[];
}

/** 绩效打分身份（可见性放宽用）。 */
export interface PerfRoleFlags {
  isLeader: boolean;
  isManagement: boolean;
}

export interface ScoreListFilter {
  month?: string;
  /** rater 身份候选（user_id/open_id 双命名空间，任一命中） */
  raterUserIds?: string[];
  /** ratee 身份候选（同上） */
  rateeUserIds?: string[];
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
  /** V1.4 多维明细（旧单值行为空数组）；前端展示 / 修改分数时回填。 */
  details: (typeof monthlyScoreDetail.$inferSelect)[];
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
    if (filter.raterUserIds?.length) {
      conditions.push(inArray(monthlyScore.raterUserId, filter.raterUserIds));
    }
    if (filter.rateeUserIds?.length) {
      conditions.push(inArray(monthlyScore.rateeUserId, filter.rateeUserIds));
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

    // V1.4 多维明细（旧单值行为空数组）
    const details = await this.findDetailsByScoreUid(scoreUid);

    return { score: scoreRow, snapshot, prevScore, incidents, picProjects, details };
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

  // ── V1.4 多维系数制 ─────────────────────────────────────────────────────────

  /** 打分行适用的模板 + 维度（按 sort 升序）；模板不存在返回 null。 */
  async findTemplateWithDimensions(templateUid: string): Promise<TemplateWithDimensions | null> {
    const [tpl] = await this.db
      .select()
      .from(scoreTemplate)
      .where(eq(scoreTemplate.templateUid, templateUid));
    if (!tpl) return null;
    const dimensions = await this.db
      .select()
      .from(scoreDimension)
      .where(eq(scoreDimension.templateUid, templateUid))
      .orderBy(asc(scoreDimension.sort));
    return { template: tpl, dimensions };
  }

  /** 绩效打分身份（user_id / open_id 双候选任一命中）；无行返回 null。 */
  async findPerfRole(candidates: string[]): Promise<PerfRoleFlags | null> {
    if (candidates.length === 0) return null;
    const [row] = await this.db
      .select({ isLeader: perfRole.isLeader, isManagement: perfRole.isManagement })
      .from(perfRole)
      .where(or(inArray(perfRole.userId, candidates), inArray(perfRole.openId, candidates)))
      .limit(1);
    return row ?? null;
  }

  /**
   * V1.4 打分事务：OCC 更新主行汇总字段 + 全量替换明细行。
   * 版本不匹配（并发）→ 主行 0 行更新 → 返回 null（无副作用，事务内未删改明细）。
   */
  async submitDetailedScore(
    scoreUid: string,
    version: number,
    mainValues: Partial<typeof monthlyScore.$inferInsert>,
    detailRows: (typeof monthlyScoreDetail.$inferInsert)[],
  ): Promise<typeof monthlyScore.$inferSelect | null> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(monthlyScore)
        .set({ ...mainValues, version: sql`${monthlyScore.version} + 1`, updatedAt: new Date() })
        .where(and(eq(monthlyScore.scoreUid, scoreUid), eq(monthlyScore.version, version)))
        .returning();
      if (!updated) return null; // OCC 失败：不动明细，事务提交（无变更）
      // 明细全量替换：先删旧再插新（唯一索引 score_uid+dimension_code 防重）
      await tx.delete(monthlyScoreDetail).where(eq(monthlyScoreDetail.scoreUid, scoreUid));
      if (detailRows.length > 0) {
        await tx.insert(monthlyScoreDetail).values(detailRows);
      }
      return updated;
    });
  }

  /** 某打分行的明细（按 sort/维度顺序）。 */
  async findDetailsByScoreUid(scoreUid: string): Promise<(typeof monthlyScoreDetail.$inferSelect)[]> {
    return this.db
      .select()
      .from(monthlyScoreDetail)
      .where(eq(monthlyScoreDetail.scoreUid, scoreUid))
      .orderBy(asc(monthlyScoreDetail.id));
  }

  /**
   * 红线通知收件人：boss + hr 角色绑定用户，解析出可发送的 ou_ open_id。
   * user_role_binding.user_id 可能已是 ou_，也可能是员工 ID → join org_cache 兜底。
   */
  async findRedLineRecipients(): Promise<string[]> {
    const bindings = await this.db
      .select({ userId: userRoleBinding.userId })
      .from(userRoleBinding)
      .where(inArray(userRoleBinding.role, ['boss', 'hr']));
    if (bindings.length === 0) return [];
    const ids = [...new Set(bindings.map((b) => b.userId))];

    const orgRows = await this.db
      .select({ userId: orgCache.userId, openId: orgCache.openId })
      .from(orgCache)
      .where(or(inArray(orgCache.userId, ids), inArray(orgCache.openId, ids)));

    const openIds = new Set<string>();
    for (const id of ids) if (id.startsWith('ou_')) openIds.add(id);
    for (const r of orgRows) if (r.openId?.startsWith('ou_')) openIds.add(r.openId);
    return [...openIds];
  }
}
