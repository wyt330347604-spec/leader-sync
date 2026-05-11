-- db/migrations/0003_project_arch_fields.sql
-- 给 project 表加 4 个 nullable 列，支撑「项目架构总览」分组视图

ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "category" varchar(8);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "owner_name" varchar(64);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "region" varchar(32);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "subtitle" varchar(64);
