// All enums are the single source of truth in code,
// aligned with docs/02-data/enum-dictionary.md
// Status and Priority values adapted to match existing Bitable field values.

export const TaskStatus = {
  PENDING: 'pending',             // 待办
  NOT_STARTED: 'not_started',     // 待开始
  IN_PROGRESS: 'in_progress',     // 进行中
  STALLED: 'stalled',             // 已停滞
  DONE: 'done',                   // 已完成
  SHELVED: 'shelved',             // 已搁置
  // Reserved for future (not in Bitable MVP)
  PENDING_REVIEW: 'pending_review',
  REOPENED: 'reopened',
  CLOSED: 'closed',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskStatusLabel: Record<string, string> = {
  pending: '待办',
  not_started: '待开始',
  in_progress: '进行中',
  stalled: '已停滞',
  done: '已完成',
  shelved: '已搁置',
  pending_review: '待验收',
  reopened: '重新打开',
  closed: '已归档',
};

// Bitable Chinese → system value
export const BitableStatusMap: Record<string, string> = {
  '待办': 'pending',
  '待开始': 'not_started',
  '进行中': 'in_progress',
  '已停滞': 'stalled',
  '已完成': 'done',
  '已搁置': 'shelved',
};

export const Priority = {
  URGENT_IMPORTANT: 'urgent_important',
  IMPORTANT_NOT_URGENT: 'important_not_urgent',
  URGENT_NOT_IMPORTANT: 'urgent_not_important',
  NOT_URGENT_NOT_IMPORTANT: 'not_urgent_not_important',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const PriorityLabel: Record<string, string> = {
  urgent_important: '重要紧急',
  important_not_urgent: '重要不紧急',
  urgent_not_important: '紧急不重要',
  not_urgent_not_important: '不紧急不重要',
};

export const BitablePriorityMap: Record<string, string> = {
  '重要紧急': 'urgent_important',
  '重要不紧急': 'important_not_urgent',
  '紧急不重要': 'urgent_not_important',
  '不紧急不重要': 'not_urgent_not_important',
};

export const TaskType = {
  CARRY_OVER: 'carry_over',  // 上月遗留
  NEW: 'new',                // 本月新增
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TaskTypeLabel: Record<string, string> = {
  carry_over: '上月遗留',
  new: '本月新增',
};

// 任务可见性：public=公司共享（计入统计+同步多维表格）；private=个人仅自己可见（不计入统计、不同步）
export const TaskVisibility = {
  PUBLIC: 'public',
  PRIVATE: 'private',
} as const;
export type TaskVisibility = (typeof TaskVisibility)[keyof typeof TaskVisibility];

export const AssignmentType = {
  BOSS_ASSIGN: 'boss_assign',
  MANAGER_ASSIGN: 'manager_assign',
  PEER_COLLABORATION: 'peer_collaboration',
  SELF_CLAIM: 'self_claim',
  CARRY_OVER: 'carry_over',
} as const;
export type AssignmentType = (typeof AssignmentType)[keyof typeof AssignmentType];

export const SyncStatus = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  RETRYING: 'retrying',
  SUCCESS: 'success',
  FAILED: 'failed',
  CONFLICT: 'conflict',
  MANUAL_REVIEW: 'manual_review',
  SKIPPED: 'skipped',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const SourceType = {
  BITABLE: 'bitable',
  TASK: 'task',
  CALENDAR: 'calendar',
  CARD: 'card',
  API: 'api',
  SYSTEM: 'system',
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const RoleScope = {
  EMPLOYEE: 'employee',
  LEADER: 'leader',
  COMPANY: 'company',
} as const;
export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];

export const ConflictResolutionStatus = {
  RESOLVED_KEEP_LOCAL: 'resolved_keep_local',
  RESOLVED_ACCEPT_REMOTE: 'resolved_accept_remote',
  RESOLVED_MERGE: 'resolved_merge',
  RESOLVED_MANUAL_OVERRIDE: 'resolved_manual_override',
  UNRESOLVED_PENDING_REVIEW: 'unresolved_pending_review',
} as const;
export type ConflictResolutionStatus = (typeof ConflictResolutionStatus)[keyof typeof ConflictResolutionStatus];

export const UserRole = {
  EMPLOYEE: 'employee',
  LEADER: 'leader',
  BOSS: 'boss',
  PMO: 'pmo',
  ADMIN: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const ProjectCategory = {
  GROUP: 'jt',      // 集团
  SELF: 'zy',       // 自营
  SERVICE: 'fw',    // 服务
  INVEST: 'tz',     // 投资
  COOP: 'hz',       // 合作
} as const;
export type ProjectCategory = (typeof ProjectCategory)[keyof typeof ProjectCategory];

export const ProjectCategoryLabel: Record<string, string> = {
  jt: '集团',
  zy: '自营',
  fw: '服务',
  tz: '投资',
  hz: '合作',
};

// 显示顺序（页面渲染用）
export const ProjectCategoryOrder: ProjectCategory[] = ['jt', 'zy', 'fw', 'tz', 'hz'];

export const ProjectRegion = {
  INDIA: '印度',
  INDONESIA: '印尼',
  PAKISTAN: '巴基斯坦',
  BANGLADESH: '孟加拉',
  SHENZHEN: '深圳',
} as const;
export type ProjectRegion = (typeof ProjectRegion)[keyof typeof ProjectRegion];

export const ProjectRegionList: ProjectRegion[] = ['印度', '印尼', '巴基斯坦', '孟加拉', '深圳'];

// ─── Incident module enums ───────────────────────────────────────────────────

export const IncidentSeverity = {
  P0: 'P0',  // 生产崩溃 / 重大财务损失
  P1: 'P1',  // 严重违规（显著影响团队协作或业务进展）
  P2: 'P2',  // 一般违规（需整改但不紧急）
  P3: 'P3',  // 轻微问题（记录备案，不影响正常运营）
} as const;
export type IncidentSeverity = (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

export const IncidentConfirmStatus = {
  PENDING_CONFIRM: 'pending_confirm',  // 待 PMO/Boss 确认（P0/P1 创建时）
  CONFIRMED: 'confirmed',              // 已确认生效
  REJECTED: 'rejected',               // 已驳回（永不生效）
} as const;
export type IncidentConfirmStatus = (typeof IncidentConfirmStatus)[keyof typeof IncidentConfirmStatus];

export const IncidentInvolvement = {
  INVOLVED: 'involved',  // 普通涉及（默认）
  PRIMARY: 'primary',    // 主要责任人
} as const;
export type IncidentInvolvement = (typeof IncidentInvolvement)[keyof typeof IncidentInvolvement];

// ─── Grade module enums ──────────────────────────────────────────────────────

// 职级变更触发类型（三种：初始录入 / 半年度晋升 / 手动调整）
// T4.0–T8.3，共 20 级；格式校验正则：/^T[4-8]\.[0-3]$/
export const GradeTriggerType = {
  INITIAL_ENTRY: 'initial_entry',          // 初始录入（上线前 Harvey/PMO 手动填入存量员工职级）
  BIANNUAL_PROMOTION: 'biannual_promotion', // 半年度晋升（常规晋升周期）
  MANUAL_ADJUSTMENT: 'manual_adjustment',   // 手动调整（含降级 / 纠错 / 特殊情况，需填写 note）
} as const;
export type GradeTriggerType = (typeof GradeTriggerType)[keyof typeof GradeTriggerType];
