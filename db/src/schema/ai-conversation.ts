import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// ai_conversation — AI 对话历史表
// 对应 migration 0007_add_ai_conversation.sql
//
// 用途：
//   1. 多轮对话上下文传递（最多传递最近 5 轮给 DeepSeek）
//   2. 使用审计（raw_data 保留数据查询原始结果）
//
// 注意：此表不设 deleted_at（对话历史不需要软删除，保留 90 天后可定期归档）

export const aiConversation = pgTable(
  'ai_conversation',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationUid: varchar('conversation_uid', { length: 64 }).notNull(),  // 业务主键

    // 提问人（软引用 org_cache.user_id，不设 DB 外键）
    userId: varchar('user_id', { length: 128 }).notNull(),
    userName: varchar('user_name', { length: 128 }).notNull(),
    userRole: varchar('user_role', { length: 32 }).notNull(),  // 冗余存储，避免关联查询

    // 入口来源：'web' | 'feishu_bot'
    source: varchar('source', { length: 32 }).notNull(),
    feishuOpenId: varchar('feishu_open_id', { length: 128 }),  // 飞书机器人来源时填入
    sessionId: varchar('session_id', { length: 128 }),          // 前端会话 ID（悬浮框每次打开新建 UUID）

    // 对话轮次（0-indexed）
    turnIndex: integer('turn_index').notNull().default(0),

    // 问与答
    question: text('question').notNull(),
    intent: varchar('intent', { length: 64 }),              // 意图分类结果
    intentEntities: jsonb('intent_entities'),               // 提取的实体（员工名、月份、项目等）
    rawData: jsonb('raw_data'),                             // 数据查询原始结果（方便审计 AI 回答是否有数据支撑）
    answer: text('answer'),                                  // DeepSeek 返回的自然语言回答
    errorMessage: text('error_message'),                    // 出错时记录

    // 耗时 & 成本
    llmLatencyMs: integer('llm_latency_ms'),                // DeepSeek API 调用耗时（毫秒）
    tokensUsed: integer('tokens_used'),                      // 本轮消耗 tokens

    // 审计（无 deleted_at，历史不软删除）
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uniq_ai_conversation_uid').on(table.conversationUid),
    index('idx_ai_conv_user_id').on(table.userId),
    index('idx_ai_conv_session_id').on(table.sessionId),
    index('idx_ai_conv_created_at').on(table.createdAt),
  ],
);
