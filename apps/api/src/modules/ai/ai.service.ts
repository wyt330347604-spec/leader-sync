/**
 * ai.service.ts
 *
 * 核心 AI 对话服务：
 *   1. 权限校验（employee 禁止）
 *   2. 意图识别 + 实体提取
 *   3. 数据查询（按意图分发）
 *   4. DeepSeek 构建 prompt + 调用 API
 *   5. 保存对话历史到 ai_conversation
 *   6. 返回 { answer, intent, conversation_uid }
 */

import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';
import { AiRepository, type ScopeFilter } from './ai.repository';
import { IntentClassifier, type IntentType } from './intent-classifier';
import { DeepSeekClient, type ChatMessage } from './deepseek-client';
import { nanoid } from 'nanoid';

// Error codes specific to AI module
const AI_INTENT_UNKNOWN = 1007;
const AI_DEEPSEEK_ERROR = 1008;

// Roles that see all data (full company scope)
const FULL_SCOPE_ROLES = new Set<string>([
  UserRole.BOSS,
  UserRole.PMO,
  UserRole.ADMIN,
]);

// Cache TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

// Maximum conversation history turns to send to DeepSeek
const MAX_HISTORY_TURNS = 5;

const SYSTEM_PROMPT = `你是「督办助手」，一个企业内部任务管理系统的智能问答助手。

你的职责：
1. 根据用户的问题，结合系统提供的结构化数据，给出简洁、准确的自然语言回答。
2. 回答语气专业、简洁，适合企业管理场景。
3. 如果数据为空，明确说"暂无相关记录"，不要编造内容。
4. 不要透露你使用的是哪个 AI 模型，统一以"督办助手"自称。
5. 不要回答与任务管理、员工绩效、项目进度无关的问题，礼貌拒绝并告知范围。

任务状态说明：
- pending/not_started：未开始
- in_progress：进行中
- stalled：已停滞（需关注）
- done：已完成
- shelved：已搁置
- closed：已关闭

优先级说明：
- urgent_important：重要紧急（最高优先）
- important_not_urgent：重要不紧急
- urgent_not_important：紧急不重要
- not_urgent_not_important：不紧急不重要

回答格式要求：
- 简洁为主，通常 3-8 句话
- 如果数据条目多于 5 条，用列表格式展示，每条一行
- 对于进度/完成率，用百分比表示
- 对于日期，使用"X月X日"中文格式`;

export interface AiChatInput {
  question: string;
  sessionId: string;
  userId: string;
  userName: string;
  role: string;
  source: 'web' | 'feishu_bot';
  feishuOpenId?: string;
}

export interface AiChatResult {
  answer: string;
  intent: IntentType;
  conversation_uid: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private lastCacheRefresh = 0;

  constructor(
    private readonly aiRepository: AiRepository,
    private readonly deepSeek: DeepSeekClient,
    private readonly classifier: IntentClassifier,
  ) {}

  // Cache is refreshed lazily on first chat request (not at startup)
  // to avoid blocking application initialization.

  async chat(input: AiChatInput): Promise<AiChatResult> {
    const { question, sessionId, userId, userName, role, source, feishuOpenId } = input;

    // 1. Permission check — employee cannot use AI assistant
    if (role === UserRole.EMPLOYEE) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '您没有权限使用 AI 助手功能',
        HttpStatus.FORBIDDEN,
      );
    }

    // 2. Refresh cache if stale
    await this.refreshCacheIfNeeded();

    // 3. Classify intent
    const { intent, entities } = this.classifier.classify(question);

    // 4. Build scope filter
    const scopeFilter: ScopeFilter = FULL_SCOPE_ROLES.has(role)
      ? {}
      : { leaderUserId: userId };

    // 5. Handle unknown intent — return fixed fallback
    if (intent === 'unknown') {
      const answer =
        '暂时无法理解您的问题，请尝试更具体的提问，例如："张三本月在做什么"、"哪些任务快逾期了"、"项目进度如何"。';
      const conversationUid = `conv_${nanoid(16)}`;

      // Persist conversation
      await this.aiRepository.saveConversation({
        conversationUid,
        userId,
        userName,
        userRole: role,
        source,
        feishuOpenId,
        sessionId,
        turnIndex: 0,
        question,
        intent,
        intentEntities: entities as Record<string, unknown>,
        answer,
      });

      return { answer, intent, conversation_uid: conversationUid };
    }

    // 6. Query data based on intent
    const rawData = await this.queryDataForIntent(intent, entities, scopeFilter);

    // 7. Get conversation history (last 5 turns) — cap defensively even if repository returns more
    const allHistory = await this.aiRepository.getRecentConversations(sessionId, MAX_HISTORY_TURNS);
    const history = allHistory.slice(-MAX_HISTORY_TURNS);

    // 8. Build scope description for user prompt
    const scopeDescription =
      FULL_SCOPE_ROLES.has(role) ? '全公司数据' : `${userName} 管理团队的数据`;

    // 9. Build messages for DeepSeek
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      // History turns (oldest first, last 5)
      ...history.flatMap((turn) => [
        { role: 'user' as const, content: `问题：${turn.question}` },
        { role: 'assistant' as const, content: turn.answer ?? '' },
      ]),
      // Current question
      {
        role: 'user',
        content: buildUserPrompt(question, rawData, scopeDescription),
      },
    ];

    // 10. Call DeepSeek
    const startTime = Date.now();
    let answer: string;
    let tokensUsed = 0;

    try {
      const result = await this.deepSeek.chat({ messages });
      answer = result.answer;
      tokensUsed = result.tokens_used;
    } catch (err) {
      this.logger.error('DeepSeek API call failed', err);
      throw new BusinessException(
        AI_DEEPSEEK_ERROR,
        'AI 服务暂时不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const llmLatencyMs = Date.now() - startTime;
    const conversationUid = `conv_${nanoid(16)}`;

    // 11. Persist conversation record
    await this.aiRepository.saveConversation({
      conversationUid,
      userId,
      userName,
      userRole: role,
      source,
      feishuOpenId,
      sessionId,
      turnIndex: history.length,
      question,
      intent,
      intentEntities: entities as Record<string, unknown>,
      rawData,
      answer,
      llmLatencyMs,
      tokensUsed,
    });

    return { answer, intent, conversation_uid: conversationUid };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async queryDataForIntent(
    intent: IntentType,
    entities: ReturnType<IntentClassifier['classify']>['entities'],
    scopeFilter: ScopeFilter,
  ): Promise<unknown> {
    const month = entities.month ?? getCurrentMonth();

    switch (intent) {
      case 'employee_tasks':
        if (!entities.employee_user_id) return [];
        return this.aiRepository.getEmployeeTasks(
          entities.employee_user_id,
          month,
          scopeFilter,
        );

      case 'near_due_tasks':
        return this.aiRepository.getNearDueTasks(scopeFilter);

      case 'project_progress':
        if (!entities.project_uid) return { error: '未找到项目，请指定完整项目名称' };
        return this.aiRepository.getProjectProgress(entities.project_uid, scopeFilter);

      case 'completion_ranking':
        return this.aiRepository.getCompletionRanking(month, scopeFilter);

      case 'employee_incidents':
        if (!entities.employee_user_id) return [];
        return this.aiRepository.getEmployeeIncidents(
          entities.employee_user_id,
          month,
        );

      case 'task_overdue':
        return this.aiRepository.getOverdueTasks(scopeFilter);

      default:
        return [];
    }
  }

  private async refreshCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheRefresh < CACHE_TTL_MS) return;

    try {
      const [users, projects] = await Promise.all([
        this.aiRepository.getAllUsers(),
        this.aiRepository.getAllProjects(),
      ]);
      this.classifier.refreshCache(users, projects);
      this.lastCacheRefresh = now;
      this.logger.debug(
        `Cache refreshed: ${users.length} users, ${projects.length} projects`,
      );
    } catch (err) {
      this.logger.warn('Failed to refresh intent classifier cache', err);
    }
  }
}

// ── Module-level pure helpers ─────────────────────────────────────────────────

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function buildUserPrompt(
  question: string,
  rawData: unknown,
  scopeDescription: string,
): string {
  return `问题：${question}

相关数据（JSON）：
${JSON.stringify(rawData, null, 2)}

请根据以上数据回答问题。数据范围：${scopeDescription}`;
}
