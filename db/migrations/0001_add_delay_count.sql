-- Add delay_count column to track how many times a task has been postponed.
-- Distinct from carry_over_count (which is incremented by the monthly-close worker).
-- Incremented by POST /tasks/:task_uid/delay only.
ALTER TABLE "task" ADD COLUMN "delay_count" integer NOT NULL DEFAULT 0;
