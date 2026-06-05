# AI 对话助手模块 设计文档

- **日期**: 2026-05-24
- **状态**: Draft（待确认清单需项目负责人逐条确认，确认完毕后进入执行阶段）
- **范围**: 新增 `ai` 模块（DB + API + 前端悬浮组件 + 飞书机器人），完全隔离，不修改任何现有表和业务路由
- **参考**: `AI-HANDOFF.md §5-§7`、`CLAUDE.md`、`docs/05-permissions/permission-matrix.md`

---

## 1. 问题诊断

### 1.1 为什么要做这个模块

当前系统提供了结构化的任务列表、Dashboard 聚合视图和项目架构概览，但所有信息都以"表格/图表"形式呈现，Leader 和 Boss 需要主动导航到对应页面才能获取答案。主要痛点：

1. **信息获取摩擦高**：Leader 想知道"王五这个月在做什么"，需要手动打开任务列表 → 筛人员 → 筛月份，三步以上。
2. **飞书场景断层**：团队日常在飞书沟通，切换到 Web 系统有上下文切换成本；现有飞书机器人只做推送，无法回答问题。
3. **数据洞察门槛**：部分问题（如"完成率最低的是谁"）需要 Boss 在 Dashboard 里自行阅读排名，没有直接语言化的答案。
4. **多端入口缺失**：没有跨页面的即时查询入口，每次查询都要重新导航。

### 1.2 解决方案定位

- 新增独立的 `ai` 模块，**不修改任何现有表**（`task`、`project`、`org_cache` 等），只读查询现有数据。
- 提供两个入口：Web 端右下角悬浮对话框（全局可用）、飞书机器人（@提问）。
- 通过意图识别将自然语言问题映射到对应的数据查询，结合 DeepSeek API 将结构化数据转化为自然语言回答。
- 数据权限严格按提问人身份隔离，不新增权限体系，复用现有 `UserRole` 枚举和 JWT 身份。

---

## 2. 整体架构

### 2.1 请求流转链路

```
用户输入自然语言问题
        │
        ▼
┌──────────────────────────────────────┐
│  入口层                               │
│  A. Web 悬浮对话框 → POST /ai/chat   │
│  B. 飞书机器人消息 → Worker 事件处理  │
│     → POST /ai/chat (internal)       │
└──────────────────┬───────────────────┘
                   │  { question, userId, role }
                   ▼
┌──────────────────────────────────────┐
│  apps/api — AiModule                 │
│                                       │
│  1. AuthGuard: 验证 JWT / 飞书身份   │
│  2. 权限注入: 确定 scope_filter      │
│     (boss: 无限制 / leader: 仅下属)  │
│  3. AiService.chat()                 │
│     ├─ IntentClassifier              │
│     │   识别意图 + 提取实体           │
│     ├─ DataQueryEngine               │
│     │   按意图执行 SQL 查询           │
│     └─ DeepSeekClient                │
│         构建 prompt + 调用 API       │
│                                       │
│  4. 存 ai_conversation (可选)        │
│  5. 返回 { answer, raw_data }        │
└──────────────────────────────────────┘
                   │
                   ▼
         格式化后返回给用户
```

### 2.2 模块边界

- `ai` 模块只读 PostgreSQL，**禁止任何写操作到 task/project/org_cache 等核心表**。
- 飞书机器人接入在 `apps/worker` 内新增事件监听，通过内部 HTTP 调用 `apps/api` 的 `/ai/chat` 端点，不直接操作数据库。
- 对话历史写入专属的 `ai_conversation` 表，不影响其他模块。

---

## 3. DB Schema

### 3.1 新增表：`ai_conversation`

对话历史表，用于上下文传递（多轮对话）和使用审计。

```sql
CREATE TABLE ai_conversation (
  id                BIGSERIAL     PRIMARY KEY,
  conversation_uid  VARCHAR(64)   NOT NULL,
  UNIQUE(conversation_uid),

  -- 提问人
  user_id           VARCHAR(128)  NOT NULL,   -- 引用 org_cache.user_id
  user_name         VARCHAR(128)  NOT NULL,
  user_role         VARCHAR(32)   NOT NULL,   -- 冗余存储，避免关联查询

  -- 入口来源
  source            VARCHAR(32)   NOT NULL,   -- 'web' | 'feishu_bot'
  feishu_open_id    VARCHAR(128),             -- 飞书机器人来源时填入
  session_id        VARCHAR(128),             -- 前端会话 ID（悬浮框每次打开新建）

  -- 对话轮次
  turn_index        INTEGER       NOT NULL DEFAULT 0,

  -- 问与答
  question          TEXT          NOT NULL,
  intent            VARCHAR(64),              -- 意图分类结果
  intent_entities   JSONB,                   -- 提取的实体（员工名、月份、项目等）
  raw_data          JSONB,                   -- 数据查询原始结果（方便审计）
  answer            TEXT,                    -- DeepSeek 返回的自然语言回答
  error_message     TEXT,                    -- 出错时记录

  -- 耗时 & 成本
  llm_latency_ms    INTEGER,                 -- DeepSeek API 调用耗时
  tokens_used       INTEGER,                 -- 本轮消耗 tokens

  -- 审计
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- 索引
  INDEX idx_ai_conv_user_id (user_id),
  INDEX idx_ai_conv_session_id (session_id),
  INDEX idx_ai_conv_created_at (created_at)
);
```

**设计说明**：
- `session_id` 标记同一次对话上下文，前端每次打开悬浮框时生成一个新的 session UUID。
- `turn_index` 支持多轮对话时向 DeepSeek 传递历史上下文（最多传递最近 5 轮）。
- `raw_data` 存查询原始结果（JSONB），便于事后审计 AI 回答是否有数据支撑。
- 该表不设 `deleted_at`（对话历史不需要软删除），保留 90 天后可定期归档。

### 3.2 迁移文件

文件名：`db/migrations/0004_add_ai_conversation.sql`

---

## 4. API 端点

### 4.1 POST /api/v1/ai/chat

**描述**：接收自然语言问题，返回 AI 回答。

**认证**：`AuthGuard`（JWT cookie，与现有全局 Guard 一致）。

**Request Body**：

```typescript
{
  question: string;        // 用户问题，1-500 字
  session_id: string;      // 前端会话 ID（UUID）
  source?: 'web';          // 来源标识（飞书机器人走内部路径，不需要此字段）
}
```

**Response**（标准信封）：

```typescript
{
  code: 0,
  message: "ok",
  trace_id: "tr_xxx",
  data: {
    answer: string;          // 自然语言回答
    intent: string;          // 识别的意图类型（调试用，前端可忽略）
    conversation_uid: string; // 本轮对话 UID
    // 以下字段仅 boss 角色可见（或 debug mode）
    raw_summary?: string;    // 数据摘要描述（非完整 raw_data）
  }
}
```

**错误码**（复用现有体系）：

| code | 场景 |
|------|------|
| 1001 | question 为空或超长 |
| 1002 | 角色无权访问（employee 不能使用此接口） |
| 1007（新增） | 意图无法识别，无法回答 |
| 1008（新增） | DeepSeek API 调用失败 |

**权限规则**：

| 角色 | 可用性 | 数据范围 |
|------|--------|---------|
| `employee` | 禁止（返回 1002） | — |
| `leader` | 允许 | 仅限 `leader_user_id = 当前用户` 或 `assignee_manager_user_id = 当前用户` 的任务 |
| `boss` | 允许 | 全公司所有任务 |
| `pmo` | 允许 | 全公司所有任务（同 boss） |
| `admin` | 允许 | 全公司所有任务（同 boss） |

权限注入实现：从 `req.user`（JWT payload）取 `role`，在 `AiService.chat()` 入口构建 `scopeFilter`：

```typescript
// 伪代码
const scopeFilter =
  role === 'boss' || role === 'pmo' || role === 'admin'
    ? {}  // 无限制
    : { leaderUserId: currentUserId };  // leader：只查自己管理的任务
```

### 4.2 GET /api/v1/ai/conversations

**描述**：查询当前用户的历史对话（按 session_id 分组，最近 20 条 session）。

**认证**：同上。

**Query Params**：`page=1&page_size=20`

此端点为可选（MVP 可暂不实现，前端本地 state 已足够）。

---

## 5. 意图识别设计

### 5.1 设计思路

采用**基于规则的关键词匹配 + 正则实体提取**，不依赖额外 NLP 服务。DeepSeek 用于回答生成，不用于意图识别（避免二次 LLM 调用增加延迟）。

### 5.2 意图类型定义

| 意图标识 | 自然语言示例 | 查询目标表 | 提取实体 |
|----------|------------|-----------|---------|
| `employee_tasks` | "XXX 最近在干什么" / "XXX 本月任务" | `task` | `employee_name` |
| `near_due_tasks` | "哪些任务快逾期了" / "3天内到期" | `task` | — |
| `project_progress` | "X 项目现在什么进度" | `task`, `project` | `project_name` |
| `completion_ranking` | "完成率最低的是谁" / "谁完成率最差" | `task` | `month?` |
| `employee_incidents` | "XXX 有没有出事故" / "XXX 事故记录" | `incident` | `employee_name`, `month?` |
| `task_overdue` | "谁有延期任务" / "哪些任务延期了" | `task` | `employee_name?` |
| `unknown` | 无法识别 | — | — |

### 5.3 意图识别流程

```typescript
// 伪代码 — IntentClassifier.classify(question: string, lang = 'zh')

const PATTERNS: IntentPattern[] = [
  {
    intent: 'employee_incidents',
    // 事故意图优先匹配（在 employee_tasks 之前），避免被通用任务意图覆盖
    patterns: [/出事故/, /事故记录/, /有没有事故/],
    extractors: { employee_name: extractPersonName, month: extractMonth },
  },
  {
    intent: 'near_due_tasks',
    patterns: [/快逾期/, /快到期/, /[123]天内/, /马上到期/],
    extractors: {},
  },
  {
    intent: 'project_progress',
    patterns: [/项目.*进度/, /进度.*项目/, /什么进度/],
    extractors: { project_name: extractProjectName },
  },
  {
    intent: 'completion_ranking',
    patterns: [/完成率.*最低/, /谁.*完成率/, /完成率排名/, /完成率最差/],
    extractors: { month: extractMonth },
  },
  {
    intent: 'task_overdue',
    patterns: [/延期任务/, /谁延期/, /哪些延期/],
    extractors: { employee_name: extractPersonName },
  },
  {
    intent: 'employee_tasks',
    // 通用兜底：包含人名则归入此类
    patterns: [/最近在干什么/, /本月任务/, /在做什么/, /任务列表/],
    extractors: { employee_name: extractPersonName },
  },
];

// 按顺序匹配，第一个命中的意图生效
// 若 patterns 均不命中，返回 { intent: 'unknown' }
```

### 5.4 实体提取策略

**`extractPersonName(question)`**：

1. 先从 `org_cache` 加载所有用户姓名（启动时缓存，TTL 5 分钟）。
2. 遍历用户名列表，在问题文本中做子字符串匹配（支持 2-4 字中文名）。
3. 返回匹配到的第一个姓名及对应的 `user_id`。
4. 找不到 → 实体为 `null`，后续 SQL 查询返回空集。

**`extractMonth(question)`**：

正则匹配 `本月 / YYYY年MM月 / N月 / 上月 / 上个月`，转换为 `month_bucket` 格式（`YYYY-MM`）。默认当月。

**`extractProjectName(question)`**：

从 `project` 表加载项目名称列表（启动时缓存），子字符串匹配。

### 5.5 数据查询逻辑（DataQueryEngine）

每种意图对应一个 Drizzle ORM 查询方法，统一注入 `scopeFilter`：

| 意图 | 查询逻辑 |
|------|---------|
| `employee_tasks` | `WHERE assignee_user_id = ? AND month_bucket = ? AND deleted_at IS NULL`，附加 scopeFilter |
| `near_due_tasks` | `WHERE days_to_due BETWEEN 0 AND 3 AND status NOT IN ('done','shelved','closed') AND deleted_at IS NULL`，附加 scopeFilter |
| `project_progress` | 按 `project_uid` 聚合：`COUNT(*) total, SUM(CASE status='done' THEN 1 END) done_count` |
| `completion_ranking` | 按 `assignee_user_id` 分组，计算完成率 = `done/total`，ORDER BY 完成率 ASC |
| `employee_incidents` | `WHERE assignee_user_id = ? AND created_at >= month_start AND created_at < month_end`（查 `incident` 表） |
| `task_overdue` | `WHERE is_overdue = true AND status NOT IN ('done','shelved','closed') AND deleted_at IS NULL` |

查询结果限制最多 50 条，防止 prompt 超长。

---

## 6. 系统 Prompt 设计

### 6.1 角色设定（System Prompt）

```
你是「督办助手」，一个企业内部任务管理系统的智能问答助手。

你的职责：
1. 根据用户的问题，结合系统提供的结构化数据，给出简洁、准确的自然语言回答。
2. 回答语气专业、简洁，适合企业管理场景。
3. 如果数据为空，明确说"暂无相关记录"，不要编造内容。
4. 不要透露你使用的是哪个 AI 模型，统一以"督办助手"自称。
5. 不要回答与任务管理、员工绩效、项目进度无关的问题，礼貌拒绝并告知范围。

任务状态说明：
- pending/not_started：未开始
- in_progress：进行中
- stalled：已停滞（需关注）
- done：已完成
- shelved：已搁置
- closed：已关闭

优先级说明：
- urgent_important：重要紧急（最高优先）
- important_not_urgent：重要不紧急
- urgent_not_important：紧急不重要
- not_urgent_not_important：不紧急不重要

回答格式要求：
- 简洁为主，通常 3-8 句话
- 如果数据条目多于 5 条，用列表格式展示，每条一行
- 对于进度/完成率，用百分比表示
- 对于日期，使用"X月X日"中文格式
```

### 6.2 用户消息构建（User Prompt 模板）

```
问题：{question}

相关数据（JSON）：
{JSON.stringify(raw_data, null, 2)}

请根据以上数据回答问题。数据范围：{scope_description}
```

其中 `scope_description`：
- boss/pmo/admin：`"全公司数据"`
- leader：`"您管理团队的数据（{leader_name} 的下属）"`

### 6.3 多轮对话上下文

最多携带最近 5 轮历史（当前 session 内），按如下格式追加到 messages 数组：

```typescript
const messages = [
  { role: 'system', content: SYSTEM_PROMPT },
  // 历史轮次（最近 5 轮）
  ...history.flatMap(turn => [
    { role: 'user',      content: `问题：${turn.question}` },
    { role: 'assistant', content: turn.answer },
  ]),
  // 当前问题
  { role: 'user', content: buildUserPrompt(question, rawData, scopeDesc) },
];
```

### 6.4 DeepSeek API 调用参数

```typescript
{
  model: 'deepseek-chat',
  messages,
  max_tokens: 800,      // 回答不超过约 600 字
  temperature: 0.3,     // 低温：事实性回答，减少幻觉
  stream: false,        // MVP 阶段不做流式
}
```

**API Endpoint**: `https://api.deepseek.com/chat/completions`

**认证**: `Authorization: Bearer ${DEEPSEEK_API_KEY}`（从环境变量读取）

---

## 7. 飞书机器人接入方案

### 7.1 整体思路

复用现有飞书自建应用（`督办系统`），新增"接收消息"事件订阅，在 `apps/worker` 中处理消息事件。

### 7.2 飞书后台配置（需手动操作）

1. **开启消息事件**：飞书开放平台 → 「督办系统」应用 → 事件与回调 → 添加事件：`im.message.receive_v1`（接收消息）。
2. **开启机器人能力**：应用能力 → 机器人 → 开启。
3. **权限申请**：`im:message:readonly`（读取消息）、`im:message`（发送消息）。
4. **回调地址**（与现有 webhook 共用服务器）：`https://www.harveywang.xyz/api/v1/feishu/webhook/bot-message`（新增路由）。

### 7.3 Worker 事件处理流程

```
飞书服务器 → POST /api/v1/feishu/webhook/bot-message
               │
               ▼
         BotMessageController（NestJS，apps/api）
               │
         1. 验证飞书签名（FEISHU_VERIFICATION_TOKEN / FEISHU_ENCRYPT_KEY）
         2. 过滤非 @机器人 消息（message_type = 'at'）
         3. 提取 sender.open_id + 消息文本
               │
               ▼
         4. 查询 org_cache 获取 user_id + role
         5. 若 role = employee → 回复"您暂无权限使用此功能"
         6. 若 role = leader/boss/pmo → 调用 AiService.chat()
               │
               ▼
         7. 通过飞书消息 API 发送文字回复
            POST https://open.feishu.cn/open-apis/im/v1/messages
            { receive_id: open_id, msg_type: 'text', content: answer }
```

### 7.4 飞书用户身份映射

飞书消息事件携带 `sender.sender_id.open_id`，通过 `org_cache.open_id` 字段查找对应的 `user_id` 和 `role`：

```sql
SELECT user_id, name, role
FROM org_cache
WHERE open_id = $1
  AND deleted_at IS NULL
LIMIT 1;
```

若找不到用户（org_cache 未同步）→ 回复"未找到您的账户信息，请联系管理员"，不返回任何数据。

### 7.5 飞书回复格式

纯文本消息，在回答前加一行标识：

```
[督办助手]

{answer}
```

MVP 阶段不做富文本/卡片，保持简单。后续可升级为飞书消息卡片（`interactive` 类型）展示表格数据。

### 7.6 防刷限制

在 Redis 中对每个 `open_id` 做速率限制：`60秒内最多 10 次请求`。超限回复"请求过于频繁，请稍后再试"。

---

## 8. 前端组件设计（悬浮对话框）

### 8.1 组件位置与文件路径

```
apps/web/src/components/
└── ai-chat-widget/
    ├── index.tsx           # 入口，全局注册悬浮按钮 + 对话框
    ├── chat-bubble.tsx     # 单条消息气泡（用户 / AI）
    ├── chat-input.tsx      # 输入框 + 发送按钮
    └── use-ai-chat.ts      # SWR mutation hook，封装 /ai/chat 调用
```

在 `apps/web/src/app/layout.tsx` 的 `<body>` 末尾注册：

```tsx
<AiChatWidget />   {/* 按权限显示，employee 不渲染 */}
```

### 8.2 交互状态

```
┌─────────────────────────────────────────────┐
│  折叠态（默认）                               │
│  右下角固定定位：圆形浮动按钮（机器人图标）     │
│  z-index: 50（不遮挡 Dialog/Modal）           │
└─────────────────────────────────────────────┘
           点击展开
┌─────────────────────────────────────────────┐
│  展开态                                       │
│  宽 360px，高 480px（移动端全屏）              │
│  ┌─ Header ──────────────────────────────┐  │
│  │ 督办助手  [最小化] [关闭]              │  │
│  └───────────────────────────────────────┘  │
│  ┌─ 消息列表（滚动区）─────────────────────┐  │
│  │  [用户气泡] 王五这个月在干什么          │  │
│  │       [AI气泡] 王五本月共有 6 项任务... │  │
│  │  [加载中...] ●●●                       │  │
│  └───────────────────────────────────────┘  │
│  ┌─ 输入区 ────────────────────────────────┐  │
│  │  [输入框]               [发送]           │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 8.3 组件行为规范

- **session 管理**：组件 mount 时生成 `session_id = crypto.randomUUID()`，整个会话周期内复用。关闭并重新打开时，弹窗内历史仍然显示（存 React state），但不新建 session（可继续对话）。刷新页面后 session 重置。
- **消息滚动**：每次新增消息后自动滚动到底部（`scrollIntoView`）。
- **加载态**：发送后输入框 disabled，显示"●●●"动画气泡，收到回答后恢复。
- **错误处理**：API 返回非 0 code 时，显示"抱歉，暂时无法回答，请稍后重试"的 AI 气泡，不阻断会话。
- **快捷问题**：首次打开时展示 4 个快捷问题按钮（点击即发送）：
  - "哪些任务快逾期了？"
  - "本月完成率最低的是谁？"
  - "本月哪些任务有风险？"
  - "重点任务现在什么情况？"
- **权限判断**：从 `/auth/me` 响应的 `role` 字段判断，`employee` 角色不渲染此组件。

### 8.4 SWR Hook 设计

```typescript
// use-ai-chat.ts 伪代码
function useAiChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async (question: string) => {
    // 1. 本地追加用户消息（optimistic）
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);

    try {
      // 2. 调用 API
      const data = await apiFetch<AiChatResponse>('/api/v1/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ question, session_id: sessionId }),
      });
      // 3. 追加 AI 回答
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '抱歉，暂时无法回答，请稍后重试。',
        isError: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return { messages, isLoading, sendMessage };
}
```

---

## 9. 隔离方案（不影响现有功能）

### 9.1 代码隔离

- 新建 `apps/api/src/modules/ai/` 目录，包含：
  - `ai.module.ts`
  - `ai.controller.ts`
  - `ai.service.ts`
  - `intent-classifier.ts`
  - `data-query-engine.ts`
  - `deepseek-client.ts`
- 在 `apps/api/src/app.module.ts` 中 `imports` 追加 `AiModule`，不修改其他模块。
- 飞书机器人消息处理新建 `apps/api/src/modules/feishu-bot/` 子模块（独立于现有 feishu 相关代码）。

### 9.2 数据库隔离

- 只新增 `ai_conversation` 表（migration `0004_add_ai_conversation.sql`），不修改任何现有表。
- 数据查询均为 `SELECT`，不执行任何 `INSERT/UPDATE/DELETE` 到核心业务表。

### 9.3 环境变量隔离

新增以下环境变量，现有变量不变：

```bash
# .env（追加）
DEEPSEEK_API_KEY=sk-01fea882aed14c5f9b698975ddeeba04
DEEPSEEK_BASE_URL=https://api.deepseek.com        # 可选，方便测试时 mock
AI_CONVERSATION_RETENTION_DAYS=90                 # 对话历史保留天数（预留）
```

### 9.4 路由隔离

新增路由：`/api/v1/ai/*`、`/api/v1/feishu/webhook/bot-message`。

与现有路由（`/tasks/*`、`/dashboard/*`、`/projects/*`、`/auth/*`）无重叠。

### 9.5 前端隔离

`AiChatWidget` 以独立树挂载，不修改任何现有页面组件。仅在 `layout.tsx` 末尾添加一行。

---

## 10. 待确认清单

以下问题需项目负责人逐条确认，**确认完毕后才能进入执行阶段**。

### P0（设计方向性）

1. **对话历史是否需要持久化？**
   - 方案 A：不持久化，前端 state 即可（MVP 简单，页面刷新即清空）
   - 方案 B：持久化到 `ai_conversation` 表（可审计、支持多轮上下文跨会话延续）
   - 当前文档按方案 B 设计，是否认可？

2. **飞书机器人入口是否在 MVP 就做？**
   - 飞书机器人涉及后台配置操作（需要飞书管理员权限）+ 新权限申请，周期较长。
   - 建议 MVP 先做 Web 悬浮框，飞书机器人作为第二阶段。是否同意？

3. **`employee` 角色是否完全禁用此功能？**
   - 当前方案：`employee` 无法使用（API 返回 1002，前端不渲染组件）。
   - 若需要员工查询自己的任务，权限规则需调整。请确认。

4. **`pmo` 角色是否有全公司数据权限？**
   - 文档将 `pmo` 与 `boss` 权限等同（全公司）。是否与实际业务一致？

### P1（实现细节）

5. **意图识别的兜底策略**：当 `intent = 'unknown'` 时，是直接返回"无法理解您的问题"，还是直接把原始问题传给 DeepSeek 让其自由回答？
   - 自由回答风险：DeepSeek 可能编造数据。建议返回固定文案，引导用户用具体问法。

6. **快逾期任务的"3天"是否可配置？**
   - 文档固定为 `days_to_due <= 3`，与现有 Dashboard `riskReasons.near_due` 逻辑一致。是否需要参数化？

7. **DeepSeek API Key 安全性**：Key 已在需求文档中明文出现，建议确认此 Key 是否已经轮换或为专用测试 Key，生产环境通过 `.env` 注入，不进入代码库。

8. **多轮上下文的轮数上限**：文档设为最近 5 轮，是否合适？轮数越多，每次请求的 token 消耗越高（影响成本）。

9. **飞书回复格式**：MVP 用纯文本还是消息卡片（interactive card）？卡片排版更好看但实现复杂度高 3-4 倍。

10. **`incident` 表是否已经存在？**
    - `employee_incidents` 意图需要查询 `incident` 表。此表由「事故记录模块」（另一 spec）新建。若事故模块未上线，此意图应返回"事故模块尚未启用"。请确认两个模块的上线顺序。

### P2（非阻塞，可后续决策）

11. **是否需要对话质量反馈**（用户可对每条回答点赞/踩）？

12. **是否需要管理后台查看所有人的对话记录**（Boss/PMO 审计用）？

13. **API 调用频率限制**：除飞书机器人的速率限制外，Web 端是否也需要？（建议：同一用户 60 秒内最多 20 次）

14. **DeepSeek 调用失败时的降级策略**：是否展示原始结构化数据（不经 AI 润色），还是直接报错？

---

*文档作者：AI 架构助手（Claude Sonnet 4.6）*
*项目：leader-sync（领导月度督办系统）*
*最后更新：2026-05-24*
