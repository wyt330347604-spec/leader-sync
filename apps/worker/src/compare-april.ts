/**
 * Compare April data between 督办子表格 (main table) and DB.
 * Outputs per-person task count comparison.
 */
import 'dotenv/config';
import * as lark from '@larksuiteoapi/node-sdk';
import { config } from './config';
import { createDb, task } from '@leader-sync/db';
import { eq, and, sql } from 'drizzle-orm';

const MONTH_BUCKET = '2026-04';

const client = new lark.Client({
  appId: config.feishuAppId,
  appSecret: config.feishuAppSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const db = createDb(process.env.DATABASE_URL!);

function extractText(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map((v: any) => v?.text || '').join('');
  if (val?.text) return val.text;
  return '';
}

async function readBitableRecords(tableId: string): Promise<any[]> {
  const all: any[] = [];
  let pt: string | undefined;
  do {
    const res = await client.bitable.appTableRecord.list({
      path: { app_token: config.bitableAppToken, table_id: tableId },
      params: { page_size: 100, ...(pt ? { page_token: pt } : {}) },
    });
    const d = res?.data;
    if (!d) break;
    all.push(...(d.items || []));
    pt = d.has_more ? d.page_token : undefined;
  } while (pt);
  return all;
}

async function main() {
  // 1. Read 督办子表格 (main table) — filter by 归属月份 = 2026-04
  console.log('Reading 督办子表格 (main table)...');
  const mainRecords = await readBitableRecords(config.bitableTableId);
  const aprilBitable = mainRecords.filter((r) => {
    const bucket = r.fields['归属月份'];
    return bucket === MONTH_BUCKET || bucket === '2026-04';
  });
  console.log(`  Total records in main table: ${mainRecords.length}`);
  console.log(`  April (归属月份=2026-04) records: ${aprilBitable.length}`);

  // Per-person count from Bitable
  const bitableByPerson = new Map<string, { count: number; titles: string[] }>();
  for (const r of aprilBitable) {
    const assignee = Array.isArray(r.fields['任务负责人']) && r.fields['任务负责人'][0]?.name
      ? r.fields['任务负责人'][0].name.trim()
      : '(未分配)';
    const title = extractText(r.fields['待办事项']).trim() || '(空标题)';
    const prev = bitableByPerson.get(assignee) ?? { count: 0, titles: [] };
    bitableByPerson.set(assignee, { count: prev.count + 1, titles: [...prev.titles, title] });
  }

  // 2. Read DB
  console.log('\nReading DB...');
  const dbTasks = await db
    .select()
    .from(task)
    .where(and(eq(task.monthBucket, MONTH_BUCKET), sql`${task.deletedAt} IS NULL`));
  console.log(`  DB 2026-04 active tasks: ${dbTasks.length}`);

  // Per-person count from DB
  const dbByPerson = new Map<string, { count: number; titles: string[] }>();
  for (const t of dbTasks) {
    const name = t.assigneeName || '(未分配)';
    const prev = dbByPerson.get(name) ?? { count: 0, titles: [] };
    dbByPerson.set(name, { count: prev.count + 1, titles: [...prev.titles, t.title] });
  }

  // 3. Compare
  const allPersons = new Set([...bitableByPerson.keys(), ...dbByPerson.keys()]);
  const sortedPersons = [...allPersons].sort();

  console.log('\n=== PER-PERSON COMPARISON ===\n');
  console.log(`${'姓名'.padEnd(18)} ${'多维表格'.padStart(8)} ${'系统DB'.padStart(8)}  差异`);
  console.log('-'.repeat(60));

  let totalBitable = 0;
  let totalDb = 0;
  let mismatchCount = 0;

  for (const name of sortedPersons) {
    const bCount = bitableByPerson.get(name)?.count ?? 0;
    const dCount = dbByPerson.get(name)?.count ?? 0;
    totalBitable += bCount;
    totalDb += dCount;
    const diff = dCount - bCount;
    const marker = diff === 0 ? '  ✓' : `  ✗ ${diff > 0 ? '+' : ''}${diff}`;
    if (diff !== 0) mismatchCount++;
    console.log(`${name.padEnd(18)} ${String(bCount).padStart(8)} ${String(dCount).padStart(8)} ${marker}`);
  }

  console.log('-'.repeat(60));
  console.log(`${'合计'.padEnd(18)} ${String(totalBitable).padStart(8)} ${String(totalDb).padStart(8)}  ${totalDb === totalBitable ? '✓' : '✗ ' + (totalDb - totalBitable)}`);

  console.log(`\n不一致人数: ${mismatchCount}`);

  // 4. For mismatched persons, show detail
  if (mismatchCount > 0) {
    console.log('\n=== MISMATCH DETAILS ===\n');
    for (const name of sortedPersons) {
      const bData = bitableByPerson.get(name);
      const dData = dbByPerson.get(name);
      const bCount = bData?.count ?? 0;
      const dCount = dData?.count ?? 0;
      if (bCount === dCount) continue;

      console.log(`【${name}】多维表格 ${bCount} vs 系统 ${dCount}`);

      const bTitles = new Set(bData?.titles ?? []);
      const dTitles = new Set(dData?.titles ?? []);

      // In Bitable but not DB
      for (const t of bTitles) {
        if (!dTitles.has(t)) console.log(`  多维表格有，系统无: ${t.substring(0, 50)}`);
      }
      // In DB but not Bitable
      for (const t of dTitles) {
        if (!bTitles.has(t)) console.log(`  系统有，多维表格无: ${t.substring(0, 50)}`);
      }
      console.log();
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
