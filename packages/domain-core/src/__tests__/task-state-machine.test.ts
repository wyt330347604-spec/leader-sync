import { describe, it, expect } from 'vitest';
import { canTransition, validateTransition, InvalidTransitionError, MissingStallReasonError } from '../task-state-machine';

describe('canTransition', () => {
  const validCases: [string, string][] = [
    ['pending', 'not_started'],
    ['pending', 'shelved'],
    ['not_started', 'in_progress'],
    ['not_started', 'shelved'],
    ['in_progress', 'stalled'],
    ['in_progress', 'done'],
    ['stalled', 'in_progress'],
    ['stalled', 'shelved'],
    ['done', 'reopened'],
    ['done', 'closed'],
    ['reopened', 'in_progress'],
    ['shelved', 'closed'],
  ];

  it.each(validCases)('%s → %s should be valid', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const invalidCases: [string, string][] = [
    ['pending', 'done'],
    ['pending', 'in_progress'],
    ['pending', 'stalled'],
    ['not_started', 'done'],
    ['not_started', 'pending'],
    ['in_progress', 'pending'],
    ['in_progress', 'shelved'],
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
    ['shelved', 'in_progress'],
    ['shelved', 'pending'],
    ['reopened', 'done'],
    ['reopened', 'pending'],
    ['stalled', 'done'],
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
    expect(() => validateTransition('pending', 'not_started')).not.toThrow();
  });

  it('should throw InvalidTransitionError for invalid transition', () => {
    expect(() => validateTransition('pending', 'done')).toThrow(InvalidTransitionError);
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
