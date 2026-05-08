/**
 * Deterministic seed fixtures for local dev / e2e screenshots.
 *
 * Design goals:
 *   1. Reproducible — same data every reset; supports visual regression.
 *   2. Visual coverage — every status × priority × delay_count combo represented,
 *      so screenshots exercise all UI states.
 *   3. Self-contained — no external API calls; idempotent (TRUNCATE first).
 *
 * Usage:
 *   pnpm dev:seed           # truncate + reseed
 *   pnpm tsx db/seed/fixtures.ts  # direct
 */
import 'dotenv/config';
import { createDb } from '../src/connection';
import {
  task,
  taskLeader,
  userRoleBinding,
  orgCache,
  project,
  userNotificationPreference,
} from '../src/schema';
import { sql } from 'drizzle-orm';

const DEV_USER_ID = 'ou_dev_harvey';

/* ---------- helpers ---------- */
function dayOffset(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d;
}

function monthBucketOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const now = new Date();
const THIS_MONTH = monthBucketOf(now);

/* ---------- fixture data ---------- */
const USERS = [
  // user_id, open_id, name, dept, manager_user_id, manager_name
  { userId: DEV_USER_ID, openId: DEV_USER_ID, userName: 'Harvey', deptId: 'dept_pm', deptName: '产品部', managerUserId: 'ou_dev_boss', managerName: 'Tobi' },
  { userId: 'ou_dev_boss', openId: 'ou_dev_boss', userName: 'Tobi', deptId: 'dept_exec', deptName: '总裁办', managerUserId: null, managerName: null },
  { userId: 'ou_dev_alice', openId: 'ou_dev_alice', userName: '张三', deptId: 'dept_pm', deptName: '产品部', managerUserId: DEV_USER_ID, managerName: 'Harvey' },
  { userId: 'ou_dev_bob', openId: 'ou_dev_bob', userName: '李四', deptId: 'dept_pm', deptName: '产品部', managerUserId: DEV_USER_ID, managerName: 'Harvey' },
  { userId: 'ou_dev_carol', openId: 'ou_dev_carol', userName: '王五', deptId: 'dept_eng', deptName: '研发部', managerUserId: 'ou_dev_boss', managerName: 'Tobi' },
];

const PROJECTS = [
  { projectUid: 'proj_dev_main', name: '公司建设', isDefault: true },
  { projectUid: 'proj_dev_indo', name: '印尼电商', isDefault: false },
  { projectUid: 'proj_dev_india', name: '印度金融', isDefault: false },
];

const ASSIGNMENT_TYPE = 'boss_assign';
const TASK_TYPE_NEW = 'new';
const TASK_TYPE_CARRY = 'carry_over';

interface TaskFixture {
  readonly taskUid: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly assigneeUserId: string;
  readonly assigneeName: string;
  readonly leaderUserId: string;
  readonly leaderName: string;
  readonly projectUid: string;
  readonly dueOffsetDays: number;
  readonly progressPercent?: number;
  readonly latestProgress?: string;
  readonly detail?: string;
  readonly delayCount?: number;
  readonly carryOverCount?: number;
  readonly isCarriedOver?: boolean;
  readonly bossAttentionFlag?: boolean;
  readonly taskType?: string;
  readonly status_override_completed_at_offset?: number; // for done tasks
}

const TASKS: readonly TaskFixture[] = [
  // urgent_important × in_progress (default project) — 2
  { taskUid: 'task_dev_001', title: 'Q2 经营分析', status: 'in_progress', priority: 'urgent_important', assigneeUserId: 'ou_dev_alice', assigneeName: '张三', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 7, progressPercent: 35, latestProgress: '已完成数据收集，开始分析阶段', detail: '从财务/运营/产品三个维度复盘 Q2 数据，输出风险点和优化建议。' },
  { taskUid: 'task_dev_002', title: '财务规范化推进', status: 'in_progress', priority: 'urgent_important', assigneeUserId: DEV_USER_ID, assigneeName: 'Harvey', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_main', dueOffsetDays: 14, progressPercent: 60, bossAttentionFlag: true, detail: '推进中印两地财务规范化：报表/审批/费用/月结。' },

  // important_not_urgent × not_started — 2
  { taskUid: 'task_dev_003', title: '产品路线图迭代', status: 'not_started', priority: 'important_not_urgent', assigneeUserId: 'ou_dev_bob', assigneeName: '李四', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 21 },
  { taskUid: 'task_dev_004', title: '印尼运营人员招聘', status: 'not_started', priority: 'important_not_urgent', assigneeUserId: 'ou_dev_alice', assigneeName: '张三', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_indo', dueOffsetDays: 30, detail: '招聘 PMG 印尼电商运营 2 人。' },

  // urgent_not_important × in_progress — 2
  { taskUid: 'task_dev_005', title: '竞品周报', status: 'in_progress', priority: 'urgent_not_important', assigneeUserId: 'ou_dev_bob', assigneeName: '李四', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 3, progressPercent: 50 },
  { taskUid: 'task_dev_006', title: '客户回访整理', status: 'in_progress', priority: 'urgent_not_important', assigneeUserId: 'ou_dev_carol', assigneeName: '王五', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_indo', dueOffsetDays: 5, progressPercent: 80, latestProgress: '已联系 12 个客户' },

  // not_urgent_not_important × not_started — 2
  { taskUid: 'task_dev_007', title: '内部 Wiki 整理', status: 'not_started', priority: 'not_urgent_not_important', assigneeUserId: 'ou_dev_alice', assigneeName: '张三', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 45 },
  { taskUid: 'task_dev_008', title: '办公室物资盘点', status: 'not_started', priority: 'not_urgent_not_important', assigneeUserId: 'ou_dev_bob', assigneeName: '李四', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 60 },

  // overdue + delay_count > 0 (visual: red "已延期 N 次") — 3
  { taskUid: 'task_dev_009', title: '老旧合同梳理', status: 'in_progress', priority: 'urgent_important', assigneeUserId: 'ou_dev_alice', assigneeName: '张三', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 5, progressPercent: 20, delayCount: 1 },
  { taskUid: 'task_dev_010', title: 'Cash 印度 NBFC 合规', status: 'in_progress', priority: 'urgent_important', assigneeUserId: 'ou_dev_carol', assigneeName: '王五', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_india', dueOffsetDays: 10, progressPercent: 40, delayCount: 2, bossAttentionFlag: true },
  { taskUid: 'task_dev_011', title: '老 GitLab 迁移', status: 'in_progress', priority: 'important_not_urgent', assigneeUserId: 'ou_dev_bob', assigneeName: '李四', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 8, progressPercent: 55, delayCount: 3 },

  // stalled — 1
  { taskUid: 'task_dev_012', title: '海外支付通道接入', status: 'stalled', priority: 'urgent_important', assigneeUserId: 'ou_dev_carol', assigneeName: '王五', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_indo', dueOffsetDays: 15, progressPercent: 25, latestProgress: '等待法务确认合规要求' },

  // pending — 1
  { taskUid: 'task_dev_013', title: '招聘运营 BD', status: 'pending', priority: 'important_not_urgent', assigneeUserId: 'ou_dev_alice', assigneeName: '张三', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_indo', dueOffsetDays: 25 },

  // done × this month — 3
  { taskUid: 'task_dev_014', title: '4 月份月报', status: 'done', priority: 'urgent_important', assigneeUserId: DEV_USER_ID, assigneeName: 'Harvey', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_main', dueOffsetDays: -10, progressPercent: 100, status_override_completed_at_offset: -8 },
  { taskUid: 'task_dev_015', title: 'OKR 季度复盘', status: 'done', priority: 'important_not_urgent', assigneeUserId: 'ou_dev_alice', assigneeName: '张三', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: -5, progressPercent: 100, status_override_completed_at_offset: -4 },
  { taskUid: 'task_dev_016', title: '印度市场调研', status: 'done', priority: 'urgent_not_important', assigneeUserId: 'ou_dev_bob', assigneeName: '李四', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_india', dueOffsetDays: -3, progressPercent: 100, status_override_completed_at_offset: -1 },

  // carried_over (上月遗留) — 2
  { taskUid: 'task_dev_017', title: '遗留：老用户体验改造', status: 'in_progress', priority: 'important_not_urgent', assigneeUserId: 'ou_dev_alice', assigneeName: '张三', leaderUserId: DEV_USER_ID, leaderName: 'Harvey', projectUid: 'proj_dev_main', dueOffsetDays: 12, progressPercent: 65, isCarriedOver: true, carryOverCount: 1, taskType: TASK_TYPE_CARRY },
  { taskUid: 'task_dev_018', title: '遗留：印度电商团建', status: 'not_started', priority: 'not_urgent_not_important', assigneeUserId: 'ou_dev_carol', assigneeName: '王五', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_india', dueOffsetDays: 20, isCarriedOver: true, carryOverCount: 2, taskType: TASK_TYPE_CARRY },

  // boss attention flag — 1
  { taskUid: 'task_dev_019', title: '★ 重点：Series B 融资材料', status: 'in_progress', priority: 'urgent_important', assigneeUserId: DEV_USER_ID, assigneeName: 'Harvey', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_main', dueOffsetDays: 6, progressPercent: 70, bossAttentionFlag: true, detail: '准备 Series B 融资全套材料：BP、财务模型、市场分析。' },

  // assignee = current dev user (Harvey himself) - 显示在 "我负责的" - 1
  { taskUid: 'task_dev_020', title: '团队 Q3 OKR 制定', status: 'in_progress', priority: 'important_not_urgent', assigneeUserId: DEV_USER_ID, assigneeName: 'Harvey', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi', projectUid: 'proj_dev_main', dueOffsetDays: 30, progressPercent: 15, latestProgress: '已与团队对齐方向' },
];

/* ---------- main ---------- */
async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL missing');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL);

  console.log('→ Truncating dev tables (CASCADE)');
  await db.execute(sql`TRUNCATE TABLE
    task,
    task_leader,
    task_progress_log,
    user_role_binding,
    org_cache,
    project,
    user_notification_preference
  CASCADE`);

  console.log(`→ Inserting ${USERS.length} users + 5 role bindings`);
  await db.insert(orgCache).values(USERS);
  await db.insert(userRoleBinding).values([
    { userId: DEV_USER_ID, role: 'admin' },
    { userId: 'ou_dev_boss', role: 'boss' },
    { userId: 'ou_dev_alice', role: 'employee' },
    { userId: 'ou_dev_bob', role: 'employee' },
    { userId: 'ou_dev_carol', role: 'employee' },
  ]);

  console.log(`→ Inserting ${PROJECTS.length} projects`);
  await db.insert(project).values(PROJECTS);

  console.log(`→ Inserting ${TASKS.length} tasks`);
  for (const f of TASKS) {
    const dueAt = dayOffset(f.dueOffsetDays);
    const completedAt = f.status_override_completed_at_offset !== undefined
      ? dayOffset(f.status_override_completed_at_offset)
      : null;
    const isOverdue = f.status !== 'done' && f.status !== 'shelved' && dueAt < now;
    const daysToDue = f.status === 'done' ? null
      : Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000);

    await db.insert(task).values({
      taskUid: f.taskUid,
      title: f.title,
      detail: f.detail ?? null,
      taskType: f.taskType ?? TASK_TYPE_NEW,
      priority: f.priority,
      status: f.status,
      progressPercent: f.progressPercent ?? 0,
      latestProgress: f.latestProgress ?? null,
      assigneeUserId: f.assigneeUserId,
      assigneeName: f.assigneeName,
      leaderUserId: f.leaderUserId,
      leaderName: f.leaderName,
      issuerUserId: 'ou_dev_boss',
      assignerUserId: 'ou_dev_boss',
      assignmentType: ASSIGNMENT_TYPE,
      startAt: null,
      dueAt,
      completedAt,
      monthBucket: THIS_MONTH,
      isCarriedOver: f.isCarriedOver ?? false,
      carryOverCount: f.carryOverCount ?? 0,
      delayCount: f.delayCount ?? 0,
      bossAttentionFlag: f.bossAttentionFlag ?? false,
      isOverdue,
      daysToDue,
      projectUid: f.projectUid,
      version: 1,
      createdBy: 'ou_dev_boss',
    });
  }

  // Sample task-leader links (multi-leader on a couple of tasks)
  console.log('→ Inserting task_leader extra links');
  await db.insert(taskLeader).values([
    { taskUid: 'task_dev_001', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi' },
    { taskUid: 'task_dev_002', leaderUserId: 'ou_dev_boss', leaderName: 'Tobi' },
  ]);

  console.log('✓ Seed complete:');
  console.log(`  ${USERS.length} users (login as ${DEV_USER_ID})`);
  console.log(`  ${PROJECTS.length} projects`);
  console.log(`  ${TASKS.length} tasks (覆盖 status × priority × delay × carry × boss-attention)`);
  console.log('');
  console.log('Next: pnpm dev:up   then   cd apps/web && pnpm e2e:screenshot');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Seed failed:', err);
    process.exit(1);
  });
