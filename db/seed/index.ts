import 'dotenv/config';
import { createDb } from '../src/connection';
import { task, userRoleBinding, orgCache } from '../src/schema';

async function seed() {
  const db = createDb(process.env.DATABASE_URL!);

  // 3 users
  await db.insert(orgCache).values([
    { userId: 'ou_employee_001', userName: '张三', deptId: 'dept_001', deptName: '产品部', managerUserId: 'ou_leader_001', managerName: '李四' },
    { userId: 'ou_leader_001', userName: '李四', deptId: 'dept_001', deptName: '产品部', managerUserId: 'ou_boss_001', managerName: '王总' },
    { userId: 'ou_boss_001', userName: '王总', deptId: 'dept_000', deptName: '总裁办' },
  ]).onConflictDoNothing();

  // 3 role bindings
  await db.insert(userRoleBinding).values([
    { userId: 'ou_employee_001', role: 'employee' },
    { userId: 'ou_leader_001', role: 'leader' },
    { userId: 'ou_boss_001', role: 'boss' },
  ]);

  // 5 tasks
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  await db.insert(task).values([
    { taskUid: 'task_seed_001', title: '完成Q2经营分析', taskType: 'report', priority: 'p1', status: 'in_progress', assigneeUserId: 'ou_employee_001', assigneeName: '张三', leaderUserId: 'ou_leader_001', issuerUserId: 'ou_boss_001', assignerUserId: 'ou_leader_001', assignmentType: 'manager_assign', dueAt: nextMonth, monthBucket: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, createdBy: 'ou_boss_001', version: 1, progressPercent: 30 },
    { taskUid: 'task_seed_002', title: '更新产品路线图', taskType: 'strategy', priority: 'p0', status: 'assigned', assigneeUserId: 'ou_leader_001', assigneeName: '李四', leaderUserId: 'ou_leader_001', issuerUserId: 'ou_boss_001', assignerUserId: 'ou_boss_001', assignmentType: 'boss_assign', dueAt: nextMonth, monthBucket: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, createdBy: 'ou_boss_001', version: 1, bossAttentionFlag: true },
    { taskUid: 'task_seed_003', title: '客户回访整理', taskType: 'operation', priority: 'p2', status: 'done', assigneeUserId: 'ou_employee_001', assigneeName: '张三', leaderUserId: 'ou_leader_001', issuerUserId: 'ou_leader_001', assignerUserId: 'ou_leader_001', assignmentType: 'manager_assign', dueAt: new Date(now.getFullYear(), now.getMonth(), 10), completedAt: new Date(now.getFullYear(), now.getMonth(), 8), monthBucket: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, createdBy: 'ou_leader_001', version: 2, progressPercent: 100 },
    { taskUid: 'task_seed_004', title: '团队周会准备', taskType: 'meeting', priority: 'p2', status: 'draft', assigneeUserId: 'ou_employee_001', assigneeName: '张三', leaderUserId: 'ou_leader_001', issuerUserId: 'ou_employee_001', assignerUserId: 'ou_employee_001', assignmentType: 'self_claim', dueAt: nextMonth, monthBucket: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, createdBy: 'ou_employee_001', version: 1 },
    { taskUid: 'task_seed_005', title: '竞品分析报告', taskType: 'project', priority: 'p1', status: 'blocked', assigneeUserId: 'ou_employee_001', assigneeName: '张三', leaderUserId: 'ou_leader_001', issuerUserId: 'ou_leader_001', assignerUserId: 'ou_leader_001', assignmentType: 'manager_assign', dueAt: new Date(now.getFullYear(), now.getMonth(), 5), monthBucket: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, createdBy: 'ou_leader_001', version: 1, blockedReason: '等待市场部提供数据', isOverdue: true },
  ]);

  console.log('Seed complete: 3 users, 3 roles, 5 tasks');
  process.exit(0);
}

seed().catch(console.error);
