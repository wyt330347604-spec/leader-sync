import 'dotenv/config';
import { config } from './config';
import * as lark from '@larksuiteoapi/node-sdk';

const client = new lark.Client({
  appId: config.feishuAppId,
  appSecret: config.feishuAppSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

async function main() {
  const res = await client.bitable.appTableField.list({
    path: { app_token: config.bitableAppToken, table_id: config.bitableTableId },
    params: { page_size: 100 },
  });

  console.log('督办子表格字段列表:');
  for (const f of res?.data?.items || []) {
    console.log(`  ${f.field_name} (${f.type})`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
