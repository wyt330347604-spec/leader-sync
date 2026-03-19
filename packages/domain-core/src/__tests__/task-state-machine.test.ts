import { describe, it, expect } from 'vitest';
import { canTransition, validateTransition, InvalidTransitionError, MissingBlockedReasonError } from '../task-state-machine';

describe('canTransition', () => {
  const validCases: [string, string][] = [
    ['draft', 'assigned'],
    ['assigned', 'in_progress'],
    ['assigned', 'cancelled'],
    ['in_progress', 'blocked'],
    ['blocked', 'in_progress'],
    ['in_progress', 'pending_review'],
    ['pending_review', 'done'],
    ['pending_review', 'in_progress'],
    ['in_progress', 'done'],
    ['done', 'reopened'],
    ['reopened', 'in_progress'],
    ['done', 'closed'],
    ['cancelled', 'closed'],
  ];

  it.each(validCases)('%s → %s should be valid', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const invalidCases: [string, string][] = [
    ['draft', 'done'],
    ['draft', 'in_progress'],
    ['done', 'in_progress'],
    ['closed', 'draft'],
    ['closed', 'in_progress'],
    ['closed', 'reopened'],
    ['cancelled', 'in_progress'],
    ['blocked', 'done'],
    ['assigned', 'done'],
  ];

  it.each(invalidCases)('%s → %s should be invalid', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('should return false for unknown status', () => {
    expect(canTransition('unknown', 'draft')).toBe(false);
  });
});

describe('validateTransition', () => {
  it('should not throw for valid transition', () => {
    expect(() => validateTransition('draft', 'assigned')).not.toThrow();
  });

  it('should throw InvalidTransitionError for invalid transition', () => {
    expect(() => validateTransition('draft', 'done')).toThrow(InvalidTransitionError);
  });

  it('should throw MissingBlockedReasonError when transitioning to blocked without reason', () => {
    expect(() => validateTransition('in_progress', 'blocked')).toThrow(MissingBlockedReasonError);
    expect(() => validateTransition('in_progress', 'blocked', { blocked_reason: '' })).toThrow(MissingBlockedReasonError);
    expect(() => validateTransition('in_progress', 'blocked', { blocked_reason: '  ' })).toThrow(MissingBlockedReasonError);
  });

  it('should not throw when transitioning to blocked with reason', () => {
    expect(() => validateTransition('in_progress', 'blocked', { blocked_reason: 'Waiting for data' })).not.toThrow();
  });

  it('should throw for any transition from closed', () => {
    const allStatuses = ['draft', 'assigned', 'in_progress', 'blocked', 'pending_review', 'done', 'reopened', 'cancelled', 'closed'];
    for (const to of allStatuses) {
      expect(canTransition('closed', to)).toBe(false);
    }
  });
});
