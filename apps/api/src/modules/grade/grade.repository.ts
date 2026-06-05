import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_TOKEN } from '../../database.module';
import type { Database } from '@leader-sync/db';
import { gradeHistory, orgCache } from '@leader-sync/db';
import { eq, desc, sql } from 'drizzle-orm';

@Injectable()
export class GradeRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /** Look up a single org_cache row by user_id */
  async findOrgUser(userId: string) {
    const [result] = await this.db
      .select()
      .from(orgCache)
      .where(eq(orgCache.userId, userId));
    return result ?? null;
  }

  /** Find all org_cache users whose manager_user_id === managerId */
  async findOrgUserByManagerId(managerId: string) {
    return this.db
      .select()
      .from(orgCache)
      .where(eq(orgCache.managerUserId, managerId));
  }

  /** Insert a new grade_history record */
  async insertGradeHistory(values: typeof gradeHistory.$inferInsert) {
    const [result] = await this.db
      .insert(gradeHistory)
      .values(values)
      .returning();
    return result;
  }

  /** Update org_cache.current_grade for the given userId */
  async updateOrgCacheGrade(userId: string, grade: string): Promise<void> {
    await this.db
      .update(orgCache)
      .set({ currentGrade: grade, updatedAt: new Date() } as Partial<typeof orgCache.$inferInsert>)
      .where(eq(orgCache.userId, userId));
  }

  /** Return the most recent grade_history record for a user (not soft-deleted) */
  async findLatestGradeByUserId(userId: string) {
    const [result] = await this.db
      .select()
      .from(gradeHistory)
      .where(
        sql`${gradeHistory.userId} = ${userId} AND ${gradeHistory.deletedAt} IS NULL`,
      )
      .orderBy(desc(gradeHistory.changedAt))
      .limit(1);
    return result ?? null;
  }

  /** List all grade_history records for a user, ordered newest-first */
  async listGradeHistoryByUserId(userId: string) {
    return this.db
      .select()
      .from(gradeHistory)
      .where(
        sql`${gradeHistory.userId} = ${userId} AND ${gradeHistory.deletedAt} IS NULL`,
      )
      .orderBy(desc(gradeHistory.changedAt));
  }

  /**
   * List all org_cache users with their current_grade (for grade overview).
   * Returns all users, including those with NULL current_grade.
   */
  async listAllCurrentGrades() {
    return this.db
      .select({
        userId: orgCache.userId,
        userName: orgCache.userName,
        deptName: orgCache.deptName,
        currentGrade: orgCache.currentGrade,
        managerUserId: orgCache.managerUserId,
        managerName: orgCache.managerName,
      })
      .from(orgCache)
      .orderBy(orgCache.userName);
  }
}
