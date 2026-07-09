// 一次性跑季度评分截止 T-2d 催办（quarter-deadline-reminder 的独立版）。
// 只读 + 发卡，不写库。dry-run 预览将催办的人数（不发飞书）。
// 用法：
//   tsx apps/worker/src/scripts/run-quarter-deadline-reminder-once.ts --dry-run
//   tsx apps/worker/src/scripts/run-quarter-deadline-reminder-once.ts
import 'dotenv/config';
import { runQuarterDeadlineReminder } from '../jobs/quarter-deadline-reminder';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  console.log(`[run-quarter-deadline-reminder-once] dryRun=${dryRun}`);
  const result = await runQuarterDeadlineReminder({ dryRun });
  console.log('[run-quarter-deadline-reminder-once] result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-quarter-deadline-reminder-once] FAILED:', err?.message ?? err);
  process.exit(1);
});
