import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/connection';
import { task, externalMapping } from '../src/schema';
import {
  TaskStatusLabel,
  PriorityLabel,
} from '@leader-sync/shared-types';

// ---------------------------------------------------------------------------
// Feishu API helpers
// ---------------------------------------------------------------------------

const FEISHU_APP_ID = process.env.FEISHU_APP_ID!;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET!;
const APP_TOKEN = 'Rv93bpZpQakM5wspg5Pc8xwcnRc';

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

// ---------------------------------------------------------------------------
// Reverse label maps (system value → Chinese label)
// ---------------------------------------------------------------------------

const statusReverse: Record<string, string> = Object.fromEntries(
  Object.entries(TaskStatusLabel).map(([k, v]) => [k, v]),
);

const priorityReverse: Record<string, string> = Object.fromEntries(
  Object.entries(PriorityLabel).map(([k, v]) => [k, v]),
);

const taskTypeReverse: Record<string, string> = {
  carry_over: '上月遗留',
  new: '本月新增',
};

// ---------------------------------------------------------------------------
// Table creation
// ---------------------------------------------------------------------------

interface CreateTableResponse {
  code: number;
  msg: string;
  data: {
    table_id: string;
  };
}

async function createBitableTable(token: string): Promise<string> {
  const fields = [
    { field_name: '待办事项', type: 1 },
    { field_name: '任务详情', type: 1 },
    {
      field_name: '任务类型',
      type: 3,
      property: {
        options: [{ name: '上月遗留' }, { name: '本月新增' }],
      },
    },
    {
      field_name: '进展',
      type: 3,
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
      type: 3,
      property: {
        options: [
          { name: '重要紧急' },
          { name: '重要不紧急' },
          { name: '紧急不重要' },
          { name: '不紧急不重要' },
        ],
      },
    },
    { field_name: '任务负责人', type: 1 },
    { field_name: '直属上级', type: 1 },
    { field_name: '部门', type: 1 },
    { field_name: '开始日期', type: 5 },
    { field_name: '预计完成日期', type: 5 },
    { field_name: '实际完成日期', type: 5 },
    { field_name: '进度百分比', type: 2 },
    { field_name: '最新进展记录', type: 1 },
    { field_name: '剩余天数', type: 2 },
    {
      field_name: '是否延期',
      type: 3,
      property: {
        options: [{ name: '🚨 已延期' }, { name: '✅ 正常' }],
      },
    },
    { field_name: '归属月份', type: 1 },
    { field_name: '老板关注', type: 7 },
  ];

  const res = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        table: {
          name: '督办系统',
          default_view_name: '全部任务',
          fields,
        },
      }),
    },
  );

  const body = (await res.json()) as CreateTableResponse;
  if (body.code !== 0) {
    throw new Error(`Failed to create table: ${body.msg}`);
  }

  return body.data.table_id;
}

// ---------------------------------------------------------------------------
// Batch create records
// ---------------------------------------------------------------------------

interface BatchCreateResponse {
  code: number;
  msg: string;
  data: {
    records: { record_id: string; fields: Record<string, unknown> }[];
  };
}

async function batchCreateRecords(
  token: string,
  tableId: string,
  records: { fields: Record<string, unknown> }[],
): Promise<string[]> {
  const res = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ records }),
    },
  );

  const body = (await res.json()) as BatchCreateResponse;
  if (body.code !== 0) {
    throw new Error(`Failed to batch create records: ${body.msg}`);
  }

  return body.data.records.map((r) => r.record_id);
}

// ---------------------------------------------------------------------------
// DB row → Bitable fields
// ---------------------------------------------------------------------------

interface TaskRow {
  taskUid: string;
  title: string;
  detail: string | null;
  taskType: string;
  status: string;
  priority: string;
  assigneeName: string;
  assigneeManagerName: string | null;
  assigneeDeptName: string | null;
  startAt: Date | null;
  dueAt: Date;
  completedAt: Date | null;
  progressPercent: number | null;
  latestProgress: string | null;
  daysToDue: number | null;
  isOverdue: boolean | null;
  monthBucket: string;
  bossAttentionFlag: boolean | null;
}

function taskToBitableFields(row: TaskRow): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    '待办事项': row.title,
    '任务详情': row.detail ?? '',
    '任务类型': taskTypeReverse[row.taskType] ?? '本月新增',
    '进展': statusReverse[row.status] ?? '待办',
    '重要紧急程度': priorityReverse[row.priority] ?? '重要紧急',
    '任务负责人': row.assigneeName ?? '',
    '直属上级': row.assigneeManagerName ?? '',
    '部门': row.assigneeDeptName ?? '',
    '进度百分比': row.progressPercent ?? 0,
    '最新进展记录': row.latestProgress ?? '',
    '剩余天数': row.daysToDue ?? 0,
    '是否延期': row.isOverdue ? '🚨 已延期' : '✅ 正常',
    '归属月份': row.monthBucket,
    '老板关注': row.bossAttentionFlag ?? false,
  };

  // Date fields: Bitable expects Unix timestamps in milliseconds
  if (row.startAt) {
    fields['开始日期'] = row.startAt.getTime();
  }
  fields['预计完成日期'] = row.dueAt.getTime();
  if (row.completedAt) {
    fields['实际完成日期'] = row.completedAt.getTime();
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
  // Step 1 – Create Bitable table
  // -----------------------------------------------------------------------
  console.log('Getting Feishu access token...');
  const accessToken = await getAppAccessToken();
  console.log('Access token obtained.');

  console.log('Creating Bitable table "督办系统"...');
  const newTableId = await createBitableTable(accessToken);
  console.log(`Table created: ${newTableId}`);

  // -----------------------------------------------------------------------
  // Step 2 – Read all tasks from DB
  // -----------------------------------------------------------------------
  console.log('Reading tasks from database...');
  const rows = await db
    .select({
      taskUid: task.taskUid,
      title: task.title,
      detail: task.detail,
      taskType: task.taskType,
      status: task.status,
      priority: task.priority,
      assigneeName: task.assigneeName,
      assigneeManagerName: task.assigneeManagerName,
      assigneeDeptName: task.assigneeDeptName,
      startAt: task.startAt,
      dueAt: task.dueAt,
      completedAt: task.completedAt,
      progressPercent: task.progressPercent,
      latestProgress: task.latestProgress,
      daysToDue: task.daysToDue,
      isOverdue: task.isOverdue,
      monthBucket: task.monthBucket,
      bossAttentionFlag: task.bossAttentionFlag,
    })
    .from(task)
    .where(sql`${task.deletedAt} IS NULL`)
    .orderBy(task.monthBucket, task.createdAt);

  console.log(`Found ${rows.length} tasks in database.`);

  if (rows.length === 0) {
    console.log('No tasks to push. Done.');
    process.exit(0);
  }

  // -----------------------------------------------------------------------
  // Step 3 – Push records in batches of 50
  // -----------------------------------------------------------------------
  const BATCH_SIZE = 50;
  const allMappings: { taskUid: string; recordId: string }[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const bitableRecords = batch.map((row) => ({
      fields: taskToBitableFields(row),
    }));

    console.log(
      `Pushing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} records)...`,
    );
    const recordIds = await batchCreateRecords(
      accessToken,
      newTableId,
      bitableRecords,
    );

    for (let j = 0; j < batch.length; j++) {
      allMappings.push({
        taskUid: batch[j].taskUid,
        recordId: recordIds[j],
      });
    }
  }

  console.log(`Pushed ${allMappings.length} records to Bitable.`);

  // -----------------------------------------------------------------------
  // Step 4 – Save external mappings to DB
  // -----------------------------------------------------------------------
  console.log('Saving external mappings...');

  const MAPPING_BATCH_SIZE = 100;
  for (let i = 0; i < allMappings.length; i += MAPPING_BATCH_SIZE) {
    const batch = allMappings.slice(i, i + MAPPING_BATCH_SIZE);
    await db.insert(externalMapping).values(
      batch.map((m) => ({
        taskUid: m.taskUid,
        sourceType: 'bitable',
        externalObjectId: m.recordId,
        externalParentId: `${APP_TOKEN}/${newTableId}`,
        syncVersion: 1,
        syncStatus: 'success',
        lastSyncAt: new Date(),
        lastSyncSource: 'migration_script',
      })),
    );
  }

  console.log(`Saved ${allMappings.length} external mappings.`);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n========== Create Bitable Summary ==========');
  console.log(`New table ID:        ${newTableId}`);
  console.log(`App token:           ${APP_TOKEN}`);
  console.log(`Full table path:     ${APP_TOKEN}/${newTableId}`);
  console.log(`Records pushed:      ${allMappings.length}`);
  console.log(`Mappings created:    ${allMappings.length}`);
  console.log('=============================================');
  console.log(
    '\nPlease save the table ID in your configuration for future sync.',
  );

  process.exit(0);
}

main().catch((err) => {
  console.error('Create Bitable failed:', err);
  process.exit(1);
});
