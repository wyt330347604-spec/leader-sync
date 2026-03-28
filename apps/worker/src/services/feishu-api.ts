import { config } from '../config';

export class FeishuApi {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
    });
    const d = await res.json() as any;
    if (d.code !== 0) throw new Error(`Token error: ${d.msg}`);
    this.token = d.app_access_token;
    this.tokenExpiresAt = Date.now() + (d.expire - 300) * 1000;
    return this.token!;
  }

  async listBitableRecords(): Promise<any[]> {
    const token = await this.getToken();
    const all: any[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.bitableAppToken}/tables/${config.bitableTableId}/records`);
      url.searchParams.set('page_size', '100');
      if (pageToken) url.searchParams.set('page_token', pageToken);
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json() as any;
      if (d.code !== 0) throw new Error(`List records error: ${d.msg}`);
      all.push(...(d.data.items || []));
      pageToken = d.data.has_more ? d.data.page_token : undefined;
    } while (pageToken);
    return all;
  }

  async updateBitableRecord(recordId: string, fields: Record<string, any>): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.bitableAppToken}/tables/${config.bitableTableId}/records/${recordId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }
    );
    const d = await res.json() as any;
    if (d.code !== 0) throw new Error(`Update record error: ${d.msg}`);
  }

  async createBitableRecords(records: { fields: Record<string, any> }[]): Promise<string[]> {
    const token = await this.getToken();
    const res = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.bitableAppToken}/tables/${config.bitableTableId}/records/batch_create`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      }
    );
    const d = await res.json() as any;
    if (d.code !== 0) throw new Error(`Batch create error: ${d.msg}`);
    return (d.data.records || []).map((r: any) => r.record_id);
  }

  async sendCardMessage(userId: string, card: object): Promise<void> {
    const token = await this.getToken();
    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=user_id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: userId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    });
    const d = await res.json() as any;
    if (d.code !== 0) {
      console.warn(`Send message to ${userId} failed: ${d.msg}`);
    }
  }
}

export const feishuApi = new FeishuApi();
