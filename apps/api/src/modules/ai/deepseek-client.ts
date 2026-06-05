/**
 * deepseek-client.ts
 *
 * 封装 DeepSeek Chat API 调用。
 * 通过 fetch 直接调用，不依赖额外 SDK。
 *
 * API 文档：https://api.deepseek.com/chat/completions
 * 认证：Authorization: Bearer ${DEEPSEEK_API_KEY}
 */

import { Injectable, Logger } from '@nestjs/common';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekChatOptions {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface DeepSeekChatResult {
  answer: string;
  tokens_used: number;
}

@Injectable()
export class DeepSeekClient {
  private readonly logger = new Logger(DeepSeekClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY ?? '';
    this.baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not set — AI chat will fail at runtime');
    }
  }

  async chat(options: DeepSeekChatOptions): Promise<DeepSeekChatResult> {
    const { messages, max_tokens = 800, temperature = 0.3 } = options;

    const requestBody = {
      model: 'deepseek-chat',
      messages,
      max_tokens,
      temperature,
      stream: false,
    };

    let response: Response;
    const startTime = Date.now();

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      this.logger.error('DeepSeek API network error', err);
      throw err;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.error(
        `DeepSeek API error: ${response.status} ${response.statusText} ${errorText}`,
      );
      throw new Error(
        `DeepSeek API returned ${response.status}: ${response.statusText}`,
      );
    }

    const latencyMs = Date.now() - startTime;

    let json: {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens?: number };
    };

    try {
      json = await response.json() as typeof json;
    } catch (err) {
      this.logger.error('DeepSeek API returned invalid JSON', err);
      throw new Error('DeepSeek API returned invalid JSON');
    }

    const answer = json.choices?.[0]?.message?.content ?? '';
    const tokensUsed = json.usage?.total_tokens ?? 0;

    this.logger.debug(
      `DeepSeek chat: ${latencyMs}ms, ${tokensUsed} tokens, intent answered`,
    );

    return { answer, tokens_used: tokensUsed };
  }
}
