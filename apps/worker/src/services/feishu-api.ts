import * as lark from '@larksuiteoapi/node-sdk';
import { config } from '../config';

// Single SDK client instance — handles token caching internally
const client = new lark.Client({
  appId: config.feishuAppId,
  appSecret: config.feishuAppSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

export class FeishuApi {
  /**
   * List all records from the configured Bitable table (auto-paginates)
   */
  async listBitableRecords(): Promise<any[]> {
    const all: any[] = [];
    let pageToken: string | undefined;

    do {
      const res = await client.bitable.appTableRecord.list({
        path: {
          app_token: config.bitableAppToken,
          table_id: config.bitableTableId,
        },
        params: {
          page_size: 100,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });

      const data = res?.data;
      if (!data) break;
      all.push(...(data.items || []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);

    return all;
  }

  /**
   * Update a single Bitable record
   */
  async updateBitableRecord(recordId: string, fields: Record<string, any>): Promise<void> {
    const res = await client.bitable.appTableRecord.update({
      path: {
        app_token: config.bitableAppToken,
        table_id: config.bitableTableId,
        record_id: recordId,
      },
      data: { fields },
    });

    if (res?.code !== 0) {
      throw new Error(`Update record error: ${res?.msg}`);
    }
  }

  /**
   * Batch create records in Bitable, returns record IDs
   */
  async createBitableRecords(records: { fields: Record<string, any> }[]): Promise<string[]> {
    const res = await client.bitable.appTableRecord.batchCreate({
      path: {
        app_token: config.bitableAppToken,
        table_id: config.bitableTableId,
      },
      data: { records },
    });

    if (res?.code !== 0) {
      throw new Error(`Batch create error: ${res?.msg}`);
    }

    return (res?.data?.records || []).map((r: any) => r.record_id);
  }

  /**
   * Send an interactive card message to a user
   */
  async sendCardMessage(userId: string, card: object): Promise<void> {
    try {
      await client.im.message.create({
        params: {
          receive_id_type: 'open_id',
        },
        data: {
          receive_id: userId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
    } catch (err) {
      console.warn(`Send message to ${userId} failed:`, (err as Error).message);
    }
  }
}

export const feishuApi = new FeishuApi();

// Export client for direct use in scripts
export { client as feishuClient };
