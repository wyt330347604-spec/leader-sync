/**
 * ai.repository.ts
 *
 * 只读查询各业务表，供 AiService 的数据查询引擎使用。
 * 禁止任何写操作到 task/project/org_cache 等核心业务表。
 * 只有 ai_conversation 表写入在此处。
 */

import { Injectable } from '@nestjs/common';
import { createDb, type Database } from '@leader-sync/db';
import {
  task,
  orgCache,
  project,
  incident,
  incidentUser,
} from '@leader-sync/db';
import { and, eq, isNull, notInArray, sql, lte, gte, asc } from 'drizzle-orm';

export interface ScopeFilter {
  leaderUserId?: string;
}

export interface SaveConversationInput {
  conversationUid: string;
  userId: string;
  userName: string;
  userRole: string;
  source: string;
  feishuOpenId?: string;
  sessionId?: string;
  turnIndex: number;
  question: string;
  intent?: string;
  intentEntities?: Record<string, unknown>;
  rawData?: unknown;
  answer?: string;
  errorMessage?: string;
  llmLatencyMs?: number;
  tokensUsed?: number;
}

export interface ConversationTurn {
  question: string;
  answer: string | null;
  turnIndex: number;
}

const DONE_STATUSES = ['done', 'shelved', 'closed'];

@Injectable()
export class AiRepository {
  private readonly db: Database;
  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL required');
    this.db = createDb(url);
  }

  // ── Cache helpers ────────────────────────────────────────────────────────

  async getAllUsers(): Promise<Array<{ userId: string; userName: string }>> {
    const rows = await this.db
      .select({ userId: orgCache.userId, userName: orgCache.userName })
      .from(orgCache);
    return rows.map((r) => ({
      userId: r.userId,
      userName: r.userName ?? '',
    }));
  }

  async getAllProjects(): Promise<Array<{ projectUid: string; name: string }>> {
    const rows = await this.db
      .select({ projectUid: project.projectUid, name: project.name })
      .from(project);
    return rows;
  }

  // ── employee_tasks ───────────────────────────────────────────────────────

  async getEmployeeTasks(
    employeeUserId: string,
    month: string,
    scopeFilter: ScopeFilter,
  ) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`${task.assigneeUserId} = ${employeeUserId}`,
      sql`${task.monthBucket} = ${month}`,
      isNull(task.deletedAt),
    ];

    if (scopeFilter.leaderUserId) {
      conditions.push(sql`${task.leaderUserId} = ${scopeFilter.leaderUserId}`);
    }

    const rows = await this.db
      .select({
        taskUid: task.taskUid,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
        progressPercent: task.progressPercent,
        latestProgress: task.latestProgress,
        isOverdue: task.isOverdue,
      })
      .from(task)
      .where(and(...conditions))
      .limit(50);

    return rows;
  }

  // ── near_due_tasks ───────────────────────────────────────────────────────

  async getNearDueTasks(scopeFilter: ScopeFilter) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`${task.daysToDue} >= 0 AND ${task.daysToDue} <= 3`,
      notInArray(task.status, DONE_STATUSES),
      isNull(task.deletedAt),
    ];

    if (scopeFilter.leaderUserId) {
      conditions.push(sql`${task.leaderUserId} = ${scopeFilter.leaderUserId}`);
    }

    return this.db
      .select({
        taskUid: task.taskUid,
        title: task.title,
        status: task.status,
        assigneeName: task.assigneeName,
        dueAt: task.dueAt,
        daysToDue: task.daysToDue,
        priority: task.priority,
      })
      .from(task)
      .where(and(...conditions))
      .orderBy(asc(task.daysToDue))
      .limit(50);
  }

  // ── project_progress ─────────────────────────────────────────────────────

  async getProjectProgress(projectUid: string, scopeFilter: ScopeFilter) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`${task.projectUid} = ${projectUid}`,
      isNull(task.deletedAt),
    ];

    if (scopeFilter.leaderUserId) {
      conditions.push(sql`${task.leaderUserId} = ${scopeFilter.leaderUserId}`);
    }

    const rows = await this.db
      .select({
        status: task.status,
      })
      .from(task)
      .where(and(...conditions));

    const total = rows.length;
    const done = rows.filter((r) => r.status === 'done').length;

    // Get project name
    const [proj] = await this.db
      .select({ name: project.name })
      .from(project)
      .where(eq(project.projectUid, projectUid));

    return {
      projectName: proj?.name ?? projectUid,
      total,
      done,
      completionRate: total > 0 ? done / total : 0,
    };
  }

  // ── completion_ranking ───────────────────────────────────────────────────

  async getCompletionRanking(month: string, scopeFilter: ScopeFilter) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`${task.monthBucket} = ${month}`,
      isNull(task.deletedAt),
    ];

    if (scopeFilter.leaderUserId) {
      conditions.push(sql`${task.leaderUserId} = ${scopeFilter.leaderUserId}`);
    }

    const rows = await this.db
      .select({
        assigneeUserId: task.assigneeUserId,
        assigneeName: task.assigneeName,
        status: task.status,
      })
      .from(task)
      .where(and(...conditions));

    // Aggregate by assignee
    const byUser = new Map<
      string,
      { assigneeName: string; total: number; done: number }
    >();

    for (const row of rows) {
      const key = row.assigneeUserId;
      const existing = byUser.get(key) ?? {
        assigneeName: row.assigneeName,
        total: 0,
        done: 0,
      };
      byUser.set(key, {
        ...existing,
        total: existing.total + 1,
        done: existing.done + (row.status === 'done' ? 1 : 0),
      });
    }

    return Array.from(byUser.values())
      .map((entry) => ({
        ...entry,
        completionRate: entry.total > 0 ? entry.done / entry.total : 0,
      }))
      .sort((a, b) => a.completionRate - b.completionRate);
  }

  // ── employee_incidents ───────────────────────────────────────────────────

  async getEmployeeIncidents(employeeUserId: string, month: string) {
    // Parse month range
    const [year, monthNum] = month.split('-').map(Number);
    const monthStart = new Date(year, monthNum - 1, 1);
    const monthEnd = new Date(year, monthNum, 1);

    // Find incidents where employee is involved
    const involvedIncidentUids = await this.db
      .select({ incidentUid: incidentUser.incidentUid })
      .from(incidentUser)
      .where(eq(incidentUser.userId, employeeUserId));

    if (involvedIncidentUids.length === 0) {
      return [];
    }

    const uids = involvedIncidentUids.map((r) => r.incidentUid);

    return this.db
      .select({
        incidentUid: incident.incidentUid,
        title: incident.title,
        severity: incident.severity,
        confirmStatus: incident.confirmStatus,
        incidentDate: incident.incidentDate,
        createdAt: incident.createdAt,
      })
      .from(incident)
      .where(
        and(
          sql`${incident.incidentUid} = ANY(ARRAY[${sql.join(uids.map((u) => sql`${u}`), sql`, `)}])`,
          gte(incident.createdAt, monthStart),
          lte(incident.createdAt, monthEnd),
          isNull(incident.deletedAt),
        ),
      )
      .orderBy(asc(incident.createdAt))
      .limit(50);
  }

  // ── task_overdue ─────────────────────────────────────────────────────────

  async getOverdueTasks(scopeFilter: ScopeFilter) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`${task.isOverdue} = true`,
      notInArray(task.status, DONE_STATUSES),
      isNull(task.deletedAt),
    ];

    if (scopeFilter.leaderUserId) {
      conditions.push(sql`${task.leaderUserId} = ${scopeFilter.leaderUserId}`);
    }

    return this.db
      .select({
        taskUid: task.taskUid,
        title: task.title,
        status: task.status,
        assigneeName: task.assigneeName,
        dueAt: task.dueAt,
        daysToDue: task.daysToDue,
      })
      .from(task)
      .where(and(...conditions))
      .limit(50);
  }

  // ── ai_conversation ───────────────────────────────────────────────────────

  async getRecentConversations(sessionId: string, limit = 5): Promise<ConversationTurn[]> {
    // Use raw SQL to query ai_conversation table (schema not yet exported from @leader-sync/db index)
    const rows = (await this.db.execute(sql`
      SELECT question, answer, turn_index
      FROM ai_conversation
      WHERE session_id = ${sessionId}
        AND answer IS NOT NULL
      ORDER BY turn_index DESC
      LIMIT ${limit}
    `)) as unknown as Array<{ question: string; answer: string | null; turn_index: number }>;

    // Reverse so oldest comes first for chat history
    return [...rows]
      .reverse()
      .map((r) => ({
        question: r.question,
        answer: r.answer,
        turnIndex: r.turn_index,
      }));
  }

  async saveConversation(input: SaveConversationInput): Promise<{ conversationUid: string }> {
    await this.db.execute(sql`
      INSERT INTO ai_conversation (
        conversation_uid, user_id, user_name, user_role,
        source, feishu_open_id, session_id, turn_index,
        question, intent, intent_entities, raw_data,
        answer, error_message, llm_latency_ms, tokens_used,
        created_at
      ) VALUES (
        ${input.conversationUid},
        ${input.userId},
        ${input.userName},
        ${input.userRole},
        ${input.source},
        ${input.feishuOpenId ?? null},
        ${input.sessionId ?? null},
        ${input.turnIndex},
        ${input.question},
        ${input.intent ?? null},
        ${input.intentEntities ? JSON.stringify(input.intentEntities) : null}::jsonb,
        ${input.rawData ? JSON.stringify(input.rawData) : null}::jsonb,
        ${input.answer ?? null},
        ${input.errorMessage ?? null},
        ${input.llmLatencyMs ?? null},
        ${input.tokensUsed ?? null},
        NOW()
      )
    `);

    return { conversationUid: input.conversationUid };
  }
}
