/**
 * FeishuMessengerService
 *
 * 单一的飞书消息下发底座：app_access_token 获取/缓存 + 文本消息发送（receive_id_type=open_id）。
 * 由 incident / requirement 等模块复用，避免各自重复一份 token+send 逻辑。
 * 失败仅告警，返回 boolean 表示是否送达，绝不抛出。
 */
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class FeishuMessengerService {
  private readonly logger = new Logger(FeishuMessengerService.name);
  private appAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  private get appId(): string {
    return process.env.FEISHU_APP_ID ?? '';
  }
  private get appSecret(): string {
    return process.env.FEISHU_APP_SECRET ?? '';
  }

  private async getAppAccessToken(): Promise<string> {
    if (this.appAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.appAccessToken;
    }
    try {
      const res = await fetch(
        'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
        },
      );
      const data = (await res.json()) as { code: number; app_access_token: string; expire: number };
      if (data.code !== 0) throw new Error('token fetch failed');
      this.appAccessToken = data.app_access_token;
      this.tokenExpiresAt = Date.now() + (data.expire - 300) * 1000;
      return this.appAccessToken!;
    } catch (err) {
      this.logger.warn('Failed to get Feishu app access token: ' + (err as Error).message);
      return '';
    }
  }

  /** 发送文本消息到某用户（open_id）。返回是否送达。 */
  async sendTextToUser(openId: string, text: string): Promise<boolean> {
    try {
      const token = await this.getAppAccessToken();
      if (!token) return false;
      const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      });
      const data = (await res.json()) as { code: number; msg: string };
      if (data.code !== 0) {
        this.logger.warn(`Send to ${openId} failed: ${data.msg}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`sendTextToUser failed for ${openId}: ` + (err as Error).message);
      return false;
    }
  }
}
