import crypto from 'node:crypto';

/** Generates a score UID in format sc_<8hex> as specified in monthly-score-module.md */
export function generateScoreUid(): string {
  return `sc_${crypto.randomBytes(4).toString('hex')}`;
}
