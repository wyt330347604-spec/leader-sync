/**
 * 一次性：给 dev DB 灌需求轴演示数据（需求 + 任务挂载/投入度），供截图审计。
 * 运行：DATABASE_URL=... pnpm tsx scripts/seed-requirements.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 12)}`;
}

async function main() {
  const lines = await sql<{ project_uid: string; name: string }[]>`
    select project_uid, name from project where parent_project_uid is null and is_default = false order by name limit 3`;
  const apps = await sql<{ project_uid: string; name: string; parent_project_uid: string }[]>`
    select project_uid, name, parent_project_uid from project where parent_project_uid is not null order by name`;
  if (lines.length === 0) throw new Error('无业务线，先 pnpm dev:up');
  const line = lines[0];
  const lineApps = apps.filter((a) => a.parent_project_uid === line.project_uid);
  const app = lineApps[0] ?? apps[0];
  console.log(`业务线=${line.name} app=${app?.name ?? '(无)'}`);

  await sql`delete from requirement_artifact`;
  await sql`delete from requirement`;
  await sql`update task set requirement_uid = null, allocation_pct = null, est_effort_days = null`;

  const statuses = ['collected', 'analyzing', 'req_review', 'tech_review', 'developing', 'testing', 'product_accept', 'released'];
  const titles = [
    '收银台支持分期付款', '风控规则引擎升级', '商户结算 T+1 改 T+0', 'App 首页改版',
    '对账中心自动化', '反欺诈模型迭代', '客服工单系统', '数据看板实时化',
  ];
  const reqs: { uid: string; status: string }[] = [];
  for (let i = 0; i < titles.length; i++) {
    const ruid = uid('req');
    const status = statuses[i];
    const priority = i === 1 ? 'P0' : i % 3 === 0 ? 'P1' : 'P2';
    const onApp = i % 2 === 0 && app;
    await sql`insert into requirement
      (requirement_uid, title, value, business_line_uid, app_project_uid, source, priority, status,
       reporter_user_id, reporter_name, pm_user_id, pm_name, expected_release_date, company_id, version, created_by)
      values (${ruid}, ${titles[i]}, ${'解决' + titles[i] + '的痛点'}, ${line.project_uid},
       ${onApp ? app.project_uid : null}, 'biz', ${priority}, ${status},
       'ou_dev_alice', 'Alice', ${status === 'collected' ? null : 'ou_dev_harvey'}, ${status === 'collected' ? null : 'Harvey'},
       ${priority === 'P0' ? '2026-07-15' : i % 2 === 0 ? '2026-08-01' : null}, 'default', 1, 'ou_dev_alice')`;
    reqs.push({ uid: ruid, status });
  }

  // 给 developing/testing 的需求挂任务 + 投入度（制造同一人并行 → 过载）
  const devReq = reqs.find((r) => r.status === 'developing')!;
  const testReq = reqs.find((r) => r.status === 'testing')!;
  const tasks = await sql<{ task_uid: string; assignee_user_id: string }[]>`
    select task_uid, assignee_user_id from task order by created_at limit 8`;
  const today = '2026-06-02';
  const due = '2026-06-30';
  // 同一负责人 bob 挂 2 个任务各 70%/60% → 130% 过载
  const bobTasks = tasks.slice(0, 2);
  for (const t of bobTasks) {
    await sql`update task set requirement_uid = ${devReq.uid}, allocation_pct = 70, est_effort_days = 4,
      assignee_user_id = 'ou_dev_bob', assignee_name = 'Bob', project_uid = ${app?.project_uid ?? line.project_uid},
      start_at = ${today}, due_at = ${due} where task_uid = ${t.task_uid}`;
  }
  await sql`update task set allocation_pct = 60 where task_uid = ${bobTasks[1]?.task_uid}`;
  // carol 一个任务 50%
  const carolTask = tasks[2];
  if (carolTask) {
    await sql`update task set requirement_uid = ${testReq.uid}, allocation_pct = 50, est_effort_days = 3,
      assignee_user_id = 'ou_dev_carol', assignee_name = 'Carol', project_uid = ${app?.project_uid ?? line.project_uid},
      start_at = ${today}, due_at = ${due} where task_uid = ${carolTask.task_uid}`;
  }

  // 一个产出物
  await sql`insert into requirement_artifact (requirement_uid, type, title, url, created_by)
    values (${devReq.uid}, 'prd', 'PRD-v1.2', 'https://example.com/prd', 'ou_dev_harvey')`;

  const [{ count: rc }] = await sql<{ count: string }[]>`select count(*)::text as count from requirement`;
  const [{ count: tc }] = await sql<{ count: string }[]>`select count(*)::text as count from task where allocation_pct is not null`;
  console.log(`✓ 需求 ${rc} 条；带投入度任务 ${tc} 个`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
