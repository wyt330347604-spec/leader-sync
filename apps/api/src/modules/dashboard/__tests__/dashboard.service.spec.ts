import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashboardService } from '../dashboard.service';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';

// ---------------------------------------------------------------------------
// Mock DB factory — mirrors chain pattern used across other spec files
// ---------------------------------------------------------------------------

function createMockDb() {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    returning: vi.fn(),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-05-24T08:00:00Z');
const THIS_MONDAY_UTC = new Date('2026-05-18T00:00:00.000Z'); // 2026-W21 Mon UTC midnight

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    taskUid: 'task_001',
    title: 'Task Alpha',
    titleCopy: null,
    detail: null,
    taskType: 'new',
    priority: 'urgent_important',
    status: 'in_progress',
    progressPercent: 50,
    latestProgress: null,
    assigneeUserId: 'user_alice',
    assigneeName: '张三',
    assigneeManagerUserId: 'user_harvey',
    assigneeManagerName: 'Harvey',
    assigneeDeptId: null,
    assigneeDeptName: null,
    leaderUserId: 'user_harvey',
    leaderName: 'Harvey',
    issuerUserId: 'user_harvey',
    issuerName: 'Harvey',
    assignerUserId: 'user_harvey',
    assignerName: 'Harvey',
    assignmentType: 'manager_assign',
    collaborators: null,
    startAt: null,
    dueAt: new Date('2026-05-30'),
    completedAt: null,
    stallReason: null,
    delayReason: null,
    daysToDue: 6,
    isOverdue: false,
    monthBucket: '2026-05',
    sourceMonth: null,
    isCarriedOver: false,
    carriedFromTaskUid: null,
    carryOverCount: 0,
    delayCount: 0,
    monthlyCommitmentFlag: false,
    bossAttentionFlag: false,
    monthlyCloseLocked: false,
    overdueNotifiedLeaderAt: null,
    projectUid: null,
    version: 1,
    createdAt: new Date('2026-05-20T08:00:00Z'),
    updatedAt: new Date('2026-05-20T08:00:00Z'),
    createdBy: 'user_harvey',
    updatedBy: null,
    deletedAt: null,
    blockedReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getLeaderMonthly — §2.1
// ---------------------------------------------------------------------------

describe('DashboardService.getLeaderMonthly', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: DashboardService;

  beforeEach(() => {
    db = createMockDb();
    service = new DashboardService(db as any);
  });

  it('returns summary with members grouped by assignee for the current leader', async () => {
    const taskDone = makeTask({ taskUid: 'task_001', status: 'done', assigneeUserId: 'user_alice', assigneeName: '张三' });
    const taskInProg = makeTask({ taskUid: 'task_002', status: 'in_progress', assigneeUserId: 'user_alice', assigneeName: '张三' });
    const taskOverdue = makeTask({
      taskUid: 'task_003',
      status: 'in_progress',
      isOverdue: true,
      assigneeUserId: 'user_bob',
      assigneeName: '李四',
    });

    // First call: task table query; second call: task_leader table query
    db.where
      .mockResolvedValueOnce([taskDone, taskInProg, taskOverdue]) // main task query
      .mockResolvedValueOnce([]); // task_leader query

    const result = await service.getLeaderMonthly('user_harvey', 'Harvey', '2026-05');

    expect(result.month).toBe('2026-05');
    expect(result.leaderId).toBe('user_harvey');
    expect(result.total).toBe(3);
    expect(result.done).toBe(1);
    // 累计口径：due≤月末且未完成 = taskInProg + taskOverdue = 2（不再依赖 isOverdue 标志）
    expect(result.overdue).toBe(2);
    expect(result.completionRate).toBe(33); // Math.round(1/3*100)
    expect(result.members).toHaveLength(2);

    const alice = result.members.find((m) => m.userId === 'user_alice');
    expect(alice).toBeDefined();
    expect(alice!.total).toBe(2);
    expect(alice!.done).toBe(1);
    expect(alice!.completionRate).toBe(50);

    const bob = result.members.find((m) => m.userId === 'user_bob');
    expect(bob).toBeDefined();
    expect(bob!.overdue).toBe(1);
  });

  it('completion rate is 0 when total is 0', async () => {
    db.where
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getLeaderMonthly('user_harvey', 'Harvey', '2026-05');
    expect(result.total).toBe(0);
    expect(result.completionRate).toBe(0);
    expect(result.members).toHaveLength(0);
  });

  it('shelved/closed tasks are NOT counted in completion rate numerator', async () => {
    const taskShelved = makeTask({ taskUid: 'task_s', status: 'shelved' });
    const taskClosed = makeTask({ taskUid: 'task_c', status: 'closed' });
    const taskDone = makeTask({ taskUid: 'task_d', status: 'done' });

    db.where
      .mockResolvedValueOnce([taskShelved, taskClosed, taskDone])
      .mockResolvedValueOnce([]);

    const result = await service.getLeaderMonthly('user_harvey', 'Harvey', '2026-05');
    // 累计口径：shelved 不入分母，closed 入分母但不算 done。total = closed + done = 2
    expect(result.total).toBe(2);
    expect(result.done).toBe(1); // only 'done' counts
    expect(result.completionRate).toBe(50);
  });

  it('overdue count excludes done/shelved/closed tasks', async () => {
    const taskOverdueDone = makeTask({ taskUid: 'task_od', status: 'done', isOverdue: true });
    const taskOverdueActive = makeTask({ taskUid: 'task_oa', status: 'in_progress', isOverdue: true });

    db.where
      .mockResolvedValueOnce([taskOverdueDone, taskOverdueActive])
      .mockResolvedValueOnce([]);

    const result = await service.getLeaderMonthly('user_harvey', 'Harvey', '2026-05');
    expect(result.overdue).toBe(1); // done task should not count as overdue
  });

  it('tasks from task_leader table are included for the current leader', async () => {
    // task owned by a different primary leader but with current user as extra leader
    const task = makeTask({
      taskUid: 'task_extra',
      leaderUserId: 'user_other',
      leaderName: 'Other Leader',
      assigneeUserId: 'user_alice',
      assigneeName: '张三',
    });

    // task_leader query returns a row linking this task to user_harvey
    db.where
      .mockResolvedValueOnce([task]) // main task table query (all tasks in bucket)
      .mockResolvedValueOnce([{ taskUid: 'task_extra', leaderUserId: 'user_harvey', leaderName: 'Harvey' }]);

    const result = await service.getLeaderMonthly('user_harvey', 'Harvey', '2026-05');
    expect(result.total).toBe(1);
    expect(result.members).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getLeaderMemberTasks — §2.2
// ---------------------------------------------------------------------------

describe('DashboardService.getLeaderMemberTasks', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: DashboardService;

  beforeEach(() => {
    db = createMockDb();
    service = new DashboardService(db as any);
  });

  it('returns task detail list for a member belonging to the requesting leader', async () => {
    const t = makeTask({
      taskUid: 'task_001',
      assigneeUserId: 'user_alice',
      assigneeName: '张三',
      leaderUserId: 'user_harvey',
      status: 'done',
      completedAt: new Date('2026-05-22T10:00:00Z'),
    });

    // First: fetch tasks for member; second: task_leader check
    db.where
      .mockResolvedValueOnce([t])  // member tasks
      .mockResolvedValueOnce([]); // task_leader (no extra leaders on these tasks)

    const result = await service.getLeaderMemberTasks(
      'user_harvey',
      'user_alice',
      '2026-05',
    );

    expect(result.userId).toBe('user_alice');
    expect(result.userName).toBe('张三');
    expect(result.summary.total).toBe(1);
    expect(result.summary.done).toBe(1);
    expect(result.summary.completionRate).toBe(100);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].taskUid).toBe('task_001');
    expect(result.tasks[0].status).toBe('done');
    expect(result.tasks[0].completedAt).not.toBeNull();
  });

  it('throws 1002 NO_PERMISSION when member has no task belonging to requesting leader', async () => {
    const t = makeTask({
      taskUid: 'task_001',
      assigneeUserId: 'user_alice',
      leaderUserId: 'user_other', // Different leader
    });

    db.where
      .mockResolvedValueOnce([t])
      .mockResolvedValueOnce([]); // no task_leader entries either

    await expect(
      service.getLeaderMemberTasks('user_harvey', 'user_alice', '2026-05'),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('grants access when member is linked via task_leader (extra leader)', async () => {
    const t = makeTask({
      taskUid: 'task_001',
      assigneeUserId: 'user_alice',
      leaderUserId: 'user_other', // Not harvey as primary
    });

    db.where
      .mockResolvedValueOnce([t])
      .mockResolvedValueOnce([{ taskUid: 'task_001', leaderUserId: 'user_harvey', leaderName: 'Harvey' }]);

    const result = await service.getLeaderMemberTasks('user_harvey', 'user_alice', '2026-05');
    expect(result.tasks).toHaveLength(1);
  });

  it('returns empty tasks list with completionRate=0 when member has no tasks this month', async () => {
    // Member's own tasks query returns nothing
    db.where
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    // No tasks → permission check fails unless we treat empty list as allowed
    // Per spec: permission check requires at least one task linking leader to member
    // Empty means no access → should throw 1002
    await expect(
      service.getLeaderMemberTasks('user_harvey', 'user_alice', '2026-05'),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('task detail includes completedAt, isOverdue, delayCount, carryOverCount', async () => {
    const t = makeTask({
      taskUid: 'task_rich',
      assigneeUserId: 'user_alice',
      leaderUserId: 'user_harvey',
      status: 'in_progress',
      isOverdue: true,
      delayCount: 2,
      carryOverCount: 1,
      progressPercent: 30,
      bossAttentionFlag: true,
    });

    db.where
      .mockResolvedValueOnce([t])
      .mockResolvedValueOnce([]);

    const result = await service.getLeaderMemberTasks('user_harvey', 'user_alice', '2026-05');
    const detail = result.tasks[0];

    expect(detail.isOverdue).toBe(true);
    expect(detail.delayCount).toBe(2);
    expect(detail.carryOverCount).toBe(1);
    expect(detail.progressPercent).toBe(30);
    expect(detail.bossAttentionFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getLeaderWeekly — §2.3
// ---------------------------------------------------------------------------

describe('DashboardService.getLeaderWeekly', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: DashboardService;

  beforeEach(() => {
    // 固定时钟到 NOW（2026-05-24，周日）以稳定「本周」判定；fixture 的 completedAt
    // 落在 2026-05-18..24 这一周。只 fake Date，不影响 async mock 的 Promise 调度。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    db = createMockDb();
    service = new DashboardService(db as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns weekStart/weekEnd and per-member counts', async () => {
    const taskNew = makeTask({
      taskUid: 'task_new',
      assigneeUserId: 'user_alice',
      assigneeName: '张三',
      leaderUserId: 'user_harvey',
      status: 'in_progress',
      createdAt: new Date('2026-05-20T09:00:00Z'), // within current week
      completedAt: null,
      isOverdue: false,
    });

    const taskDoneThisWeek = makeTask({
      taskUid: 'task_done',
      assigneeUserId: 'user_alice',
      assigneeName: '张三',
      leaderUserId: 'user_harvey',
      status: 'done',
      createdAt: new Date('2026-05-15T09:00:00Z'), // before this week
      completedAt: new Date('2026-05-21T10:00:00Z'), // done this week
      isOverdue: false,
    });

    const taskOverdueActive = makeTask({
      taskUid: 'task_overdue',
      assigneeUserId: 'user_alice',
      assigneeName: '张三',
      leaderUserId: 'user_harvey',
      status: 'in_progress',
      createdAt: new Date('2026-05-01T09:00:00Z'),
      completedAt: null,
      isOverdue: true,
    });

    db.where
      .mockResolvedValueOnce([taskNew, taskDoneThisWeek, taskOverdueActive])
      .mockResolvedValueOnce([]); // task_leader

    const result = await service.getLeaderWeekly('user_harvey', 'Harvey');

    expect(result.leaderId).toBe('user_harvey');
    expect(result.leaderName).toBe('Harvey');
    expect(result.weekStart).toBeDefined();
    expect(result.weekEnd).toBeDefined();

    const alice = result.members.find((m) => m.userId === 'user_alice');
    expect(alice).toBeDefined();
    expect(alice!.doneCount).toBe(1);
    expect(alice!.overdueCount).toBe(1);
  });

  it('teamSummary aggregates all members', async () => {
    const t1 = makeTask({
      taskUid: 'task_01',
      assigneeUserId: 'user_alice',
      leaderUserId: 'user_harvey',
      status: 'done',
      createdAt: new Date('2026-05-20T09:00:00Z'),
      completedAt: new Date('2026-05-21T09:00:00Z'),
      isOverdue: false,
    });
    const t2 = makeTask({
      taskUid: 'task_02',
      assigneeUserId: 'user_bob',
      leaderUserId: 'user_harvey',
      status: 'in_progress',
      createdAt: new Date('2026-05-19T09:00:00Z'),
      completedAt: null,
      isOverdue: true,
    });

    db.where
      .mockResolvedValueOnce([t1, t2])
      .mockResolvedValueOnce([]);

    const result = await service.getLeaderWeekly('user_harvey', 'Harvey');
    expect(result.members).toHaveLength(2);
    expect(result.teamSummary.doneCount).toBe(1);
    expect(result.teamSummary.overdueCount).toBe(1);
  });

  it('returns empty members list when leader has no tasks', async () => {
    db.where
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getLeaderWeekly('user_harvey', 'Harvey');
    expect(result.members).toHaveLength(0);
    expect(result.teamSummary.newCount).toBe(0);
    expect(result.teamSummary.doneCount).toBe(0);
    expect(result.teamSummary.overdueCount).toBe(0);
    expect(result.teamSummary.completionRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getMyMonthly — §2.4
// ---------------------------------------------------------------------------

describe('DashboardService.getMyMonthly', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: DashboardService;

  beforeEach(() => {
    db = createMockDb();
    service = new DashboardService(db as any);
  });

  it('returns summary for current user', async () => {
    const t1 = makeTask({ taskUid: 'task_01', status: 'done', assigneeUserId: 'user_alice' });
    const t2 = makeTask({ taskUid: 'task_02', status: 'in_progress', assigneeUserId: 'user_alice' });
    const t3 = makeTask({
      taskUid: 'task_03',
      status: 'in_progress',
      assigneeUserId: 'user_alice',
      isOverdue: true,
    });

    db.where.mockResolvedValueOnce([t1, t2, t3]);

    const result = await service.getMyMonthly('user_alice', '张三', '2026-05');

    expect(result.userId).toBe('user_alice');
    expect(result.userName).toBe('张三');
    expect(result.month).toBe('2026-05');
    expect(result.total).toBe(3);
    expect(result.done).toBe(1);
    expect(result.inProgress).toBe(2);
    // 累计口径：due≤月末且未完成 = t2 + t3 = 2
    expect(result.overdue).toBe(2);
    expect(result.completionRate).toBe(33);
  });

  it('carriedOver counts tasks with carryOverCount >= 1', async () => {
    const t1 = makeTask({ taskUid: 't1', status: 'in_progress', carryOverCount: 1 });
    const t2 = makeTask({ taskUid: 't2', status: 'in_progress', carryOverCount: 2 });
    const t3 = makeTask({ taskUid: 't3', status: 'in_progress', carryOverCount: 0 });

    db.where.mockResolvedValueOnce([t1, t2, t3]);

    const result = await service.getMyMonthly('user_alice', '张三', '2026-05');
    expect(result.carriedOver).toBe(2);
  });

  it('delayTotal is sum of delay_count across all tasks', async () => {
    const t1 = makeTask({ taskUid: 't1', delayCount: 3 });
    const t2 = makeTask({ taskUid: 't2', delayCount: 1 });
    const t3 = makeTask({ taskUid: 't3', delayCount: 0 });

    db.where.mockResolvedValueOnce([t1, t2, t3]);

    const result = await service.getMyMonthly('user_alice', '张三', '2026-05');
    expect(result.delayTotal).toBe(4);
  });

  it('completion rate is 0 when no tasks exist', async () => {
    db.where.mockResolvedValueOnce([]);

    const result = await service.getMyMonthly('user_alice', '张三', '2026-05');
    expect(result.total).toBe(0);
    expect(result.completionRate).toBe(0);
  });

  it('only done status counts in completionRate numerator (shelved/closed excluded)', async () => {
    const t1 = makeTask({ taskUid: 't1', status: 'done' });
    const t2 = makeTask({ taskUid: 't2', status: 'shelved' });
    const t3 = makeTask({ taskUid: 't3', status: 'closed' });

    db.where.mockResolvedValueOnce([t1, t2, t3]);

    const result = await service.getMyMonthly('user_alice', '张三', '2026-05');
    // 累计口径：shelved 不入分母，total = done + closed = 2
    expect(result.total).toBe(2);
    expect(result.done).toBe(1);
    expect(result.completionRate).toBe(50);
  });

  it('overdue count excludes done/shelved/closed tasks', async () => {
    const t1 = makeTask({ taskUid: 't1', status: 'done', isOverdue: true });
    const t2 = makeTask({ taskUid: 't2', status: 'shelved', isOverdue: true });
    const t3 = makeTask({ taskUid: 't3', status: 'in_progress', isOverdue: true });

    db.where.mockResolvedValueOnce([t1, t2, t3]);

    const result = await service.getMyMonthly('user_alice', '张三', '2026-05');
    expect(result.overdue).toBe(1);
  });

  it('uses current month as default when month param omitted', async () => {
    db.where.mockResolvedValueOnce([]);

    // We can't intercept the query directly but we can verify the method resolves
    const result = await service.getMyMonthly('user_alice', '张三');
    expect(result.month).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// getBossDashboard — 累计口径 + 上月回看（含被继承走的任务）
// spec: docs/superpowers/specs/2026-06-01-dashboard-cumulative-lookback.md
// ---------------------------------------------------------------------------

/** 循环安全 stringify，用于在 drizzle SQL 谓词里查列名 */
function safeStr(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return undefined;
      seen.add(v);
    }
    return v;
  });
}

function makeCompanySnapshot(over: Record<string, unknown> = {}) {
  return {
    roleScope: 'company',
    snapshotMonth: '2026-05',
    isLatest: true,
    ownerUserId: null,
    ownerName: null,
    monthOpenCount: 0,
    monthNewCount: 0,
    monthDueCount: 431,
    monthDoneCount: 23,
    monthOverdueCount: 408,
    monthCarryOverCount: 412,
    doneRate: '0.0533',
    overdueRate: '0.9466',
    ...over,
  };
}

describe('DashboardService.getBossDashboard — 累计口径 + 上月回看', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: DashboardService;

  beforeEach(() => {
    db = createMockDb();
    service = new DashboardService(db as any);
  });

  it('任务查询谓词按归属月份区间(month_bucket + COALESCE(source_month))，回看时纳入长期积压任务', async () => {
    // tasks 空 → 无 extraLeaders；快照查询以 .limit 收尾，默认 chain 解析为无快照。
    db.where.mockResolvedValueOnce([]);
    await service.getBossDashboard({ type: 'month', value: '2026-05' });
    const sql = safeStr(db.where.mock.calls[0][0]);
    // 区间谓词必须同时引用 month_bucket 与 source_month（COALESCE 形式），
    // 不能是 source_month = M 等值（会漏掉 source_month < M 的多次继承任务）。
    expect(sql).toMatch(/source_month/);
    expect(sql).toMatch(/month_bucket/);
  });

  it('已结月份(存在快照)：顶部统计取自快照，分母=月末应完成全集(含被继承任务)', async () => {
    const inBucketDone = makeTask({ taskUid: 'd1', status: 'done', monthBucket: '2026-05', dueAt: new Date('2026-05-10'), carryOverCount: 1 });
    db.where
      .mockResolvedValueOnce([inBucketDone]) // tasks
      .mockResolvedValueOnce([]); // task_leader
    // 快照查询以 .orderBy().limit(1) 结尾 → 解析点在 limit
    db.limit.mockResolvedValueOnce([makeCompanySnapshot()]); // company snapshot

    const r = await service.getBossDashboard({ type: 'month', value: '2026-05' });

    expect(r.stats.total).toBe(431); // 不是实时的 1
    expect(r.stats.done).toBe(23);
    expect(r.stats.overdue).toBe(408);
    // #3: carryOver 始终取「携带进本期」(carryOverCount>=1) 的实时口径，不被快照覆盖。
    expect(r.stats.carryOver).toBe(1);
    expect(r.stats.doneRate).toBe(5); // round(23/431*100)
    expect(r.stats.overdueRate).toBe(95); // round(408/431*100)
    expect(r.snapshot?.monthDueCount).toBe(431);
  });

  it('当前月/无快照：走累计口径，未到期与 shelved 不计入分母', async () => {
    const futureMay = makeTask({ taskUid: 'f', status: 'not_started', dueAt: new Date('2026-05-28'), isOverdue: false });
    const shelvedApr = makeTask({ taskUid: 's', status: 'shelved', dueAt: new Date('2026-04-10') });
    const doneApr = makeTask({ taskUid: 'da', status: 'done', dueAt: new Date('2026-04-10') });
    const overdueApr = makeTask({ taskUid: 'oa', status: 'in_progress', isOverdue: true, dueAt: new Date('2026-04-10') });

    db.where
      .mockResolvedValueOnce([futureMay, shelvedApr, doneApr, overdueApr]) // tasks
      .mockResolvedValueOnce([]); // task_leader
    // 不 mock db.limit → 快照查询解析为默认 chain → snapshots[0]=undefined → 走实时累计分支
    db.limit.mockResolvedValueOnce([]);

    const r = await service.getBossDashboard({ type: 'month', value: '2026-04' });

    // 累计应完成全集 = due_at ≤ 4月末 且 非shelved = {doneApr, overdueApr} = 2
    expect(r.stats.total).toBe(2); // futureMay(5月到期)与 shelvedApr 排除
    expect(r.stats.done).toBe(1);
    expect(r.stats.overdue).toBe(1);
    expect(r.stats.doneRate).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 其余按月视图：甘特 / leader月度 / 我的月度 / 成员明细 —— 同样改归属月份区间谓词
// （回看上月时含被继承走的任务）。断言查询谓词引用 source_month + month_bucket。
// ---------------------------------------------------------------------------
describe('其余按月视图的归属月份区间谓词', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: DashboardService;

  beforeEach(() => {
    db = createMockDb();
    service = new DashboardService(db as any);
  });

  it('getGanttData 用区间谓词(month_bucket + source_month)', async () => {
    db.where.mockResolvedValueOnce([]); // tasks 空 → 无 extraLeaders 查询
    await service.getGanttData({ type: 'month', value: '2026-05' });
    const sqlStr = safeStr(db.where.mock.calls[0][0]);
    expect(sqlStr).toMatch(/source_month/);
    expect(sqlStr).toMatch(/month_bucket/);
  });

  it('getLeaderMonthly 用区间谓词(month_bucket + source_month)', async () => {
    db.where.mockResolvedValueOnce([]); // allTasks 空
    await service.getLeaderMonthly('user_harvey', 'Harvey', '2026-05');
    const sqlStr = safeStr(db.where.mock.calls[0][0]);
    expect(sqlStr).toMatch(/source_month/);
    expect(sqlStr).toMatch(/month_bucket/);
  });

  it('getMyMonthly 用区间谓词(month_bucket + source_month)，且仍按 assignee 过滤', async () => {
    db.where.mockResolvedValueOnce([]);
    await service.getMyMonthly('user_alice', '张三', '2026-05');
    const sqlStr = safeStr(db.where.mock.calls[0][0]);
    expect(sqlStr).toMatch(/source_month/);
    expect(sqlStr).toMatch(/assignee_user_id/);
  });

  it('getLeaderMemberTasks 用区间谓词，权限检查仍生效', async () => {
    const t = makeTask({ taskUid: 't1', leaderUserId: 'user_harvey', assigneeUserId: 'user_alice' });
    db.where
      .mockResolvedValueOnce([t]) // memberTasks (含归属该 leader 的任务 → 通过权限)
      .mockResolvedValueOnce([]); // task_leader
    const r = await service.getLeaderMemberTasks('user_harvey', 'user_alice', '2026-05');
    expect(r.userId).toBe('user_alice');
    const sqlStr = safeStr(db.where.mock.calls[0][0]);
    expect(sqlStr).toMatch(/source_month/);
    expect(sqlStr).toMatch(/assignee_user_id/);
  });
});
