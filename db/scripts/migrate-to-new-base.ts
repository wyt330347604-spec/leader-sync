import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { sql, eq, isNull, and, like } from 'drizzle-orm';
import * as lark from '@larksuiteoapi/node-sdk';
import { createDb } from '../src/connection';
import { task, externalMapping, project } from '../src/schema';
import {
  BitableStatusMap,
  BitablePriorityMap,
  TaskStatusLabel,
  PriorityLabel,
  TaskTypeLabel,
} from '@leader-sync/shared-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEW_APP_TOKEN = 'Hvctbu6dTaLLRysBCrLcIqF1nwx';
const OLD_APP_TOKEN_PREFIX = 'Rv93bpZpQakM5wspg5Pc8xwcnRc';

const SOURCE_TABLES = [
  { tableId: 'tblSrzPNn9RPPOjM', fallbackMonth: '2026-02', label: '2月' },
  { tableId: 'tbl4HrxjWej2RfYw', fallbackMonth: '2026-03', label: '3月' },
  { tableId: 'tbluUoYhIp3t3DGB', fallbackMonth: '2026-04', label: '4月' },
] as const;

const DONE_STATUSES = ['done', 'shelved', 'closed'];

const DB_BATCH_SIZE = 5;
const BITABLE_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nanoid(size: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = randomBytes(size);
  let id = '';
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

function generateTaskUid(): string {
  return `task_${nanoid(16)}`;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function dateToDayStr(d: Date | null | undefined): string {
  if (!d) return 'no_date';
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDedupKey(title: string, assigneeUserId: string, dueAt: Date | null): string {
  return `${normalizeTitle(title)}||${assigneeUserId}||${dateToDayStr(dueAt)}`;
}

function deriveMonthBucket(dueAt: Date | null, fallbackMonth: string): string {
  if (!dueAt) return fallbackMonth;
  const y = dueAt.getFullYear();
  const m = String(dueAt.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Feishu SDK client
// ---------------------------------------------------------------------------

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID!,
  appSecret: process.env.FEISHU_APP_SECRET!,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

// ---------------------------------------------------------------------------
// Bitable read helpers
// ---------------------------------------------------------------------------

async function listAllRecords(appToken: string, tableId: string): Promise<any[]> {
  const all: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.bitable.appTableRecord.list({
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) },
    });
    all.push(...(res?.data?.items || []));
    pageToken = res?.data?.has_more ? res?.data?.page_token : undefined;
  } while (pageToken);
  return all;
}

// ---------------------------------------------------------------------------
// Bitable write helpers
// ---------------------------------------------------------------------------

async function batchCreateRecords(
  appToken: string,
  tableId: string,
  records: { fields: Record<string, unknown> }[],
): Promise<string[]> {
  const res = await client.bitable.appTableRecord.batchCreate({
    path: { app_token: appToken, table_id: tableId },
    data: { records },
  });
  if (res?.code !== 0) {
    throw new Error(`Batch create error: ${res?.msg}`);
  }
  return (res?.data?.records || []).map((r: any) => r.record_id);
}

// ---------------------------------------------------------------------------
// Field extraction helpers (same as migrate-from-bitable.ts)
// ---------------------------------------------------------------------------

function extractText(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    return field.map((item: { text?: string }) => item.text ?? '').join('');
  }
  return String(field);
}

function extractPerson(field: unknown): { id: string; name: string } {
  if (!Array.isArray(field) || field.length === 0) {
    return { id: '', name: '' };
  }
  const first = field[0] as { id?: string; name?: string };
  return { id: first.id ?? '', name: first.name ?? '' };
}

function extractSelectValue(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null && 'name' in field) {
    return (field as { name: string }).name;
  }
  return String(field);
}

function extractMultiSelectNames(field: unknown): string {
  if (!Array.isArray(field)) return '';
  return field.map((item: { name?: string }) => item.name ?? '').join(',');
}

function timestampToDate(field: unknown): Date | null {
  if (field == null) return null;
  const n = Number(field);
  if (Number.isNaN(n)) return null;
  return new Date(n);
}

// ---------------------------------------------------------------------------
// Bitable record -> task-like object
// ---------------------------------------------------------------------------

interface ParsedBitableTask {
  title: string;
  detail: string | null;
  taskType: string;
  priority: string;
  status: string;
  progressPercent: number;
  latestProgress: string | null;
  assigneeUserId: string;
  assigneeName: string;
  assigneeManagerUserId: string | null;
  assigneeManagerName: string | null;
  assigneeDeptName: string | null;
  leaderUserId: string;
  startAt: Date | null;
  dueAt: Date | null;
  completedAt: Date | null;
  monthBucket: string;
  sourceMonth: string;
  isCarriedOver: boolean;
  isOverdue: boolean;
  daysToDue: number | null;
}

function parseBitableRecord(
  fields: Record<string, unknown>,
  fallbackMonth: string,
): ParsedBitableTask | null {
  const title = extractText(fields['待办事项']).trim();
  if (!title) return null;

  const detail = extractText(fields['任务详情']) || null;

  const assignee = extractPerson(fields['任务负责人']);
  const manager = extractPerson(fields['任务负责人.直属上级'] ?? fields['直属上级']);
  const deptName = extractMultiSelectNames(fields['任务负责人.部门'] ?? fields['部门']);

  const statusRaw = extractSelectValue(fields['进展']);
  const status = statusRaw ? (BitableStatusMap[statusRaw] ?? 'pending') : 'pending';

  const priorityRaw = extractSelectValue(fields['重要紧急程度']);
  const priority = priorityRaw
    ? (BitablePriorityMap[priorityRaw] ?? 'urgent_important')
    : 'urgent_important';

  const startAt = timestampToDate(fields['开始日期']);
  const dueAt = timestampToDate(fields['预计完成日期']);
  // Empty due dates: keep as null (don't skip)

  const completedAt = timestampToDate(fields['实际完成日期']);
  const latestProgress = extractText(fields['最新进展记录']) || null;

  const taskTypeRaw = extractSelectValue(fields['任务类型']);
  const isCarriedOver = taskTypeRaw === '上月遗留';
  const taskType = isCarriedOver ? 'carry_over' : 'new';

  const monthBucket = deriveMonthBucket(dueAt, fallbackMonth);

  const now = Date.now();
  const isOverdue =
    dueAt != null &&
    dueAt.getTime() < now &&
    status !== 'done' &&
    status !== 'shelved';
  const daysToDue = dueAt ? Math.ceil((dueAt.getTime() - now) / 86_400_000) : null;

  const progressPercent = status === 'done' ? 100 : 0;

  return {
    title,
    detail,
    taskType,
    priority,
    status,
    progressPercent,
    latestProgress,
    assigneeUserId: assignee.id || 'unknown',
    assigneeName: assignee.name || 'unknown',
    assigneeManagerUserId: manager.id || null,
    assigneeManagerName: manager.name || null,
    assigneeDeptName: deptName || null,
    leaderUserId: manager.id || 'unknown',
    startAt,
    dueAt,
    completedAt,
    monthBucket,
    sourceMonth: monthBucket,
    isCarriedOver,
    isOverdue,
    daysToDue,
  };
}

// ---------------------------------------------------------------------------
// DB task -> Bitable fields (with person fields + project)
// ---------------------------------------------------------------------------

const taskTypeReverse: Record<string, string> = {
  carry_over: '上月遗留',
  new: '本月新增',
};

function taskRowToBitableFields(
  row: any,
  projectName: string | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    '待办事项': row.title || '',
    '任务详情': row.detail || '',
    '任务类型': taskTypeReverse[row.taskType] ?? '本月新增',
    '进展': TaskStatusLabel[row.status] ?? '待办',
    '重要紧急程度': PriorityLabel[row.priority] ?? '重要紧急',
    '部门': row.assigneeDeptName || '',
    '进度百分比': row.progressPercent ?? 0,
    '最新进展记录': row.latestProgress || '',
    '剩余天数': row.daysToDue ?? 0,
    '是否延期': row.isOverdue ? '🚨 已延期' : '✅ 正常',
    '归属月份': row.monthBucket || '',
    '重点任务': row.bossAttentionFlag ?? false,
    '所属项目': projectName || '',
  };

  // Person fields: send as person type if valid Feishu user ID
  if (row.assigneeUserId?.startsWith('ou_')) {
    fields['任务负责人'] = [{ id: row.assigneeUserId }];
  } else {
    fields['任务负责人'] = row.assigneeName || '';
  }

  if (row.assigneeManagerUserId?.startsWith('ou_')) {
    fields['直属上级'] = [{ id: row.assigneeManagerUserId }];
  } else {
    fields['直属上级'] = row.assigneeManagerName || '';
  }

  // Date fields: Bitable expects Unix timestamps in milliseconds
  if (row.startAt) fields['开始日期'] = new Date(row.startAt).getTime();
  if (row.dueAt) fields['预计完成日期'] = new Date(row.dueAt).getTime();
  if (row.completedAt) fields['实际完成日期'] = new Date(row.completedAt).getTime();

  return fields;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
  }

  const db = createDb(databaseUrl);
  const now = new Date();

  // =========================================================================
  // STEP 1: Read all records from new base 3 sub-tables
  // =========================================================================
  console.log('\n=== STEP 1: Read records from new base sub-tables ===');

  const allNewRecords: ParsedBitableTask[] = [];

  for (const { tableId, fallbackMonth, label } of SOURCE_TABLES) {
    console.log(`  Reading table "${label}" (${tableId})...`);
    try {
      const rawRecords = await listAllRecords(NEW_APP_TOKEN, tableId);
      console.log(`    Fetched ${rawRecords.length} raw records.`);

      let parsed = 0;
      let skipped = 0;
      for (const rec of rawRecords) {
        const mapped = parseBitableRecord(rec.fields, fallbackMonth);
        if (mapped) {
          allNewRecords.push(mapped);
          parsed++;
        } else {
          skipped++;
        }
      }
      console.log(`    Parsed: ${parsed}, Skipped (empty title): ${skipped}`);
    } catch (err) {
      console.error(`    ERROR reading table "${label}":`, (err as Error).message);
    }
  }

  console.log(`  Total parsed records from new base: ${allNewRecords.length}`);

  // =========================================================================
  // STEP 2: Dedup against existing DB and upsert
  // =========================================================================
  console.log('\n=== STEP 2: Dedup against existing DB ===');

  // Load all existing non-deleted tasks
  const existingTasks = await db
    .select()
    .from(task)
    .where(isNull(task.deletedAt));

  console.log(`  Existing DB tasks (not deleted): ${existingTasks.length}`);

  // Build dedup index: key -> existing task
  const existingByKey = new Map<string, typeof existingTasks[number]>();
  for (const t of existingTasks) {
    const key = buildDedupKey(t.title, t.assigneeUserId, t.dueAt);
    existingByKey.set(key, t);
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  // Collect newly inserted task UIDs for later steps
  const newTaskUids: string[] = [];

  for (const rec of allNewRecords) {
    const key = buildDedupKey(rec.title, rec.assigneeUserId, rec.dueAt);
    const existing = existingByKey.get(key);

    try {
      if (existing) {
        // Update existing record: new table's values win
        await db.update(task).set({
          status: rec.status,
          priority: rec.priority,
          taskType: rec.taskType,
          detail: rec.detail,
          progressPercent: rec.progressPercent,
          latestProgress: rec.latestProgress,
          startAt: rec.startAt,
          completedAt: rec.completedAt,
          isOverdue: rec.isOverdue,
          daysToDue: rec.daysToDue,
          assigneeDeptName: rec.assigneeDeptName,
          updatedAt: now,
          updatedBy: 'migration_new_base',
        }).where(eq(task.id, existing.id));
        updatedCount++;
      } else {
        // Insert new record
        const taskUid = generateTaskUid();
        await db.insert(task).values({
          taskUid,
          title: rec.title,
          detail: rec.detail,
          taskType: rec.taskType,
          priority: rec.priority,
          status: rec.status,
          progressPercent: rec.progressPercent,
          latestProgress: rec.latestProgress,
          assigneeUserId: rec.assigneeUserId,
          assigneeName: rec.assigneeName,
          assigneeManagerUserId: rec.assigneeManagerUserId,
          assigneeManagerName: rec.assigneeManagerName,
          assigneeDeptName: rec.assigneeDeptName,
          leaderUserId: rec.leaderUserId,
          issuerUserId: 'system_migration',
          assignerUserId: 'system_migration',
          assignmentType: rec.isCarriedOver ? 'carry_over' : 'self_claim',
          startAt: rec.startAt,
          dueAt: rec.dueAt ?? now, // fallback if null
          completedAt: rec.completedAt,
          monthBucket: rec.monthBucket,
          sourceMonth: rec.sourceMonth,
          isCarriedOver: rec.isCarriedOver,
          isOverdue: rec.isOverdue,
          daysToDue: rec.daysToDue,
          version: 1,
          createdBy: 'migration_new_base',
          createdAt: now,
          updatedAt: now,
        });
        newTaskUids.push(taskUid);
        insertedCount++;
      }
    } catch (err) {
      console.error(`    ERROR processing "${rec.title}":`, (err as Error).message);
      errorCount++;
    }
  }

  console.log(`  Inserted: ${insertedCount}, Updated: ${updatedCount}, Errors: ${errorCount}`);

  // =========================================================================
  // STEP 3: Create unified "督办系统" table in NEW base
  // =========================================================================
  console.log('\n=== STEP 3: Create unified "督办系统" table in new base ===');

  const fields = [
    { field_name: '待办事项', type: 1 },     // text
    { field_name: '任务详情', type: 1 },     // text
    {
      field_name: '任务类型',
      type: 3,                                // select
      property: {
        options: [{ name: '上月遗留' }, { name: '本月新增' }],
      },
    },
    {
      field_name: '任务负责人',
      type: 11,                               // person
      property: { multiple: false },
    },
    {
      field_name: '直属上级',
      type: 11,                               // person
      property: { multiple: false },
    },
    { field_name: '部门', type: 1 },         // text
    {
      field_name: '进展',
      type: 3,                                // select
      property: {
        options: [
          { name: '待办' },
          { name: '待开始' },
          { name: '进行中' },
          { name: '已停滞' },
          { name: '已完成' },
          { name: '已搁置' },
        ],
      },
    },
    {
      field_name: '重要紧急程度',
      type: 3,                                // select
      property: {
        options: [
          { name: '重要紧急' },
          { name: '重要不紧急' },
          { name: '紧急不重要' },
          { name: '不紧急不重要' },
        ],
      },
    },
    { field_name: '开始日期', type: 5 },     // date
    { field_name: '预计完成日期', type: 5 },  // date
    { field_name: '实际完成日期', type: 5 },  // date
    { field_name: '进度百分比', type: 2 },    // number
    { field_name: '最新进展记录', type: 1 },  // text
    { field_name: '剩余天数', type: 2 },     // number
    {
      field_name: '是否延期',
      type: 3,                                // select
      property: {
        options: [{ name: '🚨 已延期' }, { name: '✅ 正常' }],
      },
    },
    { field_name: '归属月份', type: 1 },     // text
    { field_name: '重点任务', type: 7 },     // checkbox
    { field_name: '所属项目', type: 1 },     // text
  ];

  let newTableId: string;

  try {
    const res = await client.bitable.appTable.create({
      path: { app_token: NEW_APP_TOKEN },
      data: {
        table: {
          name: '督办系统',
          default_view_name: '全部任务',
          fields,
        },
      },
    });
    newTableId = res?.data?.table_id!;
    if (!newTableId) throw new Error('No table_id returned');
    console.log(`  Created table "督办系统": ${newTableId}`);
  } catch (err) {
    console.error('  FATAL: Failed to create unified table:', (err as Error).message);
    process.exit(1);
  }

  // =========================================================================
  // STEP 4: Push all DB tasks to new unified table
  // =========================================================================
  console.log('\n=== STEP 4: Push all DB tasks to new unified table ===');

  // Reload all non-deleted tasks (includes newly inserted ones)
  const allDbTasks = await db
    .select()
    .from(task)
    .where(isNull(task.deletedAt))
    .orderBy(task.monthBucket, task.createdAt);

  console.log(`  Total DB tasks to push: ${allDbTasks.length}`);

  // Load projects for name lookup
  const allProjects = await db.select().from(project);
  const projectByUid = new Map<string, string>();
  for (const p of allProjects) {
    projectByUid.set(p.projectUid, p.name);
  }

  let pushedCount = 0;
  let pushErrorCount = 0;
  const allMappings: { taskUid: string; recordId: string }[] = [];

  for (let i = 0; i < allDbTasks.length; i += BITABLE_BATCH_SIZE) {
    const batch = allDbTasks.slice(i, i + BITABLE_BATCH_SIZE);
    const batchNum = Math.floor(i / BITABLE_BATCH_SIZE) + 1;

    const bitableRecords = batch.map((row) => {
      const projectName = row.projectUid ? (projectByUid.get(row.projectUid) ?? '') : '';
      return { fields: taskRowToBitableFields(row, projectName) };
    });

    try {
      console.log(`  Pushing batch ${batchNum} (${batch.length} records)...`);
      const recordIds = await batchCreateRecords(NEW_APP_TOKEN, newTableId, bitableRecords);

      for (let j = 0; j < batch.length; j++) {
        if (recordIds[j]) {
          allMappings.push({ taskUid: batch[j].taskUid, recordId: recordIds[j] });
        }
      }
      pushedCount += batch.length;
    } catch (err) {
      console.error(`  ERROR pushing batch ${batchNum}:`, (err as Error).message);
      pushErrorCount += batch.length;
    }
  }

  console.log(`  Pushed: ${pushedCount}, Errors: ${pushErrorCount}`);

  // Save external mappings
  console.log(`  Saving ${allMappings.length} external mappings...`);
  const externalParentId = `${NEW_APP_TOKEN}/${newTableId}`;

  for (let i = 0; i < allMappings.length; i += DB_BATCH_SIZE) {
    const batch = allMappings.slice(i, i + DB_BATCH_SIZE);
    try {
      await db.insert(externalMapping).values(
        batch.map((m) => ({
          taskUid: m.taskUid,
          sourceType: 'bitable' as const,
          externalObjectId: m.recordId,
          externalParentId,
          syncVersion: 1,
          syncStatus: 'success' as const,
          lastSyncAt: now,
          lastSyncSource: 'migration_new_base',
        })),
      );
    } catch (err) {
      console.error(`  ERROR saving mapping batch:`, (err as Error).message);
    }
  }

  console.log(`  External mappings saved.`);

  // =========================================================================
  // STEP 5: Clear old external_mappings
  // =========================================================================
  console.log('\n=== STEP 5: Clear old external_mappings ===');

  try {
    const deleteResult = await db
      .delete(externalMapping)
      .where(like(externalMapping.externalParentId, `${OLD_APP_TOKEN_PREFIX}%`));
    console.log(`  Deleted old mappings with prefix "${OLD_APP_TOKEN_PREFIX}".`);
  } catch (err) {
    console.error('  ERROR deleting old mappings:', (err as Error).message);
  }

  // =========================================================================
  // STEP 6: March -> April inheritance with title-based dedup
  // =========================================================================
  console.log('\n=== STEP 6: March -> April carry-over ===');

  // Find March tasks that are NOT done/shelved/closed
  const marchTasks = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.monthBucket, '2026-03'),
        isNull(task.deletedAt),
      ),
    );

  const marchCarryCandidates = marchTasks.filter(
    (t) => !DONE_STATUSES.includes(t.status),
  );

  console.log(`  March tasks total: ${marchTasks.length}`);
  console.log(`  March carry-over candidates: ${marchCarryCandidates.length}`);

  // Load April tasks for title-based dedup
  const aprilTasks = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.monthBucket, '2026-04'),
        isNull(task.deletedAt),
      ),
    );

  const aprilTitleSet = new Set<string>(
    aprilTasks.map((t) => normalizeTitle(t.title)),
  );

  let carriedCount = 0;
  let skippedDuplicates = 0;
  let carryErrors = 0;

  for (const t of marchCarryCandidates) {
    const normTitle = normalizeTitle(t.title);

    // If same title exists in April already, skip
    if (aprilTitleSet.has(normTitle)) {
      skippedDuplicates++;
      continue;
    }

    const newTaskUid = generateTaskUid();
    const carryOverTask = {
      taskUid: newTaskUid,
      title: t.title,
      detail: t.detail,
      taskType: 'carry_over' as const,
      priority: t.priority,
      status: t.status === 'stalled' ? ('stalled' as const) : ('not_started' as const),
      progressPercent: 0,
      latestProgress: null as string | null,
      assigneeUserId: t.assigneeUserId,
      assigneeName: t.assigneeName,
      assigneeManagerUserId: t.assigneeManagerUserId,
      assigneeManagerName: t.assigneeManagerName,
      assigneeDeptName: t.assigneeDeptName,
      leaderUserId: t.leaderUserId,
      leaderName: t.leaderName,
      issuerUserId: t.issuerUserId,
      assignerUserId: t.assignerUserId,
      assignmentType: 'carry_over' as const,
      dueAt: t.dueAt,
      startAt: t.startAt,
      monthBucket: '2026-04',
      sourceMonth: t.sourceMonth || t.monthBucket,
      isCarriedOver: true,
      carriedFromTaskUid: t.taskUid,
      carryOverCount: (t.carryOverCount || 0) + 1,
      bossAttentionFlag: t.bossAttentionFlag,
      projectUid: t.projectUid,
      version: 1,
      createdBy: 'migration_carry_over',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.insert(task).values(carryOverTask);

      // Also add to April title set to avoid duplicating within this loop
      aprilTitleSet.add(normTitle);

      // Create Bitable record in the new unified table
      const projectName = t.projectUid ? (projectByUid.get(t.projectUid) ?? '') : '';
      const bitableFields = taskRowToBitableFields(
        { ...carryOverTask, isOverdue: false, daysToDue: null },
        projectName,
      );

      try {
        const recordIds = await batchCreateRecords(NEW_APP_TOKEN, newTableId, [
          { fields: bitableFields },
        ]);
        if (recordIds[0]) {
          await db.insert(externalMapping).values({
            taskUid: newTaskUid,
            sourceType: 'bitable',
            externalObjectId: recordIds[0],
            externalParentId: externalParentId,
            syncVersion: 1,
            syncStatus: 'success',
            lastSyncAt: now,
            lastSyncSource: 'migration_carry_over',
          });
        }
      } catch (err) {
        console.warn(`    Failed to create Bitable record for carry-over ${newTaskUid}:`, (err as Error).message);
      }

      carriedCount++;
    } catch (err) {
      console.error(`    ERROR carrying over "${t.title}":`, (err as Error).message);
      carryErrors++;
    }
  }

  console.log(`  Carried over: ${carriedCount}`);
  console.log(`  Skipped (already in April): ${skippedDuplicates}`);
  console.log(`  Errors: ${carryErrors}`);

  // =========================================================================
  // STEP 7: Print config for manual update
  // =========================================================================
  console.log('\n=== STEP 7: New configuration values ===');
  console.log('');
  console.log('  Update apps/worker/src/config.ts and .env with:');
  console.log(`    BITABLE_APP_TOKEN=${NEW_APP_TOKEN}`);
  console.log(`    BITABLE_TABLE_ID=${newTableId}`);
  console.log('');
  console.log(`  Full table path: ${NEW_APP_TOKEN}/${newTableId}`);

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n============================================');
  console.log('           MIGRATION SUMMARY');
  console.log('============================================');
  console.log(`  Step 1 - Records read from new base:     ${allNewRecords.length}`);
  console.log(`  Step 2 - DB inserted:                    ${insertedCount}`);
  console.log(`  Step 2 - DB updated:                     ${updatedCount}`);
  console.log(`  Step 3 - New unified table:              ${newTableId}`);
  console.log(`  Step 4 - Records pushed to Bitable:      ${pushedCount}`);
  console.log(`  Step 4 - External mappings created:       ${allMappings.length}`);
  console.log(`  Step 5 - Old mappings cleared:            (prefix ${OLD_APP_TOKEN_PREFIX})`);
  console.log(`  Step 6 - March->April carry-overs:        ${carriedCount}`);
  console.log(`  Step 6 - Skipped duplicates:              ${skippedDuplicates}`);
  console.log('============================================');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nMIGRATION FAILED:', err);
  process.exit(1);
});
