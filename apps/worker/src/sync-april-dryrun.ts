/**
 * Dry-run script: compare April Bitable sub-table with DB 2026-04 tasks.
 *
 * Usage: cd /opt/leader-sync && npx tsx db/scripts/sync-april-dryrun.ts
 *
 * Steps:
 * 1. Backup DB 2026-04 tasks to JSON
 * 2. Read April sub-table from Bitable
 * 3. Print field comparison (schema check)
 * 4. Print diff report: create / soft-delete / update / skip(duplicates)
 */
import 'dotenv/config';
import * as lark from '@larksuiteoapi/node-sdk';
import { eq, and, sql } from 'drizzle-orm';
import { createDb, task } from '@leader-sync/db';
import { writeFileSync } from 'node:fs';
import { bitableToTaskFields } from './services/sync-engine';

/* ---------- Config ---------- */

const APRIL_TABLE_ID = 'tbluUoYhIp3t3DGB';
const MONTH_BUCKET = '2026-04';
const BACKUP_FILE = `/tmp/db-backup-${MONTH_BUCKET}-${Date.now()}.json`;

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID!,
  appSecret: process.env.FEISHU_APP_SECRET!,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const db = createDb(process.env.DATABASE_URL!);

/* ---------- Helpers ---------- */

function extractText(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map((v: any) => v?.text || '').join('');
  if (val?.text) return val.text;
  return '';
}

function getMatchKey(title: string, assigneeName: string): string {
  return `${(title || '').trim()}||${(assigneeName || '').trim()}`;
}

/* ---------- Step 1: Read April sub-table ---------- */

async function readAprilTable(): Promise<any[]> {
  const all: any[] = [];
  let pageToken: string | undefined;

  do {
    const res = await client.bitable.appTableRecord.list({
      path: {
        app_token: process.env.BITABLE_APP_TOKEN!,
        table_id: APRIL_TABLE_ID,
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

/* ---------- Step 2: Read DB ---------- */

async function readDbTasks() {
  return db
    .select()
    .from(task)
    .where(and(eq(task.monthBucket, MONTH_BUCKET), sql`${task.deletedAt} IS NULL`));
}

/* ---------- Main ---------- */

async function main() {
  console.log('=== April Sync Dry-Run ===\n');

  // 1. Read DB and backup
  console.log('Step 1: Reading DB 2026-04 tasks...');
  const dbTasks = await readDbTasks();
  console.log(`  Found ${dbTasks.length} tasks in DB for ${MONTH_BUCKET}`);

  writeFileSync(BACKUP_FILE, JSON.stringify(dbTasks, null, 2), 'utf-8');
  console.log(`  Backup saved to ${BACKUP_FILE}\n`);

  // 2. Read April sub-table
  console.log('Step 2: Reading April sub-table from Bitable...');
  const aprilRecords = await readAprilTable();
  console.log(`  Found ${aprilRecords.length} records in April sub-table\n`);

  // 3. Schema comparison
  if (aprilRecords.length > 0) {
    const sampleFields = Object.keys(aprilRecords[0].fields || {});
    console.log('Step 3: Field names in April sub-table:');
    sampleFields.forEach((f) => console.log(`  - ${f}`));
    console.log();
  }

  // 4. Parse April records
  const aprilParsed: { recordId: string; title: string; assigneeName: string; fields: any; raw: any }[] = [];
  for (const record of aprilRecords) {
    const f = record.fields;
    const title = extractText(f['待办事项']).trim();
    const assignee = Array.isArray(f['任务负责人']) && f['任务负责人'][0]?.name
      ? f['任务负责人'][0].name.trim()
      : '';

    if (!title) {
      console.log(`  WARN: Skipping record ${record.record_id} with empty title`);
      continue;
    }

    aprilParsed.push({
      recordId: record.record_id,
      title,
      assigneeName: assignee,
      fields: bitableToTaskFields(record),
      raw: f,
    });
  }

  // 5. Check for duplicates in April sub-table
  console.log('Step 4: Checking for duplicates...');
  const aprilByKey = new Map<string, typeof aprilParsed>();
  for (const rec of aprilParsed) {
    const key = getMatchKey(rec.title, rec.assigneeName);
    const existing = aprilByKey.get(key) ?? [];
    aprilByKey.set(key, [...existing, rec]);
  }

  const aprilDuplicates: string[] = [];
  const aprilDeduped = new Map<string, (typeof aprilParsed)[0]>();
  for (const [key, recs] of aprilByKey) {
    if (recs.length > 1) {
      aprilDuplicates.push(`  DUP in Bitable: "${key}" (${recs.length} records, keeping first, deleting rest)`);
    }
    aprilDeduped.set(key, recs[0]);
  }

  // Check duplicates in DB
  const dbByKey = new Map<string, (typeof dbTasks)>();
  for (const t of dbTasks) {
    const key = getMatchKey(t.title, t.assigneeName);
    const existing = dbByKey.get(key) ?? [];
    dbByKey.set(key, [...existing, t]);
  }

  const dbDuplicates: string[] = [];
  const dbDeduped = new Map<string, (typeof dbTasks)[0]>();
  for (const [key, tasks] of dbByKey) {
    if (tasks.length > 1) {
      dbDuplicates.push(`  DUP in DB: "${key}" (${tasks.length} records, keeping latest)`);
      // Keep latest by updatedAt
      const sorted = [...tasks].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      dbDeduped.set(key, sorted[0]);
    } else {
      dbDeduped.set(key, tasks[0]);
    }
  }

  if (aprilDuplicates.length > 0 || dbDuplicates.length > 0) {
    console.log('  Duplicates found:');
    aprilDuplicates.forEach((d) => console.log(d));
    dbDuplicates.forEach((d) => console.log(d));
  } else {
    console.log('  No duplicates found');
  }
  console.log();

  // 6. Compute diff
  console.log('Step 5: Computing diff...\n');

  const toCreate: { key: string; aprilRec: (typeof aprilParsed)[0] }[] = [];
  const toUpdate: { key: string; aprilRec: (typeof aprilParsed)[0]; dbTask: (typeof dbTasks)[0]; changes: string[] }[] = [];
  const toSoftDelete: { key: string; dbTask: (typeof dbTasks)[0] }[] = [];
  const unchanged: string[] = [];

  // A. Tasks in April but not in DB → create
  for (const [key, aprilRec] of aprilDeduped) {
    const dbTask = dbDeduped.get(key);
    if (!dbTask) {
      toCreate.push({ key, aprilRec });
    } else {
      // C. Both exist → compare fields
      const fields = aprilRec.fields;
      const changes: string[] = [];

      if (fields.title && fields.title !== dbTask.title) changes.push(`title: "${dbTask.title}" → "${fields.title}"`);
      if (fields.status && fields.status !== dbTask.status) changes.push(`status: ${dbTask.status} → ${fields.status}`);
      if (fields.priority && fields.priority !== dbTask.priority) changes.push(`priority: ${dbTask.priority} → ${fields.priority}`);
      if (fields.progressPercent !== undefined && fields.progressPercent !== dbTask.progressPercent) {
        changes.push(`progress: ${dbTask.progressPercent}% → ${fields.progressPercent}%`);
      }
      if (fields.dueAt) {
        const dbDue = dbTask.dueAt ? new Date(dbTask.dueAt).toISOString().slice(0, 10) : '';
        const aprilDue = new Date(fields.dueAt).toISOString().slice(0, 10);
        if (dbDue !== aprilDue) changes.push(`dueAt: ${dbDue} → ${aprilDue}`);
      }
      if (fields.startAt) {
        const dbStart = dbTask.startAt ? new Date(dbTask.startAt).toISOString().slice(0, 10) : '';
        const aprilStart = new Date(fields.startAt).toISOString().slice(0, 10);
        if (dbStart !== aprilStart) changes.push(`startAt: ${dbStart} → ${aprilStart}`);
      }
      if (fields.assigneeUserId && fields.assigneeUserId !== dbTask.assigneeUserId) {
        changes.push(`assigneeUserId: ${dbTask.assigneeUserId} → ${fields.assigneeUserId}`);
      }
      if (fields.detail !== undefined && fields.detail !== (dbTask.detail || '')) {
        changes.push(`detail changed`);
      }
      if (fields.latestProgress !== undefined && fields.latestProgress !== (dbTask.latestProgress || '')) {
        changes.push(`latestProgress changed`);
      }

      if (changes.length > 0) {
        toUpdate.push({ key, aprilRec, dbTask, changes });
      } else {
        unchanged.push(key);
      }
    }
  }

  // B. Tasks in DB but not in April → soft delete
  for (const [key, dbTask] of dbDeduped) {
    if (!aprilDeduped.has(key)) {
      toSoftDelete.push({ key, dbTask });
    }
  }

  // 7. Print report
  console.log('=== DIFF REPORT ===\n');

  console.log(`CREATE (${toCreate.length}):`);
  for (const { key, aprilRec } of toCreate) {
    console.log(`  + ${key} (recordId: ${aprilRec.recordId})`);
  }

  console.log(`\nUPDATE (${toUpdate.length}):`);
  for (const { key, changes } of toUpdate) {
    console.log(`  ~ ${key}`);
    changes.forEach((c) => console.log(`      ${c}`));
  }

  console.log(`\nSOFT DELETE (${toSoftDelete.length}):`);
  for (const { key, dbTask } of toSoftDelete) {
    console.log(`  - ${key} (taskUid: ${dbTask.taskUid})`);
  }

  console.log(`\nUNCHANGED: ${unchanged.length}`);
  console.log(`\n=== SUMMARY ===`);
  console.log(`  April sub-table records: ${aprilParsed.length}`);
  console.log(`  DB 2026-04 tasks:        ${dbTasks.length}`);
  console.log(`  To create:               ${toCreate.length}`);
  console.log(`  To update:               ${toUpdate.length}`);
  console.log(`  To soft-delete:           ${toSoftDelete.length}`);
  console.log(`  Unchanged:               ${unchanged.length}`);
  console.log(`  Bitable duplicates:      ${aprilDuplicates.length}`);
  console.log(`  DB duplicates:           ${dbDuplicates.length}`);
  console.log(`\nBackup file: ${BACKUP_FILE}`);
  console.log('\nThis is a DRY RUN — no changes were made.');

  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
