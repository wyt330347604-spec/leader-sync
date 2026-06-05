import { GradeTriggerType } from '@leader-sync/shared-types';

export interface SetGradeDto {
  /** 职级，格式 T4.0–T8.3，如 "T5.2" */
  grade: string;

  /** 触发原因：initial_entry / biannual_promotion / manual_adjustment */
  trigger_type: GradeTriggerType;

  /** manual_adjustment 时必填备注 */
  note?: string;

  /** 可选绩效快照（jsonb） */
  score_snapshot?: Record<string, unknown>;
}
