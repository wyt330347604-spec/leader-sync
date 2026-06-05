import { GradeTriggerType } from '@leader-sync/shared-types';

/** Alias – updating a grade uses the same fields as setting one */
export interface UpdateGradeDto {
  grade: string;
  trigger_type: GradeTriggerType;
  note?: string;
  score_snapshot?: Record<string, unknown>;
}
