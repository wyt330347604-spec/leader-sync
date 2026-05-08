import 'dotenv/config';
import * as lark from '@larksuiteoapi/node-sdk';
import { config } from './config';

const client = new lark.Client({
  appId: config.feishuAppId,
  appSecret: config.feishuAppSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const TARGET = '王永涛';
const TABLE_ID = 'tbluUoYhIp3t3DGB';

async function main() {
  const all: any[] = [];
  let pt: string | undefined;
  do {
    const res = await client.bitable.appTableRecord.list({
      path: { app_token: config.bitableAppToken, table_id: TABLE_ID },
      params: { page_size: 100, ...(pt ? { page_token: pt } : {}) },
    });
    const d = res?.data;
    if (!d) break;
    all.push(...(d.items || []));
    pt = d.has_more ? d.page_token : undefined;
  } while (pt);

  console.log(`Total records in April table: ${all.length}`);

  // Find records for target person
  const matched = all.filter((r) => {
    const a = r.fields['任务负责人'];
    if (!Array.isArray(a)) return false;
    return a.some((p: any) => (p.name || '').includes(TARGET));
  });

  console.log(`\n${TARGET} records: ${matched.length}`);
  for (const r of matched) {
    const f = r.fields;
    const title = Array.isArray(f['待办事项'])
      ? f['待办事项'].map((v: any) => v?.text || '').join('')
      : f['待办事项'] || '';
    const name = f['任务负责人']?.[0]?.name || '';
    console.log(`  - [${name}] ${title.trim().substring(0, 60)}`);
  }

  // Also list all unique person names
  const names = new Set<string>();
  for (const r of all) {
    const a = r.fields['任务负责人'];
    if (Array.isArray(a)) a.forEach((p: any) => { if (p.name) names.add(p.name); });
  }
  console.log(`\nAll persons in April table (${names.size}):`);
  [...names].sort().forEach((n) => console.log(`  ${n}`));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
