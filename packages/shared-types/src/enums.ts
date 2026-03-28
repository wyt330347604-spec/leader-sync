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
