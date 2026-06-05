/**
 * IncidentFeishuService
 *
 * Thin Feishu notification wrapper for the incident module.
 * Uses the Feishu HTTP API directly (same pattern as FeishuAuthService).
 * Failures are logged as warnings and never surface to the API response.
 */
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class IncidentFeishuService {
  private readonly logger = new Logger(IncidentFeishuService.name);
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
      this.logger.warn('Failed to get Feishu app access token', (err as Error).message);
      return '';
    }
  }

  async sendTextToUser(openId: string, text: string): Promise<void> {
    try {
      const token = await this.getAppAccessToken();
      if (!token) return;
      const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
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
      });
      const data = (await res.json()) as { code: number; msg: string };
      if (data.code !== 0) {
        this.logger.warn(`Send message to ${openId} failed: ${data.msg}`);
      }
    } catch (err) {
      this.logger.warn(`sendTextToUser failed for ${openId}:`, (err as Error).message);
    }
  }

  /**
   * Notify all PMO users that a P0/P1 incident is pending confirmation.
   */
  async notifyPmoOfPendingIncident(
    pmoOpenIds: string[],
    incidentUid: string,
    title: string,
    reporterName: string,
    severity: string,
  ): Promise<void> {
    const msg = `[事故待确认] ${severity} - ${title}\n记录人: ${reporterName}\n事故ID: ${incidentUid}\n请前往系统确认或驳回。`;
    await Promise.allSettled(pmoOpenIds.map((id) => this.sendTextToUser(id, msg)));
  }

  /**
   * Notify all involved employees that a P0/P1 incident has been confirmed.
   */
  async notifyUsersIncidentConfirmed(
    involvedOpenIds: string[],
    incidentUid: string,
    title: string,
    severity: string,
  ): Promise<void> {
    const msg = `[事故记录已确认] ${severity} - ${title}\n事故ID: ${incidentUid}\n此事故记录已由 PMO/Boss 确认生效，请知悉。`;
    await Promise.allSettled(involvedOpenIds.map((id) => this.sendTextToUser(id, msg)));
  }
}
