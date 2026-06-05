/**
 * feishu-bot.ts
 *
 * 飞书机器人消息处理器（Worker 端）。
 *
 * 职责：
 *   - 提供 handleFeishuBotMessage() 函数，供 Feishu 事件回调或 HTTP 服务调用。
 *   - 通过 org_cache 查询发消息用户的 user_id 和 role。
 *   - 调用 API 内部端点（POST /api/v1/ai/chat）获取 AI 回答。
 *   - 通过飞书消息 API 回复结果。
 *
 * 注意：此文件不注册为 cron job，仅作为消息处理器函数导出。
 * 由 main.ts 在启动时注册为 HTTP 事件监听（如需要）或由 feishu webhook 调用。
 *
 * 生产部署方式：
 *   飞书后台配置回调地址为 API 服务的 /api/v1/feishu/webhook/bot-message，
 *   由 NestJS API 模块直接处理（apps/api/src/modules/feishu-bot/）。
 *   此 Worker 端文件作为独立调用路径的备用方案。
 */

import { createDb } from '@leader-sync/db';
import { orgCache } from '@leader-sync/db';
import { eq, isNull } from 'drizzle-orm';
import { config } from '../config';

const db = createDb(config.databaseUrl);

// Roles allowed to use AI assistant
const ALLOWED_ROLES = new Set(['leader', 'boss', 'pmo', 'admin']);

// Rate limiting: per open_id, max 10 requests per 60s
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(openId: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(openId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateMap.set(openId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  rateMap.set(openId, { ...entry, count: entry.count + 1 });
  return true;
}

function extractTextFromContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return (parsed.text ?? '').replace(/@[^\s]+/g, '').trim();
  } catch {
    return raw.trim();
  }
}

async function getTenantAccessToken(): Promise<string> {
  const res = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: config.feishuAppId,
        app_secret: config.feishuAppSecret,
      }),
    },
  );

  const json = await res.json() as { tenant_access_token: string; code: number };
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error('Failed to get tenant_access_token');
  }
  return json.tenant_access_token;
}

async function sendTextReply(openId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken();

  const res = await fetch(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(`[feishu-bot] Send reply failed: ${res.status} ${errText}`);
  }
}

async function findUserByOpenId(openId: string): Promise<{
  userId: string;
  userName: string;
} | null> {
  const [user] = await db
    .select({ userId: orgCache.userId, userName: orgCache.userName })
    .from(orgCache)
    .where(eq(orgCache.openId, openId))
    .limit(1);

  if (!user) return null;
  return { userId: user.userId, userName: user.userName ?? user.userId };
}

async function findUserRole(userId: string): Promise<string> {
  // Query user_role_binding table for the user's assigned role
  // Using raw SQL to avoid importing the schema directly
  const { sql } = await import('drizzle-orm');
  const result = await db.execute<{ role: string }>(sql`
    SELECT role FROM user_role_binding
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT 1
  `);
  return result.rows[0]?.role ?? 'employee';
}

/**
 * Main entry point: handle an incoming @-mention message from Feishu.
 *
 * @param openId - The sender's Feishu open_id
 * @param rawContent - Raw JSON string content from the Feishu message event
 * @param apiBaseUrl - Base URL of the leader-sync API (e.g. http://localhost:3001)
 * @param internalToken - A service-to-service JWT for calling /ai/chat internally
 */
export async function handleFeishuBotMessage(
  openId: string,
  rawContent: string,
  apiBaseUrl: string,
  internalToken: string,
): Promise<void> {
  // 1. Rate limit
  if (!checkRateLimit(openId)) {
    await sendTextReply(openId, '[督办助手]\n\n请求过于频繁，请稍后再试。');
    return;
  }

  // 2. Extract text
  const question = extractTextFromContent(rawContent);
  if (!question) return;

  // 3. Find user
  const user = await findUserByOpenId(openId);
  if (!user) {
    await sendTextReply(openId, '[督办助手]\n\n未找到您的账户信息，请联系管理员同步组织架构。');
    return;
  }

  // 4. Check role
  const role = await findUserRole(user.userId);
  if (!ALLOWED_ROLES.has(role)) {
    await sendTextReply(openId, '[督办助手]\n\n您暂无权限使用此功能。');
    return;
  }

  // 5. Call API /ai/chat (internal HTTP)
  let answer = 'AI 服务暂时不可用，请稍后重试。';
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `token=${internalToken}`,
      },
      body: JSON.stringify({
        question,
        session_id: `feishu_${openId}`,
        source: 'web',
      }),
    });

    if (res.ok) {
      const json = await res.json() as { code: number; data: { answer: string } };
      if (json.code === 0) {
        answer = json.data.answer;
      }
    }
  } catch (err) {
    console.error('[feishu-bot] Failed to call /ai/chat:', (err as Error).message);
  }

  // 6. Reply
  await sendTextReply(openId, `[督办助手]\n\n${answer}`);
}
