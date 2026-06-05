/**
 * ai.service.spec.ts
 *
 * TDD spec for AiService — RED phase.
 * All external dependencies are mocked (repository, deepseek client, config).
 * No DB or network required.
 *
 * Coverage:
 *  1. Intent classification: employee_tasks — 提取员工姓名
 *  2. Intent classification: near_due_tasks — 关键词"快逾期"
 *  3. Intent classification: project_progress — 关键词"项目进度"
 *  4. Intent classification: completion_ranking — 关键词"完成率最低"
 *  5. Intent classification: employee_incidents — 关键词"出事故"（优先于 employee_tasks）
 *  6. Intent classification: task_overdue — 关键词"延期任务"
 *  7. Intent classification: unknown — 无法识别的问题
 *  8. Permission: employee role → throws 1002 UNAUTHORIZED
 *  9. Permission: leader role → scopeFilter contains leaderUserId
 * 10. Permission: boss role → scopeFilter is empty (全公司)
 * 11. DeepSeek mock: chat returns answer string from API response
 * 12. DeepSeek mock: API failure → throws BusinessException 1008
 * 13. Multi-turn: 携带最近 5 轮历史传给 DeepSeek
 * 14. Conversation: 保存到 ai_conversation 表
 * 15. employee_incidents intent: incident 表查询逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiRepository } from './ai.repository';
import { IntentClassifier } from './intent-classifier';
import { DeepSeekClient, type ChatMessage } from './deepseek-client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode, UserRole } from '@leader-sync/shared-types';

// ─── Mock factories ───────────────────────────────────────────────────────────

function createMockRepo(): Record<keyof AiRepository, ReturnType<typeof vi.fn>> {
  return {
    getAllUsers: vi.fn(),
    getAllProjects: vi.fn(),
    getEmployeeTasks: vi.fn(),
    getNearDueTasks: vi.fn(),
    getProjectProgress: vi.fn(),
    getCompletionRanking: vi.fn(),
    getEmployeeIncidents: vi.fn(),
    getOverdueTasks: vi.fn(),
    getRecentConversations: vi.fn(),
    saveConversation: vi.fn(),
  };
}

function createMockDeepSeek(): Record<keyof DeepSeekClient, ReturnType<typeof vi.fn>> {
  return {
    chat: vi.fn(),
  };
}

function createMockClassifier(): Record<keyof IntentClassifier, ReturnType<typeof vi.fn>> {
  return {
    classify: vi.fn(),
    refreshCache: vi.fn(),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FAKE_USERS = [
  { userId: 'ou_dev_alice', userName: '张三' },
  { userId: 'ou_dev_bob', userName: '李四' },
];

const FAKE_PROJECTS = [
  { projectUid: 'proj_001', name: '印尼电商' },
];

const FAKE_TASKS = [
  {
    taskUid: 'task_001',
    title: '完成接口开发',
    status: 'in_progress',
    priority: 'urgent_important',
    assigneeName: '张三',
    dueAt: new Date('2026-06-01'),
    monthBucket: '2026-05',
  },
];

const FAKE_INCIDENTS = [
  {
    incidentUid: 'inc_001',
    title: '生产环境故障',
    severity: 'P1',
    createdAt: new Date('2026-05-10'),
  },
];

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AiService', () => {
  let service: AiService;
  let mockRepo: ReturnType<typeof createMockRepo>;
  let mockDeepSeek: ReturnType<typeof createMockDeepSeek>;
  let mockClassifier: ReturnType<typeof createMockClassifier>;

  beforeEach(() => {
    mockRepo = createMockRepo();
    mockDeepSeek = createMockDeepSeek();
    mockClassifier = createMockClassifier();

    // Default: users + projects loaded for entity extraction
    mockRepo.getAllUsers.mockResolvedValue(FAKE_USERS);
    mockRepo.getAllProjects.mockResolvedValue(FAKE_PROJECTS);
    mockRepo.getRecentConversations.mockResolvedValue([]);
    mockRepo.saveConversation.mockResolvedValue({ conversationUid: 'conv_test001' });

    service = new AiService(
      mockRepo as unknown as AiRepository,
      mockDeepSeek as unknown as DeepSeekClient,
      mockClassifier as unknown as IntentClassifier,
    );
  });

  // ── Intent classification tests ────────────────────────────────────────────

  describe('intent: employee_tasks', () => {
    it('should classify "张三本月在干什么" as employee_tasks and query tasks', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'employee_tasks',
        entities: { employee_name: '张三', employee_user_id: 'ou_dev_alice', month: '2026-05' },
      });
      mockRepo.getEmployeeTasks.mockResolvedValue(FAKE_TASKS);
      mockDeepSeek.chat.mockResolvedValue({ answer: '张三本月有1项任务', tokens_used: 100 });

      const result = await service.chat({
        question: '张三本月在干什么',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockClassifier.classify).toHaveBeenCalledWith('张三本月在干什么');
      expect(mockRepo.getEmployeeTasks).toHaveBeenCalledWith(
        'ou_dev_alice',
        '2026-05',
        expect.any(Object),
      );
      expect(result.intent).toBe('employee_tasks');
      expect(result.answer).toBe('张三本月有1项任务');
    });
  });

  describe('intent: near_due_tasks', () => {
    it('should classify "哪些任务快逾期了" as near_due_tasks and query near-due tasks', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue(FAKE_TASKS);
      mockDeepSeek.chat.mockResolvedValue({ answer: '有1项任务快到期', tokens_used: 80 });

      const result = await service.chat({
        question: '哪些任务快逾期了',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockClassifier.classify).toHaveBeenCalledWith('哪些任务快逾期了');
      expect(mockRepo.getNearDueTasks).toHaveBeenCalledWith(expect.any(Object));
      expect(result.intent).toBe('near_due_tasks');
    });
  });

  describe('intent: project_progress', () => {
    it('should classify "印尼电商项目什么进度" as project_progress', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'project_progress',
        entities: { project_name: '印尼电商', project_uid: 'proj_001' },
      });
      mockRepo.getProjectProgress.mockResolvedValue({
        projectName: '印尼电商',
        total: 10,
        done: 7,
        completionRate: 0.7,
      });
      mockDeepSeek.chat.mockResolvedValue({ answer: '印尼电商项目完成率70%', tokens_used: 90 });

      const result = await service.chat({
        question: '印尼电商项目什么进度',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockClassifier.classify).toHaveBeenCalledWith('印尼电商项目什么进度');
      expect(mockRepo.getProjectProgress).toHaveBeenCalledWith('proj_001', expect.any(Object));
      expect(result.intent).toBe('project_progress');
    });
  });

  describe('intent: completion_ranking', () => {
    it('should classify "完成率最低的是谁" as completion_ranking', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'completion_ranking',
        entities: { month: '2026-05' },
      });
      mockRepo.getCompletionRanking.mockResolvedValue([
        { assigneeName: '李四', total: 5, done: 1, completionRate: 0.2 },
        { assigneeName: '张三', total: 4, done: 2, completionRate: 0.5 },
      ]);
      mockDeepSeek.chat.mockResolvedValue({ answer: '完成率最低的是李四(20%)', tokens_used: 100 });

      const result = await service.chat({
        question: '完成率最低的是谁',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockClassifier.classify).toHaveBeenCalledWith('完成率最低的是谁');
      expect(mockRepo.getCompletionRanking).toHaveBeenCalledWith('2026-05', expect.any(Object));
      expect(result.intent).toBe('completion_ranking');
    });
  });

  describe('intent: employee_incidents', () => {
    it('should classify "张三有没有出事故" as employee_incidents (priority over employee_tasks)', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'employee_incidents',
        entities: { employee_name: '张三', employee_user_id: 'ou_dev_alice', month: '2026-05' },
      });
      mockRepo.getEmployeeIncidents.mockResolvedValue(FAKE_INCIDENTS);
      mockDeepSeek.chat.mockResolvedValue({ answer: '张三本月有1条P1事故记录', tokens_used: 90 });

      const result = await service.chat({
        question: '张三有没有出事故',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockClassifier.classify).toHaveBeenCalledWith('张三有没有出事故');
      expect(mockRepo.getEmployeeIncidents).toHaveBeenCalledWith(
        'ou_dev_alice',
        '2026-05',
      );
      expect(result.intent).toBe('employee_incidents');
    });
  });

  describe('intent: task_overdue', () => {
    it('should classify "哪些任务延期了" as task_overdue', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'task_overdue',
        entities: {},
      });
      mockRepo.getOverdueTasks.mockResolvedValue(FAKE_TASKS);
      mockDeepSeek.chat.mockResolvedValue({ answer: '有1项任务延期', tokens_used: 80 });

      const result = await service.chat({
        question: '哪些任务延期了',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockClassifier.classify).toHaveBeenCalledWith('哪些任务延期了');
      expect(mockRepo.getOverdueTasks).toHaveBeenCalledWith(expect.any(Object));
      expect(result.intent).toBe('task_overdue');
    });
  });

  describe('intent: unknown', () => {
    it('should return a fixed fallback message when intent is unknown', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'unknown',
        entities: {},
      });

      const result = await service.chat({
        question: '今天天气怎么样',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(result.intent).toBe('unknown');
      expect(result.answer).toContain('暂时无法理解');
      // DeepSeek should NOT be called for unknown intent
      expect(mockDeepSeek.chat).not.toHaveBeenCalled();
    });
  });

  // ── Permission tests ──────────────────────────────────────────────────────

  describe('permissions', () => {
    it('should throw 1002 UNAUTHORIZED when role is employee', async () => {
      await expect(
        service.chat({
          question: '哪些任务快逾期了',
          sessionId: 'sess_001',
          userId: 'ou_dev_alice',
          userName: '张三',
          role: UserRole.EMPLOYEE,
          source: 'web',
        }),
      ).rejects.toMatchObject({
        businessCode: ErrorCode.UNAUTHORIZED,
      });
    });

    it('should include leaderUserId in scopeFilter for leader role', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue([]);
      mockDeepSeek.chat.mockResolvedValue({ answer: '暂无相关记录', tokens_used: 50 });

      await service.chat({
        question: '哪些任务快逾期了',
        sessionId: 'sess_001',
        userId: 'ou_dev_harvey',
        userName: 'Harvey',
        role: UserRole.LEADER,
        source: 'web',
      });

      // scopeFilter should have leaderUserId set to current user
      expect(mockRepo.getNearDueTasks).toHaveBeenCalledWith(
        expect.objectContaining({ leaderUserId: 'ou_dev_harvey' }),
      );
    });

    it('should pass empty scopeFilter for boss role (全公司)', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue([]);
      mockDeepSeek.chat.mockResolvedValue({ answer: '暂无相关记录', tokens_used: 50 });

      await service.chat({
        question: '哪些任务快逾期了',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: 'Tobi',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockRepo.getNearDueTasks).toHaveBeenCalledWith(
        expect.not.objectContaining({ leaderUserId: expect.anything() }),
      );
    });

    it('should allow pmo role with full company scope', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue([]);
      mockDeepSeek.chat.mockResolvedValue({ answer: '暂无相关记录', tokens_used: 50 });

      await expect(
        service.chat({
          question: '哪些任务快逾期了',
          sessionId: 'sess_001',
          userId: 'ou_dev_pmo',
          userName: 'PMO',
          role: UserRole.PMO,
          source: 'web',
        }),
      ).resolves.toBeDefined();
    });
  });

  // ── DeepSeek integration tests ────────────────────────────────────────────

  describe('deepseek client', () => {
    it('should return the answer from DeepSeek API response', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue(FAKE_TASKS);
      mockDeepSeek.chat.mockResolvedValue({
        answer: '本月有1项任务将在3天内到期，请及时跟进。',
        tokens_used: 150,
      });

      const result = await service.chat({
        question: '哪些任务快逾期了',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(result.answer).toBe('本月有1项任务将在3天内到期，请及时跟进。');
    });

    it('should throw BusinessException 1008 when DeepSeek API call fails', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue(FAKE_TASKS);
      mockDeepSeek.chat.mockRejectedValue(new Error('API timeout'));

      await expect(
        service.chat({
          question: '哪些任务快逾期了',
          sessionId: 'sess_001',
          userId: 'ou_dev_boss',
          userName: '老板',
          role: UserRole.BOSS,
          source: 'web',
        }),
      ).rejects.toMatchObject({
        businessCode: 1008,
      });
    });
  });

  // ── Multi-turn conversation tests ─────────────────────────────────────────

  describe('multi-turn conversation', () => {
    it('should pass last 5 conversation turns to DeepSeek', async () => {
      // 7 previous turns — only last 5 should be passed
      const fakeTurns = Array.from({ length: 7 }, (_, i) => ({
        question: `问题${i}`,
        answer: `回答${i}`,
        turnIndex: i,
      }));
      mockRepo.getRecentConversations.mockResolvedValue(fakeTurns);

      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue([]);
      mockDeepSeek.chat.mockResolvedValue({ answer: '暂无相关记录', tokens_used: 50 });

      await service.chat({
        question: '继续上面的话题',
        sessionId: 'sess_001',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      // DeepSeek should receive messages with history (system + 5*2 history + 1 current = 12)
      // mockDeepSeek.chat is called as chat({ messages, ... }) — first arg is options object
      const callArgs = mockDeepSeek.chat.mock.calls[0][0] as { messages: ChatMessage[] };
      // system prompt + 5 turns * 2 messages each + 1 current = 12
      expect(callArgs.messages.length).toBe(1 + 5 * 2 + 1);
    });
  });

  // ── Conversation persistence tests ───────────────────────────────────────

  describe('conversation persistence', () => {
    it('should save conversation to repository after successful chat', async () => {
      mockClassifier.classify.mockReturnValue({
        intent: 'near_due_tasks',
        entities: {},
      });
      mockRepo.getNearDueTasks.mockResolvedValue(FAKE_TASKS);
      mockDeepSeek.chat.mockResolvedValue({ answer: '有任务快到期', tokens_used: 100 });

      await service.chat({
        question: '哪些任务快逾期了',
        sessionId: 'sess_persist',
        userId: 'ou_dev_boss',
        userName: '老板',
        role: UserRole.BOSS,
        source: 'web',
      });

      expect(mockRepo.saveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess_persist',
          question: '哪些任务快逾期了',
          intent: 'near_due_tasks',
          answer: '有任务快到期',
          source: 'web',
        }),
      );
    });
  });
});

// ─── IntentClassifier unit tests ─────────────────────────────────────────────

describe('IntentClassifier', () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier();
    // Seed classifier with user cache
    classifier.refreshCache(FAKE_USERS, FAKE_PROJECTS);
  });

  it('should classify "张三有没有出事故" as employee_incidents (highest priority)', () => {
    const result = classifier.classify('张三有没有出事故');
    expect(result.intent).toBe('employee_incidents');
    expect(result.entities.employee_name).toBe('张三');
  });

  it('should classify "哪些任务快逾期了" as near_due_tasks', () => {
    const result = classifier.classify('哪些任务快逾期了');
    expect(result.intent).toBe('near_due_tasks');
  });

  it('should classify "印尼电商项目什么进度" as project_progress', () => {
    const result = classifier.classify('印尼电商项目什么进度');
    expect(result.intent).toBe('project_progress');
    expect(result.entities.project_name).toBe('印尼电商');
  });

  it('should classify "完成率最低的是谁" as completion_ranking', () => {
    const result = classifier.classify('完成率最低的是谁');
    expect(result.intent).toBe('completion_ranking');
  });

  it('should classify "哪些任务延期了" as task_overdue', () => {
    const result = classifier.classify('哪些任务延期了');
    expect(result.intent).toBe('task_overdue');
  });

  it('should classify "张三本月任务" as employee_tasks', () => {
    const result = classifier.classify('张三本月任务');
    expect(result.intent).toBe('employee_tasks');
    expect(result.entities.employee_name).toBe('张三');
  });

  it('should classify unknown question as "unknown"', () => {
    const result = classifier.classify('今天天气怎么样');
    expect(result.intent).toBe('unknown');
  });

  it('should extract month from "上个月" and convert to correct YYYY-MM format', () => {
    const result = classifier.classify('上个月哪些任务快逾期了');
    // Should not be 'unknown', and month should be last month
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const expectedMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    expect(result.entities.month).toBe(expectedMonth);
  });
});
