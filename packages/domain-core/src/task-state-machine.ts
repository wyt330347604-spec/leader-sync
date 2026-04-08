import { TaskStatus } from '@leader-sync/shared-types';

const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  [TaskStatus.PENDING]: [TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.SHELVED],
  [TaskStatus.NOT_STARTED]: [TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.SHELVED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.STALLED, TaskStatus.DONE, TaskStatus.SHELVED],
  [TaskStatus.STALLED]: [TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.SHELVED],
  [TaskStatus.DONE]: [TaskStatus.REOPENED, TaskStatus.CLOSED],
  [TaskStatus.REOPENED]: [TaskStatus.IN_PROGRESS, TaskStatus.DONE],
  [TaskStatus.SHELVED]: [TaskStatus.IN_PROGRESS, TaskStatus.CLOSED],
  [TaskStatus.CLOSED]: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export interface TransitionContext {
  readonly stall_reason?: string;
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class MissingStallReasonError extends Error {
  constructor() {
    super('stall_reason is required when transitioning to stalled status');
    this.name = 'MissingStallReasonError';
  }
}

export function validateTransition(from: string, to: string, context?: TransitionContext): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
  if (to === TaskStatus.STALLED && (!context?.stall_reason || context.stall_reason.trim() === '')) {
    throw new MissingStallReasonError();
  }
}
