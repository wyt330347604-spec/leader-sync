import { TaskStatus } from '@leader-sync/shared-types';

const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  [TaskStatus.DRAFT]: [TaskStatus.ASSIGNED],
  [TaskStatus.ASSIGNED]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.BLOCKED, TaskStatus.PENDING_REVIEW, TaskStatus.DONE],
  [TaskStatus.BLOCKED]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.PENDING_REVIEW]: [TaskStatus.DONE, TaskStatus.IN_PROGRESS],
  [TaskStatus.DONE]: [TaskStatus.REOPENED, TaskStatus.CLOSED],
  [TaskStatus.REOPENED]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.CANCELLED]: [TaskStatus.CLOSED],
  [TaskStatus.CLOSED]: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export interface TransitionContext {
  readonly blocked_reason?: string;
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid status transition: ${from} \u2192 ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class MissingBlockedReasonError extends Error {
  constructor() {
    super('blocked_reason is required when transitioning to blocked status');
    this.name = 'MissingBlockedReasonError';
  }
}

export function validateTransition(from: string, to: string, context?: TransitionContext): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
  if (to === TaskStatus.BLOCKED && (!context?.blocked_reason || context.blocked_reason.trim() === '')) {
    throw new MissingBlockedReasonError();
  }
}
