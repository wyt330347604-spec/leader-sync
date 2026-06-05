/**
 * intent-classifier.ts
 *
 * 基于规则的意图分类器 + 实体提取。
 * 不依赖外部 NLP 服务，全部在内存中完成，延迟 <1ms。
 *
 * 意图类型（按优先级顺序）：
 *   employee_incidents → near_due_tasks → project_progress →
 *   completion_ranking → task_overdue → employee_tasks → unknown
 */

export type IntentType =
  | 'employee_tasks'
  | 'near_due_tasks'
  | 'project_progress'
  | 'completion_ranking'
  | 'employee_incidents'
  | 'task_overdue'
  | 'unknown';

export interface IntentEntities {
  employee_name?: string;
  employee_user_id?: string;
  project_name?: string;
  project_uid?: string;
  month?: string;
}

export interface ClassifyResult {
  intent: IntentType;
  entities: IntentEntities;
}

interface UserCacheEntry {
  userId: string;
  userName: string;
}

interface ProjectCacheEntry {
  projectUid: string;
  name: string;
}

interface IntentPattern {
  intent: IntentType;
  patterns: RegExp[];
  requiresEmployee?: boolean;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'employee_incidents',
    // 事故意图最高优先级 — 在 employee_tasks 之前匹配
    patterns: [/出事故/, /事故记录/, /有没有事故/, /什么事故/, /事故情况/],
    requiresEmployee: true,
  },
  {
    intent: 'near_due_tasks',
    patterns: [/快逾期/, /快到期/, /[123三]天内/, /马上到期/, /快要到期/, /即将到期/, /临期/],
  },
  {
    intent: 'project_progress',
    patterns: [/项目.*进度/, /进度.*项目/, /什么进度/, /项目.*完成/, /项目.*情况/],
  },
  {
    intent: 'completion_ranking',
    patterns: [/完成率.*最低/, /谁.*完成率/, /完成率排名/, /完成率最差/, /最低.*完成/, /完成率.*谁/],
  },
  {
    intent: 'task_overdue',
    patterns: [/延期任务/, /谁.*延期/, /哪些.*延期/, /延期了/, /已延期/],
  },
  {
    intent: 'employee_tasks',
    // 通用兜底：包含人名则归入此类
    patterns: [/最近在干什么/, /本月任务/, /在做什么/, /在干什么/, /任务列表/, /负责什么/, /做了什么/],
    requiresEmployee: true,
  },
];

export class IntentClassifier {
  private userCache: UserCacheEntry[] = [];
  private projectCache: ProjectCacheEntry[] = [];

  /**
   * 刷新用户和项目缓存（由 AiService 在启动或 TTL 后调用）
   */
  refreshCache(users: UserCacheEntry[], projects: ProjectCacheEntry[]): void {
    this.userCache = users;
    this.projectCache = projects;
  }

  /**
   * 分类问题意图并提取实体
   */
  classify(question: string): ClassifyResult {
    const entities: IntentEntities = {};

    // 预提取月份（所有意图都可能需要）
    const month = this.extractMonth(question);
    if (month) {
      entities.month = month;
    } else {
      entities.month = this.getCurrentMonth();
    }

    for (const pattern of INTENT_PATTERNS) {
      const matched = pattern.patterns.some((re) => re.test(question));

      if (!matched) continue;

      // 需要员工实体的意图 — 尝试提取员工名
      if (pattern.requiresEmployee) {
        const employee = this.extractPersonName(question);
        if (employee) {
          entities.employee_name = employee.userName;
          entities.employee_user_id = employee.userId;
        }

        // employee_incidents 和 employee_tasks 如果没有识别到人名
        // 仍然可以运行（返回全局数据）
      }

      // project_progress 需要提取项目名
      if (pattern.intent === 'project_progress') {
        const project = this.extractProjectName(question);
        if (project) {
          entities.project_name = project.name;
          entities.project_uid = project.projectUid;
        }
      }

      return { intent: pattern.intent, entities };
    }

    // 兜底：如果有人名也当作 employee_tasks
    const employee = this.extractPersonName(question);
    if (employee) {
      entities.employee_name = employee.userName;
      entities.employee_user_id = employee.userId;
      return { intent: 'employee_tasks', entities };
    }

    return { intent: 'unknown', entities: {} };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private extractPersonName(question: string): UserCacheEntry | null {
    for (const user of this.userCache) {
      if (user.userName && question.includes(user.userName)) {
        return user;
      }
    }
    return null;
  }

  private extractProjectName(question: string): ProjectCacheEntry | null {
    for (const project of this.projectCache) {
      if (project.name && question.includes(project.name)) {
        return project;
      }
    }
    return null;
  }

  private extractMonth(question: string): string | null {
    const now = new Date();

    // "上月" / "上个月"
    if (/上个?月/.test(question)) {
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return this.formatMonth(last);
    }

    // "本月" / "这个月" — 明确提及本月时也显式设置
    if (/本月|这个?月/.test(question)) {
      return this.formatMonth(now);
    }

    // "YYYY年MM月" 或 "MM月"
    const yearMonthMatch = question.match(/(\d{4})年(\d{1,2})月/);
    if (yearMonthMatch) {
      const year = parseInt(yearMonthMatch[1], 10);
      const month = parseInt(yearMonthMatch[2], 10);
      return `${year}-${String(month).padStart(2, '0')}`;
    }

    const monthOnlyMatch = question.match(/(\d{1,2})月(?!日)/);
    if (monthOnlyMatch) {
      const month = parseInt(monthOnlyMatch[1], 10);
      if (month >= 1 && month <= 12) {
        return `${now.getFullYear()}-${String(month).padStart(2, '0')}`;
      }
    }

    return null;
  }

  private getCurrentMonth(): string {
    return this.formatMonth(new Date());
  }

  private formatMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
