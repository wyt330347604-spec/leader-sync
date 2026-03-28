import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/connection';
import { task, taskProgressLog, userRoleBinding, orgCache } from '../src/schema';
import {
  BitableStatusMap,
  BitablePriorityMap,
} from '@leader-sync/shared-types';

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

// ---------------------------------------------------------------------------
// Feishu API helpers
// ---------------------------------------------------------------------------

const FEISHU_APP_ID = process.env.FEISHU_APP_ID!;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET!;

async function getAppAccessToken(): Promise<string> {
  const res = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    },
  );
  const data = (await res.json()) as {
    code: number;
    msg: string;
    app_access_token: string;
  };
  if (data.code !== 0) {
    throw new Error(`Failed to get app_access_token: ${data.msg}`);
  }
  return data.app_access_token;
}

interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

interface ListRecordsResponse {
  code: number;
  msg: string;
  data: {
    has_more: boolean;
    page_token?: string;
    total: number;
    items: BitableRecord[];
  };
}

async function fetchAllRecords(
  token: string,
  appToken: string,
  tableId: string,
): Promise<BitableRecord[]> {
  const all: BitableRecord[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    );
    url.searchParams.set('page_size', '100');
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as ListRecordsResponse;
    if (body.code !== 0) {
      throw new Error(
        `Failed to list records for table ${tableId}: ${body.msg}`,
      );
    }

    if (body.data.items) {
      all.push(...body.data.items);
    }
    pageToken = body.data.has_more ? body.data.page_token : undefined;
  } while (pageToken);

  return all;
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

interface PersonField {
  id: string;
  name: string;
  en_name?: string;
  email?: string;
}

function extractText(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    return field
      .map((item: { text?: string }) => item.text ?? '')
      .join('');
  }
  return String(field);
}

function extractPerson(field: unknown): { id: string; name: string } {
  if (!Array.isArray(field) || field.length === 0) {
    return { id: '', name: '' };
  }
  const first = field[0] as PersonField;
  return { id: first.id ?? '', name: first.name ?? '' };
}

function extractMultiSelectNames(field: unknown): string {
  if (!Array.isArray(field)) return '';
  return field.map((item: { name?: string }) => item.name ?? '').join(',');
}

function extractSelectValue(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null && 'name' in field) {
    return (field as { name: string }).name;
  }
  return String(field);
}

function timestampToDate(field: unknown): Date | null {
  if (field == null) return null;
  const n = Number(field);
  if (Number.isNaN(n)) return null;
  return new Date(n);
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

interface TaskInsert {
  taskUid: string;
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
  issuerUserId: string;
  assignerUserId: string;
  assignmentType: string;
  startAt: Date | null;
  dueAt: Date;
  completedAt: Date | null;
  monthBucket: string;
  sourceMonth: string;
  isCarriedOver: boolean;
  isOverdue: boolean;
  daysToDue: number;
  version: number;
  createdBy: string;
}

function mapRecord(
  fields: Record<string, unknown>,
  monthBucket: string,
): TaskInsert | null {
  const title = extractText(fields['待办事项']).trim();
  if (!title) return null;

  const detail = extractText(fields['任务详情']) || null;

  const assignee = extractPerson(fields['任务负责人']);
  const manager = extractPerson(fields['任务负责人.直属上级']);
  const deptName = extractMultiSelectNames(fields['任务负责人.部门']);

  const statusRaw = extractSelectValue(fields['进展']);
  const status = statusRaw
    ? (BitableStatusMap[statusRaw] ?? 'pending')
    : 'pending';

  const priorityRaw = extractSelectValue(fields['重要紧急程度']);
  const priority = priorityRaw
    ? (BitablePriorityMap[priorityRaw] ?? 'urgent_important')
    : 'urgent_important';

  const startAt = timestampToDate(fields['开始日期']);
  const dueAt = timestampToDate(fields['预计完成日期']);
  if (!dueAt) return null; // REQUIRED

  const completedAt = timestampToDate(fields['实际完成日期']);
  const latestProgress = extractText(fields['最新进展记录']) || null;

  const taskTypeRaw = extractSelectValue(fields['任务类型']);
  const isCarriedOver = taskTypeRaw === '上月遗留';
  const taskType = isCarriedOver ? 'carry_over' : 'new';

  const now = Date.now();
  const isOverdue =
    dueAt.getTime() < now &&
    status !== 'done' &&
    status !== 'shelved';
  const daysToDue = Math.ceil((dueAt.getTime() - now) / 86_400_000);

  const progressPercent = status === 'done' ? 100 : 0;

  const leaderUserId = manager.id || 'unknown';
  const assignmentType = isCarriedOver ? 'carry_over' : 'self_claim';

  return {
    taskUid: generateTaskUid(),
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
    leaderUserId,
    issuerUserId: 'system_migration',
    assignerUserId: 'system_migration',
    assignmentType,
    startAt,
    dueAt,
    completedAt,
    monthBucket,
    sourceMonth: monthBucket,
    isCarriedOver,
    isOverdue,
    daysToDue,
    version: 1,
    createdBy: 'system_migration',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const APP_TOKEN = 'Rv93bpZpQakM5wspg5Pc8xwcnRc';

const TABLES: readonly { tableId: string; monthBucket: string; label: string }[] = [
  { tableId: 'tblzJqenmeRGLck2', monthBucket: '2026-02', label: '2月' },
  { tableId: 'tblHWF9XbDMtSfKL', monthBucket: '2026-03', label: '3月' },
  { tableId: 'tblMa0SK05tM5YBF', monthBucket: '2026-04', label: '4月' },
] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
  }

  const db = createDb(databaseUrl);

  // -----------------------------------------------------------------------
  // Step 1 – Clean existing seed / migration data
  // -----------------------------------------------------------------------
  console.log('Cleaning existing data...');
  await db.execute(sql`DELETE FROM task_progress_log`);
  await db.execute(
    sql`DELETE FROM task WHERE created_by IN ('ou_boss_001', 'ou_leader_001', 'ou_employee_001', 'system_migration')`,
  );
  await db.execute(sql`DELETE FROM user_role_binding`);
  await db.execute(sql`DELETE FROM org_cache`);
  console.log('Existing data cleaned.');

  // -----------------------------------------------------------------------
  // Step 2 – Fetch Feishu app token
  // -----------------------------------------------------------------------
  console.log('Fetching Feishu app access token...');
  const accessToken = await getAppAccessToken();
  console.log('Access token obtained.');

  // -----------------------------------------------------------------------
  // Step 3 – Process each table
  // -----------------------------------------------------------------------
  let totalRead = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const { tableId, monthBucket, label } of TABLES) {
    console.log(`\nProcessing table "${label}" (${tableId})...`);

    const records = await fetchAllRecords(accessToken, APP_TOKEN, tableId);
    console.log(`  Fetched ${records.length} records from Bitable.`);
    totalRead += records.length;

    const mapped: TaskInsert[] = [];
    let skipped = 0;

    for (const rec of records) {
      const row = mapRecord(rec.fields, monthBucket);
      if (row) {
        mapped.push(row);
      } else {
        skipped++;
      }
    }

    totalSkipped += skipped;

    if (mapped.length > 0) {
      // Batch insert in chunks of 100
      const BATCH_SIZE = 100;
      for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
        const batch = mapped.slice(i, i + BATCH_SIZE);
        await db.insert(task).values(batch);
      }
      totalInserted += mapped.length;
      console.log(
        `  Inserted ${mapped.length} tasks, skipped ${skipped}.`,
      );
    } else {
      console.log(`  No valid tasks to insert (skipped ${skipped}).`);
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n========== Migration Summary ==========');
  console.log(`Total records read:     ${totalRead}`);
  console.log(`Total tasks inserted:   ${totalInserted}`);
  console.log(`Total records skipped:  ${totalSkipped}`);
  console.log('========================================');

  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
