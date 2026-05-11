import { pgTable, bigserial, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const project = pgTable('project', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectUid: varchar('project_uid', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 128 }).notNull(),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // ---- 2026-05 项目架构总览新增字段 ----
  category: varchar('category', { length: 8 }),       // ProjectCategory enum, nullable
  ownerName: varchar('owner_name', { length: 64 }),   // 自由文本姓名, null = 空缺
  region: varchar('region', { length: 32 }),          // ProjectRegion enum, nullable
  subtitle: varchar('subtitle', { length: 64 }),      // 副标签（NBFC × 2 等）
});
