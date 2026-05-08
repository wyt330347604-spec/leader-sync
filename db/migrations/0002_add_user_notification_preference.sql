-- Per-user notification preferences (daily overdue + weekly summary).
-- Absence of a row means defaults: both enabled.
CREATE TABLE "user_notification_preference" (
  "id" bigserial PRIMARY KEY,
  "user_id" varchar(128) NOT NULL,
  "daily_overdue_enabled" boolean NOT NULL DEFAULT true,
  "weekly_summary_enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "uniq_user_notif_pref_user" UNIQUE ("user_id")
);
