export const TaskType = {
  STRATEGY: 'strategy',
  OPERATION: 'operation',
  PROJECT: 'project',
  REPORT: 'report',
  MEETING: 'meeting',
  COLLABORATION: 'collaboration',
  FOLLOW_UP: 'follow_up',
  OTHER: 'other',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const Priority = {
  P0: 'p0',
  P1: 'p1',
  P2: 'p2',
  P3: 'p3',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const AssignmentType = {
  BOSS_ASSIGN: 'boss_assign',
  MANAGER_ASSIGN: 'manager_assign',
  PEER_COLLABORATION: 'peer_collaboration',
  SELF_CLAIM: 'self_claim',
  CARRY_OVER: 'carry_over',
} as const;
export type AssignmentType = (typeof AssignmentType)[keyof typeof AssignmentType];

export const TaskStatus = {
  DRAFT: 'draft',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  PENDING_REVIEW: 'pending_review',
  DONE: 'done',
  REOPENED: 'reopened',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

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
