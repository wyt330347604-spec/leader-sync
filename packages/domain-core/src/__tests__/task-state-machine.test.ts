import { describe, it, expect } from 'vitest';
import { canTransition, validateTransition, InvalidTransitionError, MissingStallReasonError } from '../task-state-machine';

describe('canTransition', () => {
  const validCases: [string, string][] = [
    // pending can go to many places (all active states treated as "进行中")
    ['pending', 'not_started'],
    ['pending', 'in_progress'],
    ['pending', 'done'],
    ['pending', 'shelved'],
    // not_started
    ['not_started', 'in_progress'],
    ['not_started', 'done'],
    ['not_started', 'shelved'],
    // in_progress
    ['in_progress', 'stalled'],
    ['in_progress', 'done'],
    ['in_progress', 'shelved'],
    // stalled
    ['stalled', 'in_progress'],
    ['stalled', 'done'],
    ['stalled', 'shelved'],
    // done
    ['done', 'reopened'],
    ['done', 'closed'],
    // reopened
    ['reopened', 'in_progress'],
    ['reopened', 'done'],
    // shelved
    ['shelved', 'in_progress'],
    ['shelved', 'closed'],
  ];

  it.each(validCases)('%s → %s should be valid', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const invalidCases: [string, string][] = [
    ['pending', 'stalled'],
    ['not_started', 'pending'],
    ['in_progress', 'pending'],
    ['done', 'in_progress'],
    ['done', 'pending'],
    ['closed', 'pending'],
    ['closed', 'not_started'],
    ['closed', 'in_progress'],
    ['closed', 'stalled'],
    ['closed', 'done'],
    ['closed', 'reopened'],
    ['closed', 'shelved'],
    ['closed', 'closed'],
    ['shelved', 'pending'],
    ['reopened', 'pending'],
    ['stalled', 'pending'],
  ];

  it.each(invalidCases)('%s → %s should be invalid', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('should return false for unknown status', () => {
    expect(canTransition('unknown', 'pending')).toBe(false);
  });
});

describe('validateTransition', () => {
  it('should not throw for valid transition', () => {
    expect(() => validateTransition('pending', 'done')).not.toThrow();
  });

  it('should throw InvalidTransitionError for invalid transition', () => {
    expect(() => validateTransition('closed', 'done')).toThrow(InvalidTransitionError);
  });

  it('should throw MissingStallReasonError when transitioning to stalled without reason', () => {
    expect(() => validateTransition('in_progress', 'stalled')).toThrow(MissingStallReasonError);
    expect(() => validateTransition('in_progress', 'stalled', { stall_reason: '' })).toThrow(MissingStallReasonError);
    expect(() => validateTransition('in_progress', 'stalled', { stall_reason: '  ' })).toThrow(MissingStallReasonError);
  });

  it('should not throw when transitioning to stalled with reason', () => {
    expect(() => validateTransition('in_progress', 'stalled', { stall_reason: '等待数据' })).not.toThrow();
  });

  it('should throw for any transition from closed (terminal state)', () => {
    const allStatuses = ['pending', 'not_started', 'in_progress', 'stalled', 'done', 'reopened', 'shelved', 'closed'];
    for (const to of allStatuses) {
      expect(canTransition('closed', to)).toBe(false);
    }
  });
});
