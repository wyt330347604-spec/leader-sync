import crypto from 'node:crypto';

/** Generates a score UID in format sc_<8hex> as specified in monthly-score-module.md */
export function generateScoreUid(): string {
  return `sc_${crypto.randomBytes(4).toString('hex')}`;
}

/** 季度考核实体 uid：<prefix>_<12hex>（qc/qt/qs）。 */
export function generateUid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}
