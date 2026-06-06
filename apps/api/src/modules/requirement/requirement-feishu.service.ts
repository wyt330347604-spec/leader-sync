/**
 * RequirementFeishuService
 *
 * 需求轴的飞书下发封装（与 IncidentFeishuService 同模式：直连飞书 HTTP API）。
 * 用于 R3 P0/变更需求的影响通知。失败仅告警，绝不冒泡到 API 响应。
 */
import { Injectable, Logger } from '@nestjs/common';

export interface P0NotifyInfo {
  requirementUid: string;
  title: string;
  expectedReleaseDate: string | null;
  peopleCount: number;
  taskCount: number;
  overloadedCount: number;
  /** 'create' = 新提 P0；'change' = 变更（升级 P0 / 改期）。 */
  kind: 'create' | 'change';
}

@Injectable()
export class RequirementFeishuService {
  private readonly logger = new Logger(RequirementFeishuService.name);
  private appAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  private get appId(): string {
    return process.env.FEISHU_APP_ID ?? '';
  }
  private get appSecret(): string {
    return process.env.FEISHU_APP_SECRET ?? '';
  }
  /** 站点根，用于消息里拼需求详情链接。 */
  private get webBase(): string {
    return process.env.WEB_BASE_URL ?? process.env.PUBLIC_WEB_URL ?? 'https://www.harveywang.xyz';
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

  /**
   * P0/变更 影响通知：下发给受影响负责人 + 项目 PIC。
   * 口径：只通知与提示「请确认排期影响」，不代为改期（人工确认）。
   * 返回成功条数。
   */
  async notifyP0Impact(openIds: readonly string[], info: P0NotifyInfo): Promise<number> {
    const ids = Array.from(new Set(openIds.filter(Boolean)));
    if (ids.length === 0) return 0;
    const head = info.kind === 'change' ? '【P0 需求·变更影响】' : '【P0 需求·影响评估】';
    const overloadLine = info.overloadedCount > 0 ? `（其中 ${info.overloadedCount} 人将过载）` : '';
    const text =
      `${head}${info.title}\n` +
      `期望上线：${info.expectedReleaseDate ?? '未定'}\n` +
      `受影响：${info.peopleCount} 人 / ${info.taskCount} 个在飞任务可能顺延${overloadLine}\n` +
      `系统不会自动改期，请前往确认排期影响：\n${this.webBase}/requirements/${info.requirementUid}`;
    const results = await Promise.allSettled(ids.map((id) => this.sendTextToUser(id, text)));
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    this.logger.log(`notifyP0Impact ${info.requirementUid}: ${ok}/${ids.length} delivered`);
    return ok;
  }
}
