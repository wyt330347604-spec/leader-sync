// 一次性推进自评超时任务（advance-self-timeout 的独立版）。
// 幂等：只命中 stage=pending_self 且已过 stage_deadlines.self 的任务。
// 用法：
//   tsx apps/worker/src/scripts/run-advance-self-timeout-once.ts --dry-run   # 预览将放行的任务数
//   tsx apps/worker/src/scripts/run-advance-self-timeout-once.ts             # 正式推进
import 'dotenv/config';
import { runAdvanceSelfTimeout } from '../jobs/advance-self-timeout';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  console.log(`[run-advance-self-timeout-once] dryRun=${dryRun}`);
  const result = await runAdvanceSelfTimeout({ dryRun });
  console.log('[run-advance-self-timeout-once] result:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-advance-self-timeout-once] FAILED:', err?.message ?? err);
  process.exit(1);
});
