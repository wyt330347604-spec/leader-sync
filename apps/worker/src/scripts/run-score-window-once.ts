// 一次性补跑打分窗口（monthly-close Step 6 的独立版，数据补救用）。
// 前提：该月 employee 快照已存在（月结 Step 3 已跑过）。
// 幂等：(score_month, ratee) 唯一索引 + onConflictDoNothing，可重复执行。
// 用法：
//   tsx apps/worker/src/scripts/run-score-window-once.ts --month 2026-06 --dry-run    # 预览名单，不写库
//   tsx apps/worker/src/scripts/run-score-window-once.ts --month 2026-06              # 生成草稿，不发卡片
//   tsx apps/worker/src/scripts/run-score-window-once.ts --month 2026-06 --send-cards # 生成草稿 + 给各 Leader 发打分卡片（会真实打扰！）
import 'dotenv/config';
import { runScoreWindowSetup } from '../jobs/score-window';

async function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const monthIdx = argv.indexOf('--month');
  const month = monthIdx >= 0 ? argv[monthIdx + 1] : undefined;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('用法: run-score-window-once.ts --month YYYY-MM [--send-cards] [--dry-run]');
    process.exit(1);
  }

  const dryRun = args.has('--dry-run');
  const sendCards = args.has('--send-cards');

  console.log(`[run-score-window-once] month=${month} dryRun=${dryRun} sendCards=${sendCards}`);
  const result = await runScoreWindowSetup({ month, dryRun, sendCards });
  console.log('[run-score-window-once] result:', JSON.stringify(result, null, 2));
  if (result.skippedNoManager > 0) {
    console.warn(
      `[run-score-window-once] ⚠️ ${result.skippedNoManager} 名员工无 manager（org_cache.manager_user_id 为空），` +
        '未生成草稿。请先跑通讯录同步或在组织架构图中指定上级。',
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-score-window-once] FAILED:', err);
  process.exit(1);
});
