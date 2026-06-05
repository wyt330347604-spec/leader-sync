-- db/migrations/0007_add_ai_conversation.sql
-- AI 对话历史表：用于多轮对话上下文传递和使用审计
-- 完全隔离：不修改任何现有表，不设数据库级外键
-- 注意：此表不设 deleted_at（对话历史不需要软删除，保留 90 天后可定期归档）

CREATE TABLE ai_conversation (
  id                 BIGSERIAL     PRIMARY KEY,
  conversation_uid   VARCHAR(64)   NOT NULL,

  -- 提问人（软引用 org_cache.user_id）
  user_id            VARCHAR(128)  NOT NULL,
  user_name          VARCHAR(128)  NOT NULL,
  user_role          VARCHAR(32)   NOT NULL,   -- 冗余存储，避免关联查询

  -- 入口来源：'web' | 'feishu_bot'
  source             VARCHAR(32)   NOT NULL,
  feishu_open_id     VARCHAR(128),             -- 飞书机器人来源时填入
  session_id         VARCHAR(128),             -- 前端会话 ID（悬浮框每次打开新建 UUID）

  -- 对话轮次（支持多轮上下文，最多传递最近 5 轮）
  turn_index         INTEGER       NOT NULL DEFAULT 0,

  -- 问与答
  question           TEXT          NOT NULL,
  intent             VARCHAR(64),              -- 意图分类结果
  intent_entities    JSONB,                   -- 提取的实体（员工名、月份、项目等）
  raw_data           JSONB,                   -- 数据查询原始结果（方便审计 AI 回答是否有数据支撑）
  answer             TEXT,                    -- DeepSeek 返回的自然语言回答
  error_message      TEXT,                    -- 出错时记录

  -- 耗时 & 成本
  llm_latency_ms     INTEGER,                 -- DeepSeek API 调用耗时（毫秒）
  tokens_used        INTEGER,                 -- 本轮消耗 tokens

  -- 审计
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uniq_ai_conversation_uid  ON ai_conversation (conversation_uid);
CREATE INDEX idx_ai_conv_user_id              ON ai_conversation (user_id);
CREATE INDEX idx_ai_conv_session_id           ON ai_conversation (session_id);
CREATE INDEX idx_ai_conv_created_at           ON ai_conversation (created_at);
