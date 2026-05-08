/**
 * EXECUTE script: sync April Bitable sub-table → DB (2026-04)
 *
 * Usage: cd /opt/leader-sync && npx tsx apps/worker/src/sync-april-execute.ts
 *
 * Operations:
 * - CREATE: new tasks from April sub-table not in DB
 * - UPDATE: overwrite DB business fields with April sub-table values
 * - SOFT DELETE: DB tasks not in April sub-table
 */
import 'dotenv/config';
import * as lark from '@larksuiteoapi/node-sdk';
import { eq, and, sql } from 'drizzle-orm';
import { createDb, task } from '@leader-sync/db';
import { bitableToTaskFields } from './services/sync-engine';
import { generateTaskUid } from '@leader-sync/domain-core';

/* ---------- Config ---------- */

const APRIL_TABLE_ID = 'tbluUoYhIp3t3DGB';
const MONTH_BUCKET = '2026-04';
const SCRIPT_USER = 'sync-april-script';

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

/* ---------- Read Bitable ---------- */

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

/* ---------- Read DB ---------- */

async function readDbTasks() {
  return db
    .select()
    .from(task)
    .where(and(eq(task.monthBucket, MONTH_BUCKET), sql`${task.deletedAt} IS NULL`));
}

/* ---------- Main ---------- */

async function main() {
  console.log('=== April Sync EXECUTE ===\n');

  // 1. Read
  const dbTasks = await readDbTasks();
  console.log(`DB 2026-04 tasks: ${dbTasks.length}`);

  const aprilRecords = await readAprilTable();
  console.log(`April sub-table records: ${aprilRecords.length}`);

  // 2. Parse April
  const aprilParsed: { recordId: string; title: string; assigneeName: string; assigneeUserId: string; fields: any; raw: any }[] = [];
  for (const record of aprilRecords) {
    const f = record.fields;
    const title = extractText(f['待办事项']).trim();
    const assignee = Array.isArray(f['任务负责人']) && f['任务负责人'][0]?.name
      ? f['任务负责人'][0].name.trim()
      : '';
    const assigneeUserId = Array.isArray(f['任务负责人']) && f['任务负责人'][0]?.id
      ? f['任务负责人'][0].id
      : '';

    if (!title) continue;

    aprilParsed.push({
      recordId: record.record_id,
      title,
      assigneeName: assignee,
      assigneeUserId,
      fields: bitableToTaskFields(record),
      raw: f,
    });
  }

  // 3. Dedup
  const aprilDeduped = new Map<string, (typeof aprilParsed)[0]>();
  for (const rec of aprilParsed) {
    const key = getMatchKey(rec.title, rec.assigneeName);
    if (!aprilDeduped.has(key)) aprilDeduped.set(key, rec);
  }

  const dbDeduped = new Map<string, (typeof dbTasks)[0]>();
  for (const t of dbTasks) {
    const key = getMatchKey(t.title, t.assigneeName);
    if (!dbDeduped.has(key)) {
      dbDeduped.set(key, t);
    } else {
      // Keep latest
      const existing = dbDeduped.get(key)!;
      if (t.updatedAt.getTime() > existing.updatedAt.getTime()) {
        dbDeduped.set(key, t);
      }
    }
  }

  // 4. Compute diff
  const toCreate: { key: string; aprilRec: (typeof aprilParsed)[0] }[] = [];
  const toUpdate: { key: string; aprilRec: (typeof aprilParsed)[0]; dbTask: (typeof dbTasks)[0] }[] = [];
  const toSoftDelete: { key: string; dbTask: (typeof dbTasks)[0] }[] = [];

  for (const [key, aprilRec] of aprilDeduped) {
    const dbTask = dbDeduped.get(key);
    if (!dbTask) {
      toCreate.push({ key, aprilRec });
    } else {
      // Check if any business field differs
      const f = aprilRec.fields;
      let changed = false;
      if (f.title && f.title !== dbTask.title) changed = true;
      if (f.status && f.status !== dbTask.status) changed = true;
      if (f.priority && f.priority !== dbTask.priority) changed = true;
      if (f.progressPercent !== undefined && f.progressPercent !== dbTask.progressPercent) changed = true;
      if (f.dueAt) {
        const dbDue = dbTask.dueAt ? new Date(dbTask.dueAt).toISOString().slice(0, 10) : '';
        const aprilDue = new Date(f.dueAt).toISOString().slice(0, 10);
        if (dbDue !== aprilDue) changed = true;
      }
      if (f.startAt) {
        const dbStart = dbTask.startAt ? new Date(dbTask.startAt).toISOString().slice(0, 10) : '';
        const aprilStart = new Date(f.startAt).toISOString().slice(0, 10);
        if (dbStart !== aprilStart) changed = true;
      }
      if (f.assigneeUserId && f.assigneeUserId !== dbTask.assigneeUserId) changed = true;
      if (f.detail !== undefined && f.detail !== (dbTask.detail || '')) changed = true;
      if (f.latestProgress !== undefined && f.latestProgress !== (dbTask.latestProgress || '')) changed = true;

      if (changed) {
        toUpdate.push({ key, aprilRec, dbTask });
      }
    }
  }

  for (const [key, dbTask] of dbDeduped) {
    if (!aprilDeduped.has(key)) {
      toSoftDelete.push({ key, dbTask });
    }
  }

  console.log(`\nPlan: CREATE ${toCreate.length}, UPDATE ${toUpdate.length}, SOFT-DELETE ${toSoftDelete.length}\n`);

  // 5. Execute CREATE
  let created = 0;
  for (const { key, aprilRec } of toCreate) {
    try {
      const f = aprilRec.fields;
      const taskUid = generateTaskUid();

      await db.insert(task).values({
        taskUid,
        title: aprilRec.title,
        detail: f.detail || null,
        taskType: 'new',
        priority: f.priority || 'urgent_important',
        status: f.status || 'pending',
        progressPercent: f.progressPercent ?? 0,
        latestProgress: f.latestProgress || null,
        assigneeUserId: aprilRec.assigneeUserId || 'unknown',
        assigneeName: aprilRec.assigneeName || '',
        assigneeManagerUserId: '',
        assigneeManagerName: null,
        leaderUserId: aprilRec.assigneeUserId || 'unknown',
        leaderName: null,
        issuerUserId: SCRIPT_USER,
        issuerName: 'April Sync',
        assignerUserId: SCRIPT_USER,
        assignerName: 'April Sync',
        assignmentType: 'leader_to_member',
        startAt: f.startAt || null,
        dueAt: f.dueAt || new Date('2026-04-30'),
        completedAt: f.completedAt || null,
        monthBucket: MONTH_BUCKET,
        createdBy: SCRIPT_USER,
        updatedBy: SCRIPT_USER,
        version: 1,
      });

      created++;
      console.log(`  + CREATED: ${key} → ${taskUid}`);
    } catch (err) {
      console.error(`  ✗ CREATE FAILED: ${key}`, (err as Error).message);
    }
  }

  // 6. Execute UPDATE
  let updated = 0;
  for (const { key, aprilRec, dbTask } of toUpdate) {
    try {
      const f = aprilRec.fields;
      const updateValues: Record<string, any> = {
        updatedAt: new Date(),
        updatedBy: SCRIPT_USER,
      };

      // Only overwrite business fields that are present in Bitable
      if (f.title) updateValues.title = f.title;
      if (f.status) updateValues.status = f.status;
      if (f.priority) updateValues.priority = f.priority;
      if (f.progressPercent !== undefined) updateValues.progressPercent = f.progressPercent;
      if (f.dueAt) updateValues.dueAt = f.dueAt;
      if (f.startAt) updateValues.startAt = f.startAt;
      if (f.completedAt) updateValues.completedAt = f.completedAt;
      if (f.assigneeUserId) {
        updateValues.assigneeUserId = f.assigneeUserId;
        updateValues.assigneeName = f.assigneeName || aprilRec.assigneeName;
      }
      if (f.detail !== undefined) updateValues.detail = f.detail || null;
      if (f.latestProgress !== undefined) updateValues.latestProgress = f.latestProgress || null;

      await db
        .update(task)
        .set(updateValues)
        .where(eq(task.taskUid, dbTask.taskUid));

      updated++;
      console.log(`  ~ UPDATED: ${key} (${dbTask.taskUid})`);
    } catch (err) {
      console.error(`  ✗ UPDATE FAILED: ${key}`, (err as Error).message);
    }
  }

  // 7. Execute SOFT DELETE
  let deleted = 0;
  for (const { key, dbTask } of toSoftDelete) {
    try {
      await db
        .update(task)
        .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: SCRIPT_USER })
        .where(and(eq(task.taskUid, dbTask.taskUid), sql`${task.deletedAt} IS NULL`));

      deleted++;
    } catch (err) {
      console.error(`  ✗ DELETE FAILED: ${key}`, (err as Error).message);
    }
  }
  console.log(`  Soft-deleted ${deleted} tasks`);

  // 8. Summary
  console.log('\n=== EXECUTION COMPLETE ===');
  console.log(`  Created:      ${created}`);
  console.log(`  Updated:      ${updated}`);
  console.log(`  Soft-deleted: ${deleted}`);
  console.log(`  Errors:       ${toCreate.length - created + toUpdate.length - updated + toSoftDelete.length - deleted}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
