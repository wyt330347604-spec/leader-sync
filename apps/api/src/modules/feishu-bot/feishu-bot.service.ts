/**
 * feishu-bot.service.ts
 *
 * 飞书机器人消息处理核心逻辑：
 *   1. 通过 open_id 查 org_cache 获取 user_id 和 role
 *   2. 权限检查（employee 拒绝）
 *   3. 调用 AiService.chat() 查询数据 + DeepSeek 生成回答
 *   4. 通过飞书消息 API 发送文字回复
 *
 * 设计原则：
 *   - 不直接操作 task/incident 等核心表，复用 AiService 的完整逻辑
 *   - 回复格式：纯文本（MVP），以 "[督办助手]" 标识起头
 *   - 防刷：基于内存 Map 实现速率限制（60秒内最多 10 次）
 */

import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { AiRepository } from '../ai/ai.repository';

// Roles that are allowed to use AI assistant
const ALLOWED_ROLES = new Set(['leader', 'boss', 'pmo', 'admin']);

// Rate limiting: per open_id, max 10 requests per 60s
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

@Injectable()
export class FeishuBotService {
  private readonly logger = new Logger(FeishuBotService.name);
  private readonly rateMap = new Map<string, RateLimitEntry>();
  private readonly appId: string;
  private readonly appSecret: string;
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly aiService: AiService,
    private readonly aiRepository: AiRepository,
  ) {
    this.appId = process.env.FEISHU_APP_ID ?? '';
    this.appSecret = process.env.FEISHU_APP_SECRET ?? '';
  }

  async handleIncomingMessage(openId: string, rawContent: string): Promise<void> {
    // 1. Rate limiting
    if (!this.checkRateLimit(openId)) {
      await this.sendTextReply(openId, '请求过于频繁，请稍后再试。');
      return;
    }

    // 2. Extract text from content (飞书消息内容是 JSON 字符串)
    const question = this.extractTextFromContent(rawContent);
    if (!question.trim()) {
      return; // ignore empty messages
    }

    // 3. Look up user from org_cache via open_id
    const user = await this.findUserByOpenId(openId);
    if (!user) {
      await this.sendTextReply(
        openId,
        '[督办助手]\n\n未找到您的账户信息，请联系管理员同步组织架构。',
      );
      return;
    }

    // 4. Permission check
    if (!ALLOWED_ROLES.has(user.role)) {
      await this.sendTextReply(openId, '[督办助手]\n\n您暂无权限使用此功能。');
      return;
    }

    // 5. Call AiService
    let answer: string;
    try {
      const result = await this.aiService.chat({
        question,
        sessionId: `feishu_${openId}`,
        userId: user.userId,
        userName: user.userName,
        role: user.role,
        source: 'feishu_bot',
        feishuOpenId: openId,
      });
      answer = result.answer;
    } catch (err) {
      this.logger.error('AiService.chat failed in feishu-bot', err);
      answer = 'AI 服务暂时不可用，请稍后重试。';
    }

    // 6. Send reply
    await this.sendTextReply(openId, `[督办助手]\n\n${answer}`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private checkRateLimit(openId: string): boolean {
    const now = Date.now();
    const entry = this.rateMap.get(openId);

    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      this.rateMap.set(openId, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      return false;
    }

    // Immutable update
    this.rateMap.set(openId, { ...entry, count: entry.count + 1 });
    return true;
  }

  private extractTextFromContent(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      // 去除 @ 提及部分（飞书 @机器人 时 text 包含 @_user_1 等前缀）
      return (parsed.text ?? '').replace(/@[^\s]+/g, '').trim();
    } catch {
      return raw.trim();
    }
  }

  private async findUserByOpenId(openId: string): Promise<{
    userId: string;
    userName: string;
    role: string;
  } | null> {
    const users = await this.aiRepository.getAllUsers();
    const match = users.find(
      (u) => (u as unknown as { openId?: string }).openId === openId,
    );
    if (!match) return null;

    // Fetch role from user_role_binding via raw SQL (AiRepository only exposes users without role)
    // Use a simple approach: query org_cache + user_role_binding
    try {
      const result = await this.findUserRoleByUserId(match.userId);
      return {
        userId: match.userId,
        userName: match.userName,
        role: result ?? 'employee',
      };
    } catch {
      return { userId: match.userId, userName: match.userName, role: 'employee' };
    }
  }

  private async findUserRoleByUserId(userId: string): Promise<string | null> {
    // Use AiRepository's raw DB access indirectly via getAllUsers
    // In a real implementation, AiRepository.getUserRole() would be cleaner
    // For MVP: org_cache does not store role; roles live in user_role_binding table
    // We'll call through the existing org_cache approach used in the auth module
    const db = (this.aiRepository as unknown as { db: { execute: (q: unknown) => Promise<{ rows: Array<{ role: string }> }> } }).db;
    if (!db) return null;

    // Import sql at call site to avoid module-level import issues
    const { sql } = await import('drizzle-orm');
    const rows = await db.execute(sql`
      SELECT role FROM user_role_binding
      WHERE user_id = ${userId}
      ORDER BY id DESC
      LIMIT 1
    `);
    return rows.rows[0]?.role ?? null;
  }

  private async sendTextReply(openId: string, text: string): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this.logger.warn('Feishu app credentials not configured, skipping reply');
      return;
    }

    try {
      const token = await this.getTenantAccessToken();

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
        this.logger.warn(`Feishu send message failed: ${res.status} ${errText}`);
      }
    } catch (err) {
      this.logger.error('sendTextReply failed', err);
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tenantAccessToken && now < this.tokenExpiresAt - 60_000) {
      return this.tenantAccessToken;
    }

    const res = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );

    const json = await res.json() as {
      tenant_access_token: string;
      expire: number;
      code: number;
    };

    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`Failed to get tenant_access_token: ${JSON.stringify(json)}`);
    }

    this.tenantAccessToken = json.tenant_access_token;
    this.tokenExpiresAt = now + json.expire * 1000;
    return this.tenantAccessToken;
  }
}
